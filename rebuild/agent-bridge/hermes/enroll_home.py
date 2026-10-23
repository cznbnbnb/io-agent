"""Prepare a NEW exclusive Hermes home and an explicit existing ACP session.

No task dispatch, model call, dependency install or mutation of the source home.
Provider import is explicit and limited to one selected HTTPS custom provider.
CLI errors contain codes only, never provider values or paths.
"""
import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from managed_home import private_json, ManagedHomeLease
from pinned_runtime import verify_source
from restricted_profile import CLI_POLICIES
from runtime_journal import RuntimeJournalError, encode
from runtime_environment import managed_environment
from urllib.parse import urlsplit


def limited_provider(config, provider_name, model):
    if (not isinstance(config, dict) or not isinstance(provider_name, str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', provider_name)
            or not isinstance(model, str) or not model or len(model) > 128):
        raise RuntimeJournalError('ENROLL_PROVIDER_INVALID')
    choices = [item for item in config.get('custom_providers', [])
               if isinstance(item, dict) and item.get('name') == provider_name]
    if len(choices) != 1:
        raise RuntimeJournalError('ENROLL_PROVIDER_NOT_UNIQUE')
    selected = choices[0]
    endpoint = selected.get('base_url')
    try:
        parsed = urlsplit(endpoint)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise ValueError()
        parsed.port
    except Exception:
        raise RuntimeJournalError('ENROLL_PROVIDER_HTTPS_REQUIRED') from None
    key = selected.get('api_key')
    mode = selected.get('api_mode')
    if (not isinstance(key, str) or not key or len(key) > 8192
            or key.startswith('${') or '\n' in key or '\r' in key
            or mode not in {'chat_completions', 'anthropic_messages', 'codex_responses'}):
        raise RuntimeJournalError('ENROLL_PROVIDER_CREDENTIAL_UNSUPPORTED')
    # No auth.json/.env, hooks, skills, plugins, other providers or histories.
    return {'model': {'default': model, 'provider': 'custom:' + provider_name,
                      'base_url': endpoint},
            'custom_providers': [{name: selected[name] for name in
                                 ['name', 'base_url', 'api_key', 'api_mode']}],
            'platform_toolsets': {'acp': []}, 'mcp_servers': {},
            'tools': {'tool_search': {'enabled': 'off'}},
            'memory': {'memory_enabled': False, 'user_profile_enabled': False,
                       'provider': 'none'},
            'agent': {'max_turns': 8, 'api_max_retries': 0,
                      'verify_on_stop': False}}


def protect_directory(directory):
    if os.name != 'nt':
        os.chmod(directory, 0o700)
        return
    proc = subprocess.run(['whoami', '/user', '/fo', 'csv', '/nh'],
        capture_output=True, text=True, check=True, timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW)
    rows = list(csv.reader(io.StringIO(proc.stdout)))
    sid = rows[0][-1] if len(rows) == 1 else ''
    if not re.fullmatch(r'S-1-5-(?:\d+-)*\d+', sid):
        raise RuntimeJournalError('ENROLL_PRIVATE_ACL_FAILED')
    result = subprocess.run(['icacls', str(directory), '/inheritance:r', '/grant:r',
        '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
        capture_output=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeJournalError('ENROLL_PRIVATE_ACL_FAILED')


def write_new(file, value):
    fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(encode(value) + '\n')
        output.flush()
        os.fsync(output.fileno())


def enroll(spec):
    fields = {'home', 'binding', 'project_id', 'cwd', 'source', 'site_packages',
              'provider_config', 'provider_name', 'model'}
    if not isinstance(spec, dict) or set(spec) - {'profile'} != fields:
        raise RuntimeJournalError('ENROLL_SPEC_INVALID')
    # The question-only profile stays the default; wider tools must be named.
    profiles = {item['profile']: item for item in CLI_POLICIES}
    policy = profiles.get(spec.get('profile', 'io-question-cli-v1'))
    if policy is None:
        raise RuntimeJournalError('ENROLL_PROFILE_INVALID')
    for name in ['home', 'cwd', 'source', 'site_packages', 'provider_config']:
        if not isinstance(spec[name], str) or not Path(spec[name]).is_absolute():
            raise RuntimeJournalError('ENROLL_PATH_INVALID')
    if (not isinstance(spec['project_id'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', spec['project_id'])
            or not isinstance(spec['binding'], dict)
            or set(spec['binding']) != {'server_id','owner_id','producer_id','computer_id','agent_id'}
            or any(not isinstance(v, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', v) for v in spec['binding'].values())):
        raise RuntimeJournalError('ENROLL_BINDING_INVALID')
    home = Path(spec['home']).absolute()
    if home.exists() or home.is_symlink():
        raise RuntimeJournalError('ENROLL_HOME_ALREADY_EXISTS')
    # Reject parent links and only use an existing parent explicitly selected by
    # the operator. Never create an arbitrary tree or adopt a user's normal home.
    if str(home.parent.resolve(strict=True)) != str(home.parent):
        raise RuntimeJournalError('ENROLL_PARENT_UNSAFE')
    source = verify_source(spec['source'])
    packages = Path(spec['site_packages']).resolve(strict=True)
    cwd = Path(spec['cwd']).resolve(strict=True)
    if not cwd.is_dir() or not packages.is_dir():
        raise RuntimeJournalError('ENROLL_PATH_INVALID')
    original_config = Path(spec['provider_config']).resolve(strict=True)
    if original_config.stat().st_size > 1048576:
        raise RuntimeJournalError('ENROLL_PROVIDER_CONFIG_TOO_LARGE')
    # Existing official bootstrap activates already-installed base dependencies.
    # It does not launch the Hermes CLI or enter any user session.
    # Protect the new home before any installed bootstrap can use it. A failed
    # provider import leaves an incomplete home, never a dispatchable runtime.
    home.mkdir(mode=0o700)
    protect_directory(home)
    environment = managed_environment(os.environ, home)
    os.environ.clear()
    os.environ.update(environment)
    sys.path[:0] = [str(source), str(packages)]
    import hermes_bootstrap
    import hermes_yaml
    provider = limited_provider(hermes_yaml.safe_load(original_config.read_text(encoding='utf-8')),
                                spec['provider_name'], spec['model'])
    session_id = 'io-acp-' + uuid.uuid4().hex
    sessions = {session_id: {'project_id': spec['project_id'], 'cwd': str(cwd)}}
    # Exclusive creation makes a failed enrollment visibly incomplete. Preserve
    # it for inspection rather than deleting private state or retrying in place.
    write_new(home / 'config.yaml', provider)  # JSON is a YAML subset.
    write_new(home / '.turboio-tool-policy.json', policy)
    os.environ['HERMES_HOME'] = str(home)
    from hermes_state import SessionDB
    db = SessionDB(home / 'state.db')
    try:
        db.create_session(session_id=session_id, source='acp', cwd=str(cwd),
                          model=spec['model'], model_config={'cwd': str(cwd),
                          'provider': 'custom:' + spec['provider_name'],
                          'base_url': provider['model']['base_url']})
    finally:
        db.close()
    marker = {'schema': 1, 'binding': spec['binding'], 'sessions': sessions}
    write_new(home / '.turboio-managed.json', marker)
    runtime = {'home': str(home), 'journal': str(home / 'journal.sqlite'),
               'binding': spec['binding'], 'sessions': sessions, 'source': str(source),
               'site_packages': str(packages)}
    write_new(home / 'runtime.json', runtime)
    # Verify real existing ACP registration and exclusive ownership BEFORE the
    # ready marker is emitted. Dispatch never calls enrollment as a fallback.
    with _lease(home, spec['binding'], sessions):
        from acp_transport import HermesACPTransport
        transport = HermesACPTransport(command=[sys.executable], environment={'HERMES_HOME':str(home)},
                                       home=home, sessions=sessions)
        transport.preflight(session_id, spec['project_id'])
    write_new(home / '.turboio-enrollment-ready.json', {'schema':1, 'session_id':session_id,
        'profile': policy['profile'], 'source_config_modified':False,
        'model_called':False, 'task_dispatched':False})
    return {'status':'enrolled', 'session_id':session_id, 'profile':policy['profile'],
            'model_called':False, 'source_config_modified':False}


from contextlib import contextmanager
@contextmanager
def _lease(home, binding, sessions):
    lease = ManagedHomeLease(home, binding, sessions)
    try:
        yield lease
    finally:
        lease.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--config':
            raise RuntimeJournalError('ENROLL_EXPLICIT_CONFIG_REQUIRED')
        print(json.dumps(enroll(private_json(sys.argv[2]))))
    except Exception as error:
        code = error.code if isinstance(error, RuntimeJournalError) else 'ENROLL_FAILED'
        print(json.dumps({'status':'failed','error_code':code}))
        raise SystemExit(2)
