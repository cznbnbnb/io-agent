"""Actual installed ACP SDK stdio and Hermes handlers; synthetic Agent only."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from contextlib import closing

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
source = args.source.resolve()
expected = '08165d58931841cee713468ae89032af7c57060a'
head = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
dirty = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip()
if head != expected or dirty:
    raise SystemExit('RUNTIME_PIN_MISMATCH')
root = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(args.site_packages.resolve()), str(root / 'rebuild/agent-bridge/hermes')]
args.output.parent.mkdir(parents=True, exist_ok=True)
private = args.output.parent / 'runtime-home'
private.mkdir(exist_ok=True)
report = {'at': datetime.now(timezone.utc).isoformat(), 'runtime_commit': head,
          'scope': 'actual installed ACP SDK stdio + installed Hermes server/session + isolated real SQLite + synthetic Agent; no model, tools, MCP attachment or user state',
          'network': 'blocked after stdlib event-loop socketpair initialization', 'checks': [], 'passed': False,
          'source_sha256': {name: hashlib.sha256((source/name).read_bytes()).hexdigest() for name in [
              'acp_adapter/server.py', 'acp_adapter/session.py']},
          'project_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in [
              'rebuild/agent-bridge/hermes/acp_transport.py', 'tools/phase1/hermes-acp-wire-fixture.py']}}
loop = asyncio.new_event_loop()
def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny
from acp_transport import HermesACPTransport, ACPTransportError

async def run(home):
    workspace = home / 'workspace'
    workspace.mkdir()
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1')
    from hermes_state import SessionDB
    db = SessionDB(home / 'state.db')
    try:
        for sid, origin in [('synthetic-acp', 'acp'), ('synthetic-cli', 'cli')]:
            db.create_session(session_id=sid, source=origin, cwd=str(workspace), model_config={'cwd': str(workspace)})
    finally:
        db.close()
    (home / '.turboio-acp-wire-probe').write_text('synthetic', encoding='utf-8')
    sessions = {sid: {'project_id': 'synthetic-project', 'cwd': str(workspace)} for sid in
                ['synthetic-acp', 'synthetic-cli', 'synthetic-missing']}
    updates = []
    async def update(sid, message):
        updates.append((sid, message.model_dump(mode='json', by_alias=True)))
    environment = {'HERMES_HOME': str(home), 'HERMES_DISABLE_LAZY_INSTALLS': '1'}
    command = [sys.executable, '-I', '-S', '-B', str(root / 'tools/phase1/hermes-acp-wire-fixture.py'),
               str(source), str(args.site_packages.resolve()), str(home)]
    transport = HermesACPTransport(command=command, environment=environment, home=home, sessions=sessions, on_update=update)
    def checked(name, **detail):
        report['checks'].append({'case': name, 'passed': True, **detail})
    async def refused(call, code):
        try:
            await call()
        except ACPTransportError as error:
            assert error.code == code
        else:
            raise AssertionError('EXPECTED_REFUSAL')
    try:
        capabilities = await transport.start()
        assert capabilities['strict_load'] and capabilities['task_completion_evidence'] is False
        checked('real_stdio_initialize_negotiates_installed_protocol')
        permission = await transport.request_permission(session_id='synthetic-acp', options=[], tool_call={})
        assert permission.outcome.outcome == 'cancelled'
        checked('unwired_permission_request_is_never_auto_approved')
        await refused(lambda: transport.strict_load('unregistered', 'synthetic-project'), 'ACP_SESSION_UNREGISTERED')
        await refused(lambda: transport.strict_load('synthetic-missing', 'synthetic-project'), 'ACP_SESSION_NOT_FOUND')
        await refused(lambda: transport.strict_load('synthetic-cli', 'synthetic-project'), 'ACP_SESSION_SOURCE_UNSUPPORTED')
        await refused(lambda: transport.strict_load('synthetic-acp', 'wrong-project'), 'ACP_PROJECT_MISMATCH')
        checked('strict_preflight_refuses_unknown_cli_and_wrong_project_before_load')
        await transport.strict_load('synthetic-acp', 'synthetic-project')
        outcome = await asyncio.wait_for(transport.prompt('synthetic-acp', 'synthetic-project', 'SYNTHETIC_NORMAL'), 10)
        assert outcome['stop_reason'] == 'end_turn' and not outcome['completion_verified']
        # SDK notifications have their own dispatcher; receiving the response
        # does not imply the host's update callback has already run.
        for _ in range(100):
            if any(sid == 'synthetic-acp' and value.get('sessionUpdate') == 'agent_message_chunk' for sid, value in updates):
                break
            await asyncio.sleep(.02)
        assert any(sid == 'synthetic-acp' and value.get('sessionUpdate') == 'agent_message_chunk' for sid, value in updates)
        checked('real_stdio_load_prompt_and_updates_stay_on_registered_session', real_model=False)
        failure = await asyncio.wait_for(transport.prompt('synthetic-acp', 'synthetic-project', 'SYNTHETIC_FAIL'), 10)
        assert failure['stop_reason'] == 'end_turn' and failure['task_completed'] is False
        checked('native_execution_exception_returns_end_turn_without_proving_task_success')
        pending = asyncio.create_task(transport.prompt('synthetic-acp', 'synthetic-project', 'SYNTHETIC_WAIT'))
        for _ in range(100):
            if (home / 'synthetic-wait-started').is_file():
                break
            await asyncio.sleep(.02)
        assert (home / 'synthetic-wait-started').is_file()
        await refused(lambda: transport.prompt('synthetic-acp', 'synthetic-project', 'SYNTHETIC_BUSY'), 'ACP_SESSION_BUSY')
        checked('transport_rejects_second_turn_instead_of_treating_queue_admission_as_completion')
        from acp.schema import TextContentBlock
        native_queued = await asyncio.wait_for(transport._connection.prompt(session_id='synthetic-acp',
            prompt=[TextContentBlock(type='text', text='SYNTHETIC_QUEUED')]), 5)
        assert native_queued.stop_reason == 'end_turn' and not pending.done()
        checked('native_busy_queue_returns_end_turn_while_original_turn_is_still_running')
        cancellation = await transport.cancel('synthetic-acp')
        assert cancellation == {'cancel_requested': True, 'cancelled': False}
        ended = await asyncio.wait_for(pending, 10)
        assert ended['stop_reason'] == 'cancelled' and ended['cancellation_observed'] and not ended['task_completed']
        checked('cancel_notification_and_observed_turn_end_are_separate_facts')
    finally:
        await transport.close()
    assert transport.process.returncode is not None
    checked('owned_stdio_child_exit_is_confirmed')
    with closing(sqlite3.connect((home / 'state.db').as_uri() + '?mode=ro', uri=True)) as db:
        rows = db.execute('SELECT id FROM sessions').fetchall()
    assert {row[0] for row in rows} == {'synthetic-acp', 'synthetic-cli'}
    checked('unknown_route_tests_created_no_replacement_session')

try:
    with tempfile.TemporaryDirectory(prefix='p42-acp-wire-', dir=private) as temporary:
        loop.run_until_complete(asyncio.wait_for(run(Path(temporary).resolve()), 50))
    report['passed'] = True
except Exception as error:
    report['error_type'] = type(error).__name__
    if isinstance(error, PermissionError) and error.filename:
        report['cleanup_file'] = Path(error.filename).name
finally:
    loop.close()
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': report['passed'], 'checks': len(report['checks']), 'error_type': report.get('error_type')}))
raise SystemExit(0 if report['passed'] else 1)
