"""Test-only installed Hermes ACP server with synthetic, tool-free Agent body."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading

source, packages, home = [Path(value).resolve() for value in sys.argv[1:4]]
if not (home / '.turboio-acp-wire-probe').is_file() or os.environ.get('HERMES_HOME') != str(home):
    raise SystemExit('PROBE_HOME_REQUIRED')
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(packages)]
loop = asyncio.new_event_loop()
def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny
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
        if user_message == 'SYNTHETIC_FAIL':
            raise RuntimeError('synthetic execution failure')
        if user_message == 'SYNTHETIC_WAIT':
            (home / 'synthetic-wait-started').write_text('synthetic', encoding='utf-8')
            assert self._interrupt.wait(15)
        history = list(conversation_history or []) + [
            {'role': 'user', 'content': user_message}, {'role': 'assistant', 'content': 'synthetic response'}]
        return {'final_response': 'synthetic response', 'messages': history, 'interrupted': self._interrupt.is_set()}

db = SessionDB(home / 'state.db')
manager = SessionManager(agent_factory=SyntheticAgent, db=db)
agent = HermesACPAgent(session_manager=manager)
async def no_mcp(*_args, **_kwargs):
    pass
agent._attach_session_mcp = no_mcp
try:
    loop.run_until_complete(acp.run_agent(agent, use_unstable_protocol=True))
finally:
    manager.end_all_sessions()
    db.close()
    loop.close()
