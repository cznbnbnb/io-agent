"""Test-only installed ACP handler and actual MCP registration/tool dispatch.

Only the model conversation body is synthetic. No user home, provider or tools
other than the two operation-scoped question tools may be invoked.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading

source, packages, home = [Path(value).resolve() for value in sys.argv[1:4]]
if not (home/'.turboio-acp-question-probe').is_file() or os.environ.get('HERMES_HOME') != str(home):
    raise SystemExit('PROBE_HOME_REQUIRED')
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(packages), str(packages/'win32'), str(packages/'win32/lib')]
dll = os.add_dll_directory(str(packages/'pywin32_system32')) if os.name == 'nt' else None
loop = asyncio.new_event_loop()
# The installed MCP layer owns a second event loop. Windows creates its local
# wakeup socketpair at loop construction; initialize it before network denial.
from tools.mcp_tool_loop import _ensure_mcp_loop
_ensure_mcp_loop()
def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny

class ProbeDiagnostics(logging.Handler):
    def emit(self, record):
        if record.name == 'tools.mcp_tool':
            with (home/'probe-templates.jsonl').open('a', encoding='utf-8') as output:
                output.write(json.dumps({'function': record.funcName, 'template': str(record.msg)}) + '\n')
        if record.exc_info:
            error = record.exc_info[1]
            with (home/'probe-diagnostics.jsonl').open('a', encoding='utf-8') as output:
                output.write(json.dumps({'logger': record.name, 'function': record.funcName,
                    'type': type(error).__name__, 'module': getattr(error, 'name', None),
                    'probe_network_blocked': str(error) == 'PROBE_NETWORK_BLOCKED'}) + '\n')
logging.getLogger().addHandler(ProbeDiagnostics())
logging.getLogger('tools.mcp_tool').setLevel(logging.INFO)

from hermes_state import SessionDB
from acp_adapter.session import SessionManager
from acp_adapter.server import HermesACPAgent
import acp


class SyntheticAgent:
    model = 'synthetic-no-provider'
    enabled_toolsets = []
    disabled_toolsets = []
    def __init__(self):
        self._interrupt = threading.Event()
    def interrupt(self, *_args, **_kwargs):
        self._interrupt.set()
    def run_conversation(self, user_message, conversation_history=None, **_kwargs):
        assert user_message == 'SYNTHETIC_ASK_THEN_WAIT'
        from tools.registry import registry
        from tools.mcp_tool import _ensure_mcp_sdk
        from model_tools import get_tool_definitions, handle_function_call
        names = getattr(self, 'valid_tool_names', set())
        (home/'probe-tool-registration.json').write_text(json.dumps({'sdk_available': _ensure_mcp_sdk(),
            'registered_question_names': [name for name in registry.get_all_tool_names() if 'turboio' in name],
            'agent_valid_names': sorted(names),
            'agent_toolsets': getattr(self, 'enabled_toolsets', None)}), encoding='utf-8')
        catalog = {tool['function']['name'] for tool in get_tool_definitions(enabled_toolsets=self.enabled_toolsets,
                   disabled_toolsets=self.disabled_toolsets, quiet_mode=True, skip_tool_search_assembly=True)}
        selected = {suffix: [name for name in catalog if name.endswith('_' + suffix)] for suffix in ['ask_user', 'wait_answer']}
        assert all(len(value) == 1 for value in selected.values()), 'ACTUAL_MCP_TOOLS_MISSING'
        direct = all(value[0] in names for value in selected.values())
        assert direct or 'tool_call' in names, 'NO_GRANTED_TOOL_DISPATCH'
        (home/'observed-tool-surface.json').write_text(json.dumps({'selected': selected,
            'dispatch_mode': 'direct' if direct else 'deferred_tool_call'}), encoding='utf-8')
        calls_file = home/'synthetic-prompt-count'
        count = int(calls_file.read_text()) if calls_file.exists() else 0
        calls_file.write_text(str(count + 1), encoding='utf-8')
        def call(suffix, arguments):
            name = selected[suffix][0]
            raw = handle_function_call(name if direct else 'tool_call', arguments if direct else {'name': name, 'arguments': arguments},
                                       session_id='synthetic-acp-question', enabled_toolsets=self.enabled_toolsets, disabled_toolsets=self.disabled_toolsets)
            result = json.loads(raw) if isinstance(raw, str) else raw
            assert 'error' not in result, 'REGISTERED_TOOL_FAILED'
            content = result.get('result')
            return json.loads(content) if isinstance(content, str) else content
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace('+00:00', 'Z')
        asked = call('ask_user', {'question_key': 'synthetic-acp-confirm', 'question': 'Synthetic ACP question only?',
                                 'mode': 'free_text', 'options': [], 'expires_at': deadline})
        assert asked['state'] == 'pending'
        received = call('wait_answer', {'request_id': asked['request_id'], 'wait_seconds': 30})
        assert received['state'] == 'answered', 'ACTUAL_WAIT_DID_NOT_RECEIVE_ANSWER'
        assert received['answer']['body']['text'] == 'Synthetic ACP response only'
        (home/'synthetic-continuation.json').write_text(json.dumps({'request_id': asked['request_id'],
            'runtime_request_id': asked['runtime_request_id'], 'answer_id': received['answer']['answer_id'],
            'prompt_count': count + 1}), encoding='utf-8')
        history = list(conversation_history or []) + [{'role': 'user', 'content': user_message},
            {'role': 'assistant', 'content': 'Synthetic original call continued after answer'}]
        return {'final_response': 'Synthetic original call continued after answer', 'messages': history, 'interrupted': False}


db = SessionDB(home/'state.db')
manager = SessionManager(agent_factory=SyntheticAgent, db=db)
agent = HermesACPAgent(session_manager=manager)
# Unlike the earlier transport probe, retain the installed registration path.
try:
    loop.run_until_complete(acp.run_agent(agent, use_unstable_protocol=True))
finally:
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    shutdown_mcp_servers(timeout=3)
    manager.end_all_sessions()
    db.close()
    loop.close()
