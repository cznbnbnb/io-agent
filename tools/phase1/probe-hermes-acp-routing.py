"""Pinned installed ACP handlers, synthetic agent factory, isolated real SessionDB.

No launcher/bootstrap, provider, tools, user session, credential or network use.
This is compatibility evidence, not real-model or wire-protocol acceptance.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
source = args.source.resolve()
expected = '08165d58931841cee713468ae89032af7c57060a'
actual = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
dirty = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip()
if actual != expected or dirty:
    raise SystemExit('RUNTIME_PIN_MISMATCH')

args.output.parent.mkdir(parents=True, exist_ok=True)
private_root = args.output.parent / 'runtime-home'
private_root.mkdir(exist_ok=True)
result = {'at': datetime.now(timezone.utc).isoformat(), 'runtime_commit': actual,
          'scope': 'installed ACP handlers + real isolated SessionDB + synthetic agent factory; no model, tools, user state or wire transport',
          'network': 'blocked', 'checks': [], 'passed': False,
          'isolated_plumbing': ['MCP attachment disabled', 'session response metadata replaced with empty metadata'],
          'source_sha256': {name: hashlib.sha256((source/name).read_bytes()).hexdigest() for name in [
              'acp_adapter/server.py', 'acp_adapter/session.py', 'hermes_state.py',
              'website/docs/user-guide/features/acp.md', 'website/docs/user-guide/tui.md']}}

def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')

# Windows asyncio creates its own local socket pair while constructing a loop.
# Construct that stdlib-only loop first; all subsequent network connects fail.
event_loop = asyncio.new_event_loop()
socket.socket.connect = deny
socket.create_connection = deny
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(args.site_packages.resolve())]

with tempfile.TemporaryDirectory(prefix='p42-acp-', dir=private_root) as home:
    os.environ.update(HERMES_HOME=home, HERMES_DISABLE_LAZY_INSTALLS='1')
    try:
        from hermes_state import SessionDB
        from acp_adapter.session import SessionManager
        from acp_adapter.server import HermesACPAgent

        class SyntheticAgent:
            model = 'synthetic-no-provider'
            enabled_toolsets = []
            disabled_toolsets = []
            def __init__(self): self._interrupt = threading.Event()

        db = SessionDB(Path(home) / 'state.db')
        try:
            manager = SessionManager(agent_factory=SyntheticAgent, db=db)
            agent = HermesACPAgent(session_manager=manager)
            async def no_mcp(*_args, **_kwargs): pass
            async def no_metadata(*_args, **_kwargs): return {}
            agent._attach_session_mcp = no_mcp
            agent._session_response_fields = no_metadata
            workspace = str(Path(home) / 'workspace')
            Path(workspace).mkdir()

            async def inspect():
                before = set(manager._sessions)
                missing = 'synthetic-missing-' + uuid.uuid4().hex
                loaded = await agent.load_session(cwd=workspace, session_id=missing, mcp_servers=[])
                assert loaded is None and set(manager._sessions) == before
                result['checks'].append({'case': 'load_unknown_rejects_without_creating', 'passed': True})

                await agent.resume_session(cwd=workspace, session_id=missing, mcp_servers=[])
                created = set(manager._sessions) - before
                assert len(created) == 1 and missing not in created
                result['checks'].append({'case': 'resume_unknown_creates_new_session', 'passed': True,
                                         'allowed_for_turboio_missing_session': False})

                first = manager.create_session(cwd=workspace)
                second = manager.create_session(cwd=workspace)
                for state, text in [(first, 'synthetic first'), (second, 'synthetic second')]:
                    state.history = [{'role': 'user', 'content': text}, {'role': 'assistant', 'content': 'synthetic reply'}]
                    manager.save_session(state.session_id)
                fresh = SessionManager(agent_factory=SyntheticAgent, db=db)
                restored = fresh.get_session(first.session_id)
                assert restored.session_id == first.session_id and restored.history[0]['content'] == 'synthetic first'
                assert fresh.get_session(second.session_id).history[0]['content'] == 'synthetic second'
                result['checks'].append({'case': 'stored_acp_sessions_restore_without_crossing_history', 'passed': True,
                                         'boundary': 'new SessionManager, same isolated DB; not owner process restart'})

                foreign = 'synthetic-cli-' + uuid.uuid4().hex
                db.create_session(session_id=foreign, source='cli', model='synthetic', cwd=workspace)
                assert fresh.get_session(foreign) is None
                assert db.get_session(foreign)['source'] == 'cli'
                result['checks'].append({'case': 'acp_manager_does_not_restore_cli_session', 'passed': True,
                                         'can_replace_existing_cli_or_tui_route': False})

                assert agent._claim_turn_or_queue(first, first.session_id, 'synthetic running', 'synthetic running', True) is None
                queued = agent._claim_turn_or_queue(first, first.session_id, 'synthetic followup', 'synthetic followup', True)
                assert queued and first.queued_prompts == ['synthetic followup']
                another = SessionManager(agent_factory=SyntheticAgent, db=db).get_session(first.session_id)
                assert another.queued_prompts == []
                result['checks'].append({'case': 'busy_queue_is_memory_only_across_manager_reload', 'passed': True,
                                         'durable_followup_requires_connector_outbox': True})

                changed = str(Path(home) / 'another-workspace')
                Path(changed).mkdir()
                fresh.update_cwd(first.session_id, changed)
                assert restored.cwd == changed
                assert json.loads(db.get_session(first.session_id)['model_config'])['cwd'] == changed
                result['checks'].append({'case': 'load_update_cwd_mutates_existing_project_binding', 'passed': True,
                                         'requires_project_preflight': True})

            event_loop.run_until_complete(inspect())
            result['passed'] = True
        finally:
            db.close()
    except Exception as error:
        result['error_type'] = type(error).__name__
        # No exception text or logs: libraries can include private paths/config.
    finally:
        event_loop.close()
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': result['passed'], 'checks': len(result['checks']), 'error_type': result.get('error_type')}))
raise SystemExit(0 if result['passed'] else 1)
