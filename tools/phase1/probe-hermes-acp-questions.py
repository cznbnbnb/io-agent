"""Actual ACP stdio -> installed Hermes MCP registration -> question wait."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--tool-search', choices=['default', 'off'], default='default')
args = p.parse_args()
source, packages = args.source.resolve(), args.site_packages.resolve()
root = Path(__file__).resolve().parents[2]
module = root/'rebuild/agent-bridge/hermes'
expected = '08165d58931841cee713468ae89032af7c57060a'
head = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], check=True, capture_output=True, text=True).stdout.strip()
if head != expected or dirty:
    raise SystemExit('RUNTIME_PIN_MISMATCH')
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(packages), str(module), str(packages/'win32'), str(packages/'win32/lib')]
dll = os.add_dll_directory(str(packages/'pywin32_system32')) if os.name == 'nt' else None
loop = asyncio.new_event_loop()
def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny
from acp.schema import McpServerStdio, EnvVariable
from acp_transport import HermesACPTransport
from runtime_journal import RuntimeJournal
from process_job import WindowsProcessJob
from hermes_state import SessionDB

report = {'at': datetime.now(timezone.utc).isoformat(), 'passed': False, 'runtime_commit': head, 'tool_search': args.tool_search, 'checks': [],
          'scope': 'actual installed ACP stdio handlers, actual Hermes MCP registration/tool registry/dispatcher, actual MCP question stdio child, private SQLite; synthetic Agent body and queue-shaped answer only',
          'not_verified': ['real model/provider', 'authenticated server or bridge answer transport', 'production runtime owner fencing',
                           'original wait stack after Agent owner restart', 'CLI/TUI original task attachment', 'cloud/phone/glasses end-to-end'],
          'project_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [
              'rebuild/agent-bridge/hermes/acp_transport.py', 'rebuild/agent-bridge/hermes/question_tools.py',
              'rebuild/agent-bridge/hermes/process_job.py',
              'rebuild/agent-bridge/hermes/runtime_journal.py', 'tools/phase1/hermes-acp-question-fixture.py',
              'tools/phase1/probe-hermes-acp-questions.py']},
          'runtime_sha256': {name: hashlib.sha256((source/name).read_bytes()).hexdigest() for name in [
              'acp_adapter/server.py', 'tools/mcp_tool_discovery.py', 'tools/mcp_tool_handlers.py']}}

async def run(home):
    (home/'.turboio-acp-question-probe').write_text('synthetic', encoding='utf-8')
    (home/'config.yaml').write_text('tools:\n  tool_search:\n    enabled: off\n' if args.tool_search == 'off' else '{}\n', encoding='utf-8')
    workspace = home/'workspace'
    workspace.mkdir()
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1')
    db = SessionDB(home/'state.db')
    try:
        db.create_session(session_id='synthetic-acp-question', source='acp', cwd=str(workspace), model_config={'cwd': str(workspace)})
    finally:
        db.close()
    binding = {'server_id': 'synthetic-server', 'owner_id': 'synthetic-owner', 'producer_id': 'synthetic-producer',
               'computer_id': 'synthetic-computer', 'agent_id': 'synthetic-agent'}
    origin = {'kind': 'task', 'object_id': 'synthetic-task', 'revision': 1,
              'body': {'task_id': 'synthetic-task', 'revision': 1, 'state': 'queued',
                       'route': {'computer_id': binding['computer_id'], 'agent_id': binding['agent_id'],
                                 'project_id': 'synthetic-project', 'session_id': 'synthetic-acp-question'}}}
    journal = RuntimeJournal(home/'journal.sqlite', binding)
    operation_id = 'synthetic-operation'
    journal.admit(operation_id, 'item:task:synthetic-task:1', origin, {})
    journal.claim(operation_id)
    config = home/'question-tools.json'
    config.write_text(json.dumps({'journal': str(journal.file), 'binding': binding, 'operation_id': operation_id}), encoding='utf-8')
    runner = "import sys,asyncio,socket,os; from pathlib import Path; deps=Path(sys.argv[2]); sys.path[:0]=[sys.argv[1],str(deps),str(deps/'win32'),str(deps/'win32/lib')]; dll=os.add_dll_directory(str(deps/'pywin32_system32')) if os.name=='nt' else None; from question_tools import load_tools,serve; loop=asyncio.new_event_loop(); deny=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('PROBE_NETWORK_BLOCKED')); socket.socket.connect=deny; socket.create_connection=deny; tools=load_tools(os.environ['TURBOIO_QUESTION_CONFIG']); loop.run_until_complete(serve(tools))"
    tool_server = McpServerStdio(name='turboio_question_synthetic', command=sys.executable,
        args=['-I', '-S', '-B', '-c', runner, str(module), str(packages)],
        env=[EnvVariable(name='TURBOIO_QUESTION_CONFIG', value=str(config))])
    transport = HermesACPTransport(command=[sys.executable, '-I', '-S', '-B', str(root/'tools/phase1/hermes-acp-question-fixture.py'),
        str(source), str(packages), str(home)], environment={'HERMES_HOME': str(home), 'HERMES_DISABLE_LAZY_INSTALLS': '1'},
        home=home, sessions={'synthetic-acp-question': {'project_id': 'synthetic-project', 'cwd': str(workspace)}}, timeout=30,
        process_job=WindowsProcessJob())
    def checked(case):
        report['checks'].append({'case': case, 'passed': True})
    task = None
    try:
        await transport.start()
        await transport.strict_load('synthetic-acp-question', 'synthetic-project', mcp_servers=[tool_server])
        checked('actual ACP load carries stdio MCP configuration through installed Hermes handler')
        task = asyncio.create_task(transport.prompt('synthetic-acp-question', 'synthetic-project', 'SYNTHETIC_ASK_THEN_WAIT'))
        for _ in range(200):
            events = journal.events()
            if events:
                break
            if task.done():
                diagnostics = home/'probe-diagnostics.jsonl'
                report['diagnostics'] = [json.loads(line) for line in diagnostics.read_text(encoding='utf-8').splitlines()] if diagnostics.exists() else []
                surface = home/'observed-tool-surface.json'
                report['observed_tool_surface'] = json.loads(surface.read_text(encoding='utf-8')) if surface.exists() else None
                registered = home/'probe-tool-registration.json'
                report['tool_registration'] = json.loads(registered.read_text(encoding='utf-8')) if registered.exists() else None
                templates = home/'probe-templates.jsonl'
                report['log_templates'] = [json.loads(line) for line in templates.read_text(encoding='utf-8').splitlines()][-20:] if templates.exists() else []
                raise AssertionError('ACP_FINISHED_WITHOUT_DURABLE_QUESTION')
            await asyncio.sleep(0.1)
        assert events, 'NO_DURABLE_QUESTION'
        observed = json.loads((home/'observed-tool-surface.json').read_text(encoding='utf-8'))
        assert all(len(names) == 1 for names in observed['selected'].values())
        report['dispatch_mode'] = observed['dispatch_mode']
        checked('actual Agent grant exposes one scoped ask and wait through the model tool dispatcher, not merely load RPC success')
        assert len(events) == 1 and not task.done()
        action = events[0]['actions'][0]
        assert events[0]['delivery_id'] == 'item:task:synthetic-task:1'
        checked('installed Hermes registry dispatch creates question in original delivery and keeps prompt active')
        assert transport.process_job.active_count() >= 2
        checked('actual ACP leader and its MCP tool process belong to the same OS containment job')
        request = {'kind': 'request', 'object_id': action['request_id'], 'revision': 1,
                   'body': {'request_id': action['request_id'], 'revision': 1, 'task_id': 'synthetic-task', 'route': origin['body']['route'],
                            **{key: action[key] for key in ['question', 'mode', 'options', 'runtime_request_id']}}}
        answer = {'kind': 'answer', 'object_id': 'synthetic-answer', 'revision': 1,
                  'stored_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                  'body': {'answer_id': 'synthetic-answer', 'request_id': action['request_id'], 'request_revision': 1,
                           'task_id': 'synthetic-task', 'route': origin['body']['route'], 'option_id': None,
                           'text': 'Synthetic ACP response only', 'input_source': 'voice', 'raw_action': None}}
        assert journal.record_answer(operation_id, request, answer)
        checked('adapter-side answer recorded durably with original task/session/runtime request binding')
        result = await asyncio.wait_for(task, timeout=15)
        continued = json.loads((home/'synthetic-continuation.json').read_text(encoding='utf-8'))
        assert continued == {'request_id': action['request_id'], 'runtime_request_id': action['runtime_request_id'], 'answer_id': 'synthetic-answer', 'prompt_count': 1}
        assert (home/'synthetic-prompt-count').read_text() == '1'
        checked('same in-flight Hermes synthetic conversation continues after real MCP wait; no second prompt')
        assert result['stop_reason'] == 'end_turn' and not result['task_completed'] and not result['completion_verified']
        checked('turn end still does not produce an unverified task-complete claim')
    finally:
        if task is not None and not task.done():
            await transport.cancel('synthetic-acp-question')
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await transport.close()
        journal.close()
    assert transport.process.returncode is not None
    assert transport.process_job.handle is None
    checked('ACP owner process exit confirmed and private tool server cleaned up')
    persisted = SessionDB(home/'state.db')
    try:
        history = persisted.get_messages_as_conversation('synthetic-acp-question', repair_alternation=True)
        assert len([item for item in history if item['role'] == 'user']) == 1
        assert history[-1]['role'] == 'assistant' and history[-1]['content'] == 'Synthetic original call continued after answer'
    finally:
        persisted.close()
    checked('original stored ACP session contains one user prompt and the post-answer assistant continuation')

try:
    private = root/'rebuild/phase1/runtime-home'
    private.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='p42-acp-question-', dir=private) as temporary:
        loop.run_until_complete(asyncio.wait_for(run(Path(temporary)), timeout=65))
    report['passed'] = True
except BaseException as error:
    report['error_type'] = type(error).__name__
    raise
finally:
    loop.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'checks': len(report['checks'])}))
