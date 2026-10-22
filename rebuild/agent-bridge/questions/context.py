"""Pinned caller context for an already-running agent; never launches an agent."""
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'hermes'))
from managed_home import private_json
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode


def require(value, code):
    if not value:
        raise RuntimeJournalError(code)


def load_context(file, readonly=False):
    config = private_json(Path(file))
    require(isinstance(config, dict) and set(config) == {'schema', 'runtime', 'caller', 'journal', 'binding', 'route', 'task_id', 'operation_id'}, 'CALLER_CONFIG_INVALID')
    caller, route = config['caller'], config['route']
    require(config['schema'] == 1 and config['runtime'] == 'codex' and isinstance(caller, dict) and set(caller) == {'session_id', 'cwd'}, 'CALLER_CONFIG_INVALID')
    session = os.environ.get('CODEX_THREAD_ID', '')
    require(bool(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', session)) and caller['session_id'] == session, 'CALLER_SESSION_MISMATCH')
    require(isinstance(caller['cwd'], str) and Path(caller['cwd']).is_absolute() and os.path.normcase(str(Path(caller['cwd']).resolve(strict=True))) == os.path.normcase(str(Path.cwd().resolve(strict=True))), 'CALLER_PROJECT_MISMATCH')
    require(isinstance(route, dict) and set(route) == {'computer_id', 'agent_id', 'project_id', 'session_id'} and route['session_id'] == session, 'CALLER_ROUTE_MISMATCH')
    require(isinstance(config['journal'], str) and Path(config['journal']).is_absolute(), 'CALLER_CONFIG_INVALID')
    journal = RuntimeJournal.open_readonly(config['journal'], config['binding']) if readonly else RuntimeJournal(config['journal'], config['binding'])
    return config, journal


def operation(config, journal, allow_cancel_requested=False):
    value = journal.operation(config['operation_id'])
    require(value is not None and value['state'] == 'claimed', 'RUNTIME_OPERATION_NOT_ACTIVE')
    import json
    source = json.loads(value['source'])
    require(source['object_id'] == config['task_id'] and source['kind'] == 'task' and source['body']['route'] == config['route'], 'CALLER_OPERATION_MISMATCH')
    require(allow_cancel_requested or not journal.cancellation_requested(config['operation_id']), 'CALLER_CANCEL_REQUESTED')
    return value
