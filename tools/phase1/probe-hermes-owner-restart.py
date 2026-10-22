"""Actual restart of ONLY probe-owned Hermes processes; synthetic agent and private home."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def wait_for(fn, seconds=20):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(.03)
    raise AssertionError('bounded wait expired')


def worker(args):
    import socket
    import threading
    os.environ.update(HERMES_HOME=str(args.home.resolve()), HERMES_ISO_CERTIFY_SYNTH_TURN='1',
                      HERMES_DISABLE_LAZY_INSTALLS='1', HERMES_TUI_PROCESS_ISOLATION='0')
    sys.path.insert(0, str(args.source.resolve()))
    sys.dont_write_bytecode = True
    def deny(*a, **k):
        raise RuntimeError('P11 restart probe prohibits network')
    socket.socket.connect = deny
    socket.create_connection = deny
    from tui_gateway import server, server_requests
    from tui_gateway.synthetic_turn import SyntheticHeavyAgent
    from tui_gateway.transport import bind_transport, reset_transport

    class Peer:
        def __init__(self): self.frames = []; self._closed = False
        def write(self, frame): self.frames.append(frame); return True
        def close(self): self._closed = True
    peer = Peer()
    server_requests.advertise(peer, True)
    agents = []
    class AskAgent(SyntheticHeavyAgent):
        def __init__(self, sid): super().__init__(sid); self.received = []; agents.append(self)
        def run_conversation(self, message, *, conversation_history=None, **kwargs):
            self.received.append(message)
            reply = 'synthetic baseline'
            if 'P11ASK' in message:
                live = next(sid for sid, slot in server._sessions.items() if slot.get('agent') is self)
                answer = server_requests.send('clarify', live, {'questions': [
                    {'qid': 'q1', 'question': 'Synthetic restart A/B?', 'choices': ['A', 'B']}]},
                    timeout=60, qids=['q1'])
                reply = 'answer:' + json.dumps(answer)
            self.history = list(conversation_history or []) + [
                {'role': 'user', 'content': message}, {'role': 'assistant', 'content': reply}]
            return {'final_response': reply, 'messages': self.history,
                    'interrupted': self._interrupt.is_set(), 'error': None}
    server._schedule_agent_build = lambda *a, **k: None
    server._make_agent_in_context = lambda sid, key, **kwargs: AskAgent(key)
    # Replace only model construction, not resume/auto-continue/request routing.
    # Otherwise cold resume could wait on an unconfigured real provider and the
    # harness would mistake its own disabled build for missing continuation.
    def build_synthetic(sid, slot):
        if slot.get('agent') is None:
            slot['agent'] = AskAgent(slot['session_key'])
        slot['agent_ready'].set()
    server._start_agent_build = build_synthetic
    sequence = 0
    def rpc(method, **params):
        nonlocal sequence
        sequence += 1
        token = bind_transport(peer)
        try: return server.handle_request({'jsonrpc': '2.0', 'id': sequence, 'method': method, 'params': params})
        finally: reset_transport(token)
    def result(method, **params):
        reply = rpc(method, **params)
        if 'error' in reply: raise AssertionError(f'{method}: {reply["error"]}')
        return reply['result']
    if args.worker == 'before':
        slot = result('session.create', cwd=str(args.home), cwd_explicit=True,
                      title='P11 isolated restart', idempotency_key=args.home.name)
        sid, stored = slot['session_id'], slot['stored_session_id']
        current = server._sessions[sid]
        agent = AskAgent(stored); current['agent'] = agent
        ready = threading.Event(); ready.set(); current['agent_ready'] = ready
        result('prompt.submit', session_id=sid, text='P11BASE synthetic')
        wait_for(lambda: agent.received and not current.get('running'))
        result('prompt.submit', session_id=sid, text='P11ASK synthetic')
        question = wait_for(lambda: next(iter(server_requests.open_requests(sid)), None))
        queued = result('prompt.submit', session_id=sid, text='P11QUEUED synthetic', queued=True)
        assert queued['status'] == 'queued'
        args.state.write_text(json.dumps({'live': sid, 'stored': stored, 'request': question['id'],
                                         'before_pid': os.getpid(), 'database_exists': (args.home/'state.db').exists()}))
        while True: time.sleep(.1)  # parent terminates ONLY this process to simulate owner death
    else:
        old = json.loads(args.state.read_text())
        missing = rpc('session.activate', session_id=old['live'])
        resumed = result('session.resume', session_id=old['stored'])
        sid = resumed['session_id']
        # Auto-continue may reissue a question, but cannot resurrect the old Python wait.
        end = time.monotonic()+8
        new_requests = []
        while time.monotonic()<end:
            new_requests = server_requests.open_requests(sid)
            if new_requests: break
            time.sleep(.03)
        late = server_requests.resolve_response({'jsonrpc':'2.0','id':old['request'],
                                                'result':{'answers':{'q1':'late synthetic'}}},peer)
        fresh_accepted = False
        continued = False
        if new_requests:
            fresh_accepted = server_requests.resolve_response({'jsonrpc':'2.0','id':new_requests[0]['id'],
                'result':{'answers':{'q1':'fresh synthetic answer'}}},peer)
            wait_for(lambda: not server._sessions[sid].get('running'))
            continued = any('fresh synthetic answer' in str(a.history) for a in agents)
        observed = {'different_process': os.getpid()!=old['before_pid'],
                    'old_live_id_rejected': 'error' in missing,
                    'same_stored_session': resumed.get('session_key')==old['stored'],
                    'new_live_id': sid!=old['live'], 'old_request_recovered': any(r['id']==old['request'] for r in new_requests),
                    'old_answer_accepted': late, 'auto_continue_descriptor': bool(resumed.get('auto_continue')),
                    'new_question_count': len(new_requests),
                    'fresh_question_answer_accepted':fresh_accepted, 'fresh_turn_continued':continued,
                    'synthetic_prompts_after_restart': sum(len(a.received) for a in agents),
                    'queued_followup_executed': any('P11QUEUED' in m for a in agents for m in a.received)}
        args.after.write_text(json.dumps(observed, indent=2))
        server_requests.cancel(reason='isolated restart probe ended')
        os._exit(0)


def main(args):
    run = args.output.parent/'runtime-home'/('restart-'+uuid.uuid4().hex)
    run.mkdir(parents=True)
    state, after = run/'before.json', run/'after.json'
    command = [sys.executable, str(Path(__file__).resolve()), '--source', str(args.source.resolve()),
               '--output', str(args.output.resolve()), '--home', str(run.resolve()), '--state', str(state.resolve()),
               '--after', str(after.resolve())]
    child = None
    report = {'kind':'installed_hermes_owner_process_restart_with_synthetic_agent', 'network':'blocked', 'passed':False}
    try:
        with (run/'before.log').open('wb') as log:
            child = subprocess.Popen(command+['--worker','before'], stdout=log, stderr=log, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            wait_for(lambda: state.exists() or child.poll() is not None)
            if not state.exists(): raise AssertionError('before worker failed; private log retained')
            old = json.loads(state.read_text())
            assert old['database_exists'], 'actual session database was not created'
            child.terminate(); child.wait(timeout=10); child=None
        with (run/'after.log').open('wb') as log:
            completed = subprocess.run(command+['--worker','after'], stdout=log, stderr=log, timeout=30,
                                       creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode or not after.exists(): raise AssertionError('after worker failed; private log retained')
        report['runtime'] = {k:v for k,v in json.loads((args.source/'install-stamp.json').read_text()).items()
                             if k in ('displayVersion','commit','dirty')}
        report['observed'] = json.loads(after.read_text())
        assert report['observed']['different_process'] and report['observed']['same_stored_session']
        assert report['observed']['old_live_id_rejected'] and report['observed']['new_live_id']
        report['agent_construction']='synthetic fixture; real resume and auto-continue handlers'
        report['passed']=True  # observation harness passed, NOT seamless task resumption
    except Exception as exc:
        report['error']=f'{type(exc).__name__}: {exc}'
    finally:
        if child and child.poll() is None: child.terminate(); child.wait(timeout=10)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['passed'] else 1


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--worker',choices=['before','after']);p.add_argument('--home',type=Path)
    p.add_argument('--state',type=Path);p.add_argument('--after',type=Path)
    args=p.parse_args()
    if args.worker: worker(args)
    else: sys.exit(main(args))
