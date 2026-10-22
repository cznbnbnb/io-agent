"""Real MCP stdio + two processes sharing a private runtime journal; no model."""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
module = root / 'rebuild/agent-bridge/hermes'
sys.path[:0] = [str(module), str(args.site_packages.resolve())]
if os.name == 'nt':
    sys.path[:0] = [str(args.site_packages/'win32'), str(args.site_packages/'win32/lib')]
    win_dll = os.add_dll_directory(str(args.site_packages/'pywin32_system32'))
from runtime_journal import RuntimeJournal, RuntimeJournalError
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

loop = asyncio.new_event_loop()
def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny

report = {'at': datetime.now(timezone.utc).isoformat(), 'passed': False, 'checks': [],
          'scope': 'installed MCP SDK real stdio subprocess, operation-scoped tools, private real SQLite, synthetic authenticated-queue-shaped answers supplied by test harness',
          'network': 'blocked in both Python processes after event-loop initialization',
          'not_verified': ['real Hermes Agent/model or ACP MCP attachment', 'live bridge or authenticated server answer delivery',
                           'resuming original tool stack after owner restart', 'external ACP owner exclusion', 'cloud/phone/glasses end-to-end'],
          'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [
              'rebuild/agent-bridge/hermes/question_tools.py', 'rebuild/agent-bridge/hermes/runtime_journal.py',
              'tools/phase1/probe-hermes-question-mcp.py']}}

async def run(home):
    binding = {'server_id': 'synthetic-server', 'owner_id': 'synthetic-owner', 'producer_id': 'synthetic-producer',
               'computer_id': 'synthetic-computer', 'agent_id': 'synthetic-agent'}
    source = {'kind': 'task', 'object_id': 'synthetic-task', 'revision': 1,
              'body': {'task_id': 'synthetic-task', 'revision': 1, 'state': 'queued',
                       'route': {'computer_id': binding['computer_id'], 'agent_id': binding['agent_id'],
                                 'project_id': 'synthetic-project', 'session_id': 'synthetic-session'}}}
    journal = RuntimeJournal(home/'journal.sqlite', binding)
    operation_id = 'synthetic-operation'
    journal.admit(operation_id, 'item:task:synthetic-task:1', source, {})
    journal.claim(operation_id)
    config = home/'tools.json'
    config.write_text(json.dumps({'journal': str(journal.file), 'binding': binding, 'operation_id': operation_id}), encoding='utf-8')
    runner = "import sys,asyncio,socket,os; from pathlib import Path; deps=Path(sys.argv[2]); sys.path[:0]=[sys.argv[1],str(deps),str(deps/'win32'),str(deps/'win32/lib')]; dll=os.add_dll_directory(str(deps/'pywin32_system32')) if os.name=='nt' else None; from question_tools import load_tools,serve; loop=asyncio.new_event_loop(); deny=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('PROBE_NETWORK_BLOCKED')); socket.socket.connect=deny; socket.create_connection=deny; tools=load_tools(os.environ['TURBOIO_QUESTION_CONFIG']); loop.run_until_complete(serve(tools))"
    params = StdioServerParameters(command=sys.executable,
        args=['-I', '-S', '-B', '-c', runner, str(module), str(args.site_packages.resolve())],
        env={'TURBOIO_QUESTION_CONFIG': str(config)})
    def checked(name):
        report['checks'].append({'case': name, 'passed': True})
    def decoded(result):
        assert not result.is_error, result
        return json.loads(result.content[0].text)
    request_id = None
    try:
        with open(os.devnull, 'w') as errlog:
            async with stdio_client(params, errlog=errlog) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    assert {tool.name for tool in listed.tools} == {'ask_user', 'wait_answer'}
                    checked('real stdio initialize and only two scoped tools exposed')
                    deadline = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat().replace('+00:00', 'Z')
                    arguments = {'question_key': 'synthetic-confirm', 'question': 'Synthetic only?', 'mode': 'free_text', 'options': [], 'expires_at': deadline}
                    asked = decoded(await session.call_tool('ask_user', arguments))
                    request_id = asked['request_id']
                    assert asked['state'] == 'pending'
                    event = journal.events()[0]
                    assert event['actions'][0]['request_id'] == request_id and event['delivery_id'] == 'item:task:synthetic-task:1'
                    checked('MCP question and original delivery event durably visible to another process')
                    replay = decoded(await session.call_tool('ask_user', arguments))
                    assert replay['request_id'] == request_id and len(journal.events()) == 1
                    checked('same-key tool replay creates no second question or event')
                    forged = await session.call_tool('ask_user', {**arguments, 'operation_id': 'another-operation'})
                    assert forged.is_error
                    injected = await session.call_tool('record_answer', {})
                    assert injected.is_error
                    checked('model cannot choose another operation or inject an answer')
                    wait = asyncio.create_task(session.call_tool('wait_answer', {'request_id': request_id, 'wait_seconds': 5}))
                    await asyncio.sleep(0.2)
                    assert not wait.done()
                    spec = event['actions'][0]
                    request = {'kind': 'request', 'object_id': request_id, 'revision': 1,
                               'body': {'request_id': request_id, 'revision': 1, 'task_id': source['body']['task_id'], 'route': source['body']['route'],
                                        'state': 'answered', **{key: spec[key] for key in ['question', 'mode', 'options', 'runtime_request_id']}}}
                    answer = {'kind': 'answer', 'object_id': 'synthetic-answer', 'revision': 1,
                              'stored_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                              'body': {'answer_id': 'synthetic-answer', 'request_id': request_id, 'request_revision': 1,
                                       'task_id': source['body']['task_id'], 'route': source['body']['route'], 'option_id': None,
                                       'text': 'Synthetic response only', 'input_source': 'voice', 'raw_action': None}}
                    assert journal.record_answer(operation_id, request, answer)
                    received = decoded(await wait)
                    assert received['state'] == 'answered' and received['answer']['body']['text'] == 'Synthetic response only'
                    checked('actual in-flight tool wait wakes after adapter-side durable answer write')
            # SDK stdio context exited; restart a new server process, not a new
            # Agent run. Recovery is rereading a stored answer, not wait-stack recovery.
            async with stdio_client(params, errlog=errlog) as (read, write):
                async with ClientSession(read, write) as restarted:
                    await restarted.initialize()
                    again = decoded(await restarted.call_tool('wait_answer', {'request_id': request_id, 'wait_seconds': 0}))
                    assert again == received
                    checked('new MCP process reads the same answer without rerunning the operation')
                    missing = await restarted.call_tool('wait_answer', {'request_id': 'not-this-operation', 'wait_seconds': 0})
                    assert missing.is_error
                    checked('unknown request fails without touching the original answer')
        resumes = [item for item in journal.events() if any(action.get('stage') == 'task_resumed' for action in item['actions'])]
        assert len(resumes) == 1
        checked('actual wait consumption emits one durable task-resumed fact across tool process restart')
        journal.acknowledge([item['event_id'] for item in journal.events()])
        assert journal.events() == []
        assert journal.reply(operation_id, request_id)['answer']['answer_id'] == 'synthetic-answer'
        checked('bridge-style event ACK does not erase stored question or answer')
    finally:
        journal.close()

try:
    private = root/'rebuild/phase1/runtime-home'
    private.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='p42-question-mcp-', dir=private) as temporary:
        loop.run_until_complete(asyncio.wait_for(run(Path(temporary)), timeout=40))
    report['passed'] = True
except BaseException as error:
    report['error_type'] = type(error).__name__
    raise
finally:
    loop.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'checks': len(report['checks'])}))
