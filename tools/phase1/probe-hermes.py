"""Pinned installed Hermes handler experiment; synthetic agent, isolated storage, no network.

Uses real session.create/prompt.submit/session.activate/session.interrupt handlers and
server_requests. The agent body is deliberately deterministic: this is runtime
routing evidence, NOT a production agent/model or server end-to-end acceptance.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import uuid

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--websocket', action='store_true', help='Also test real loopback TCP/WebSocket detach and reattach')
args = p.parse_args()
run = args.output.parent / 'runtime-home' / uuid.uuid4().hex
run.mkdir(parents=True)
os.environ['HERMES_HOME'] = str(run.resolve())
os.environ['HERMES_ISO_CERTIFY_SYNTH_TURN'] = '1'
os.environ['HERMES_DISABLE_LAZY_INSTALLS'] = '1'
os.environ['HERMES_TUI_PROCESS_ISOLATION'] = '0'
sys.path.insert(0, str(args.source.resolve()))
sys.dont_write_bytecode = True

original_connect = socket.socket.connect
original_create_connection = socket.create_connection
def no_network(sock, address):
    if args.websocket and isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
        return original_connect(sock, address)
    raise RuntimeError('P11 probe prohibits outbound network')
socket.socket.connect = no_network
def guarded_create_connection(address, *a, **k):
    if args.websocket and address[0] in ('127.0.0.1', '::1'):
        return original_create_connection(address, *a, **k)
    raise RuntimeError('P11 probe prohibits outbound network')
socket.create_connection = guarded_create_connection

from tui_gateway import server, server_requests
from tui_gateway.synthetic_turn import SyntheticHeavyAgent
from tui_gateway.transport import bind_transport, reset_transport

checks = []
class Peer:
    def __init__(self): self.frames = []; self._closed = False
    def write(self, frame): self.frames.append(frame); return not self._closed
    def close(self): self._closed = True
peer = Peer()

def call(method, **params):
    token = bind_transport(peer)
    try:
        reply = server.handle_request({'jsonrpc': '2.0', 'id': len(checks) + 1, 'method': method, 'params': params})
    finally: reset_transport(token)
    if reply and 'error' in reply: raise RuntimeError(f'{method}: {reply["error"]}')
    return reply['result']

def wait_for(fn, seconds=8):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = fn()
        if value: return value
        time.sleep(.02)
    raise AssertionError('bounded wait expired')

class AskAgent(SyntheticHeavyAgent):
    def __init__(self, sid): super().__init__(sid); self.received = []
    def run_conversation(self, message, *, conversation_history=None, **kwargs):
        self.received.append(message)
        reply = 'synthetic-done'
        if message.startswith('ASK'):
            live = next(sid for sid, s in server._sessions.items() if s.get('agent') is self)
            answer = server_requests.send('clarify', live, {'questions': [{'qid': 'q1', 'question': 'Synthetic A or B?', 'choices': ['A', 'B']}]}, timeout=8, qids=['q1'])
            reply = 'answer:' + json.dumps(answer, sort_keys=True)
        history = list(conversation_history or []) + [{'role': 'user', 'content': message}, {'role': 'assistant', 'content': reply}]
        self.history = history
        return {'final_response': reply, 'messages': history, 'interrupted': self._interrupt.is_set(), 'error': None}

report = {'schema_version': '1.0', 'kind': 'installed_runtime_handlers_with_synthetic_agent', 'external_network': 'blocked', 'checks': checks}
def probe_websocket():
    import secrets
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import WebSocketRoute
    from websockets.sync.client import connect
    from tui_gateway.ws import handle_ws
    auth = secrets.token_urlsafe(24)
    async def endpoint(ws):
        if ws.headers.get('authorization') != 'Bearer ' + auth:
            await ws.close(code=1008); return
        await handle_ws(ws)
    app = Starlette(routes=[WebSocketRoute('/p11', endpoint)])
    listener = socket.socket(); listener.bind(('127.0.0.1', 0)); listener.listen(8)
    port = listener.getsockname()[1]
    owner = uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='off'))
    thread = threading.Thread(target=lambda: owner.run(sockets=[listener]), daemon=True); thread.start()
    wait_for(lambda: owner.started)
    sequence = 10000
    def receive(ws, predicate):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            frame = json.loads(ws.recv(timeout=max(.1, deadline-time.monotonic())))
            if predicate(frame): return frame
        raise AssertionError('WebSocket frame wait expired')
    def rpc(ws, method, **params):
        nonlocal sequence
        sequence += 1; rid = sequence
        ws.send(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params}))
        frame = receive(ws, lambda f: f.get('id') == rid)
        if 'error' in frame: raise AssertionError(f'{method}: {frame["error"]}')
        return frame['result']
    def attach():
        ws = connect(f'ws://127.0.0.1:{port}/p11', additional_headers={'Authorization': 'Bearer ' + auth}, open_timeout=5, proxy=None)
        receive(ws, lambda f: f.get('method') == 'event' and f.get('params', {}).get('type') == 'gateway.ready')
        rpc(ws, 'client.capabilities', server_requests=True)
        return ws
    first = second = None
    try:
        first = attach()
        slot = rpc(first, 'session.create', cwd=str(run), cwd_explicit=True, title='P11 socket only', idempotency_key='socket-' + run.name)
        live = slot['session_id']; current = server._sessions[live]
        synthetic = AskAgent(slot['stored_session_id']); current['agent'] = synthetic
        ready = threading.Event(); ready.set(); current['agent_ready'] = ready
        assert rpc(first, 'prompt.submit', session_id=live, text='ASK socket synthetic')['status'] == 'streaming'
        request = receive(first, lambda f: f.get('method') == 'clarify')
        assert rpc(first, 'prompt.submit', session_id=live, text='socket queued synthetic', queued=True)['status'] == 'queued'
        first.close(); first = None
        wait_for(lambda: not server._session_has_live_transport(current))
        second = attach()
        active = rpc(second, 'session.activate', session_id=live)
        assert any(r['id'] == request['id'] for r in active['open_requests'])
        second.send(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': {'answers': {'q1': 'A with socket condition'}}}))
        wait_for(lambda: len(synthetic.received) >= 2 and not current.get('running'))
        assert any('A with socket condition' in str(m) for m in current['history'])
        checks.append({'case': 'real_loopback_websocket_disconnect_and_resume', 'passed': True,
                       'sole_peer_detached': True, 'same_live_session': True, 'same_request': True,
                       'queued_followup_executed': True, 'owner_process_restart': 'not_tested', 'model': 'synthetic'})
    finally:
        if first: first.close()
        if second: second.close()
        owner.should_exit = True; thread.join(timeout=5); listener.close()
        if thread.is_alive(): raise AssertionError('Probe WebSocket owner did not stop')
try:
    stamp = json.loads((args.source / 'install-stamp.json').read_text())
    report['runtime'] = {k: stamp[k] for k in ['displayVersion', 'commit', 'dirty']}
    server._schedule_agent_build = lambda *a, **k: None  # no default agent/model initialization
    first = call('session.create', cwd=str(run), cwd_explicit=True, title='P11 synthetic', idempotency_key='p11-' + run.name)
    sid, stored = first['session_id'], first['stored_session_id']
    session = server._sessions[sid]
    agent = AskAgent(stored); session['agent'] = agent
    ready = threading.Event(); ready.set(); session['agent_ready'] = ready
    second = call('session.create', cwd=str(run), title='P11 other session', idempotency_key='p11-other-' + run.name)
    other = server._sessions[second['session_id']]
    other['agent'] = AskAgent(second['stored_session_id']); other['agent_ready'] = ready
    server_requests.advertise(peer, True)
    checks.append({'case': 'create_isolated_sessions', 'passed': sid != second['session_id']})
    reply = call('prompt.submit', session_id=sid, text='ASK synthetic only')
    assert reply['status'] == 'streaming'
    req = wait_for(lambda: next(iter(server_requests.open_requests(sid)), None))
    assert not other['agent'].received
    checks.append({'case': 'specified_session_and_wait', 'passed': True, 'live_session_id': sid, 'stored_session_id': stored, 'request_id': req['id']})
    busy = call('prompt.submit', session_id=sid, text='synthetic follow-up', queued=True)
    assert busy['status'] == 'queued'
    checks.append({'case': 'busy_append', 'passed': True, 'status': busy['status']})
    # New transport reattaches to the SAME live session; does not restart the owner process.
    peer = Peer(); server_requests.advertise(peer, True)
    recovered = call('session.activate', session_id=sid)
    assert any(r['id'] == req['id'] for r in recovered['open_requests'])
    checks.append({'case': 'transport_reconnect_open_request', 'passed': True, 'owner_process_restart': 'not_tested'})
    assert server_requests.resolve_response({'jsonrpc': '2.0', 'id': req['id'], 'result': {'answers': {'q1': 'A with synthetic condition'}}}, peer)
    assert not server_requests.resolve_response({'jsonrpc': '2.0', 'id': req['id'], 'result': {'answers': {'q1': 'B'}}}, peer)
    wait_for(lambda: len(agent.received) >= 2 and not session.get('running'))
    assert any('A with synthetic condition' in str(m) for m in session['history'])
    checks.append({'case': 'answer_original_task_continue_and_duplicate', 'passed': True})
    call('prompt.submit', session_id=sid, text='ASK cancel synthetic')
    req2 = wait_for(lambda: next(iter(server_requests.open_requests(sid)), None))
    cancel = call('session.interrupt', session_id=sid)
    wait_for(lambda: not session.get('running'))
    assert not server_requests.open_requests(sid)
    assert not server_requests.resolve_response({'jsonrpc': '2.0', 'id': req2['id'], 'result': {'answers': {'q1': 'late'}}}, peer)
    checks.append({'case': 'cancel_and_late_answer', 'passed': True, 'status': cancel['status']})
    token = bind_transport(peer)
    missing = server.handle_request({'jsonrpc': '2.0', 'id': 999, 'method': 'prompt.submit', 'params': {'session_id': 'p11-does-not-exist', 'text': 'synthetic'}})
    reset_transport(token)
    assert 'error' in missing
    checks.append({'case': 'missing_session_fail_closed', 'passed': True, 'code': missing['error']['code']})
    if args.websocket: probe_websocket()
    report['passed'] = True
except Exception as exc:
    report['passed'] = False
    report['error'] = f'{type(exc).__name__}: {exc}'
    import traceback
    traceback.print_exc()
finally:
    server_requests.cancel(reason='p11 probe shutdown')
    for s in list(server._sessions.values()):
        if isinstance(s.get('agent'), SyntheticHeavyAgent): s['agent'].interrupt()
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))
    # Process-only test workers/pollers must not keep the experiment alive.
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(0 if report.get('passed') else 1)
