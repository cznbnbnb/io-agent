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


# Hosts that put their own conversation id into every command they run (mirrors cli.mjs).
# Any other agent's host sets IO_AGENT_CALLER_RUNTIME/IO_AGENT_CALLER_SESSION; more than one source is refused.
NATIVE = {'codex': ('CODEX_THREAD_ID', 'Codex'), 'claude-code': ('CLAUDE_CODE_SESSION_ID', 'Claude Code')}


def caller_session(environ=None):
    environ = os.environ if environ is None else environ
    found = [(runtime, environ[name]) for runtime, (name, _) in NATIVE.items() if environ.get(name)]
    if environ.get('IO_AGENT_CALLER_RUNTIME') or environ.get('IO_AGENT_CALLER_SESSION'):
        runtime = environ.get('IO_AGENT_CALLER_RUNTIME', '')
        require(runtime not in NATIVE, 'CALLER_RUNTIME_INVALID')
        found.append((runtime, environ.get('IO_AGENT_CALLER_SESSION', '')))
    require(len(found) == 1, 'CALLER_RUNTIME_AMBIGUOUS' if found else 'CALLER_SESSION_REQUIRED')
    runtime, session = found[0]
    require(re.fullmatch(r'[a-z][a-z0-9-]{1,31}', runtime) and re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', session), 'CALLER_SESSION_REQUIRED')
    return runtime, session


def task_command(runtime):
    return 'Continue the already-running registered ' + NATIVE.get(runtime, (None, runtime))[1] + ' task.'


def registered_command(config):
    return config.get('command') or task_command(config['runtime'])


def load_context(file, readonly=False):
    config = private_json(Path(file))
    keys = {'schema', 'runtime', 'caller', 'journal', 'binding', 'route', 'task_id', 'operation_id'}
    # 'command' is present only when the host registered a conversation topic (cli.mjs topicValid).
    require(isinstance(config, dict) and set(config) in (keys, keys | {'command'}), 'CALLER_CONFIG_INVALID')
    require('command' not in config or (isinstance(config['command'], str) and 1 <= len(config['command']) <= 40 and config['command'].isprintable()), 'CALLER_CONFIG_INVALID')
    caller, route = config['caller'], config['route']
    require(config['schema'] == 1 and isinstance(config['runtime'], str) and isinstance(caller, dict) and set(caller) == {'session_id', 'cwd'}, 'CALLER_CONFIG_INVALID')
    runtime, session = caller_session()
    require(config['runtime'] == runtime and caller['session_id'] == session, 'CALLER_SESSION_MISMATCH')
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
