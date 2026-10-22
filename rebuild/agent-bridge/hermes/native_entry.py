"""Pinned Hermes ACP child, observed without modifying installed source."""
import asyncio
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from managed_home import private_json
from runtime_journal import RuntimeJournal, RuntimeJournalError
from native_observer import wrap_agent
from pinned_runtime import verify_source
from restricted_profile import read_policy, enforce_question_tools, CLI_POLICY
from runtime_environment import require_enrollment_ready


def serve_native(config, agent_factory=None, deny_network=False):
    source = verify_source(config['source'])
    packages = Path(config['site_packages']).resolve(strict=True)
    home = Path(config['home']).resolve(strict=True)
    if os.environ.get('HERMES_HOME') != str(home):
        raise RuntimeJournalError('RUNTIME_HOME_MISMATCH')
    marker = private_json(home / '.turboio-managed.json')
    if marker != {'schema': 1, 'binding': config['binding'], 'sessions': config['sessions']}:
        raise RuntimeJournalError('RUNTIME_HOME_BINDING_MISMATCH')
    policy = read_policy(home)
    require_enrollment_ready(home, config['sessions'])
    sys.path[:0] = [str(source), str(packages), str(packages/'win32'), str(packages/'win32/lib')]
    dll = os.add_dll_directory(str(packages/'pywin32_system32')) if os.name == 'nt' else None
    loop = asyncio.new_event_loop()
    if deny_network:
        import socket
        from tools.mcp_tool_loop import _ensure_mcp_loop
        _ensure_mcp_loop()
        def deny(*args, **kwargs):
            raise RuntimeError('SYNTHETIC_RUNTIME_NETWORK_BLOCKED')
        socket.socket.connect = deny
        socket.create_connection = deny
    from acp_adapter.entry import _setup_logging, _load_env
    _setup_logging()
    _load_env()
    from acp_adapter.session import SessionManager
    from acp_adapter.server import HermesACPAgent
    from hermes_state import SessionDB
    import acp
    journal = RuntimeJournal(config['journal'], config['binding'])
    operation = journal.operation(config['operation_id'])
    if operation is None or operation['state'] != 'claimed':
        raise RuntimeJournalError('RUNTIME_OPERATION_NOT_ACTIVE')
    class ObservedManager(SessionManager):
        def _make_agent(self, **kwargs):
            if kwargs.get('session_id') != config['session_id']:
                raise RuntimeJournalError('RUNTIME_SESSION_UNREGISTERED')
            if policy:
                if policy==CLI_POLICY:
                    from cli_tools import register, TOOLSET
                    questions=home/'.turboio-operations'/(config['operation_id']+'.questions.json')
                    register(questions,config['session_id'])
                    kwargs['enabled_toolsets'] = [TOOLSET]
                else:
                    kwargs['enabled_toolsets'] = []
                kwargs['disabled_toolsets'] = []
            agent = wrap_agent(super()._make_agent(**kwargs), journal, config['operation_id'])
            if policy:
                original = agent.run_conversation
                def restricted_run(*args, **run_kwargs):
                    enforce_question_tools(agent,policy)
                    return original(*args, **run_kwargs)
                agent.run_conversation = restricted_run
            return agent
    db = SessionDB(home/'state.db')
    manager = ObservedManager(agent_factory=agent_factory, db=db)
    try:
        loop.run_until_complete(acp.run_agent(HermesACPAgent(session_manager=manager), use_unstable_protocol=True))
    finally:
        from tools.mcp_tool_lifecycle import shutdown_mcp_servers
        shutdown_mcp_servers(timeout=3)
        manager.end_all_sessions()
        db.close()
        journal.close()
        loop.close()
        if dll:
            dll.close()


if __name__ == '__main__':
    try:
        serve_native(private_json(os.environ['TURBOIO_RUNTIME_CONFIG']))
    except Exception:
        raise SystemExit(2)
