"""Bind managed children to their enrolled home, not the launching shell's profile."""
from pathlib import Path

from managed_home import private_json
from restricted_profile import CLI_POLICY, read_policy
from runtime_journal import RuntimeJournalError


def managed_environment(inherited, home, runtime_file=None):
    # Windows environment names are case insensitive. Remove unknown future
    # Hermes selectors too; an enrolled runtime must opt in to each setting.
    # Retain OS, network/proxy and prepared interpreter settings unchanged.
    environment = {key: value for key, value in inherited.items()
                   if not key.upper().startswith(('HERMES_', 'TURBOIO_'))}
    environment.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1',
                       HERMES_ACP_SKIP_CONFIGURED_MCP='1')
    if runtime_file is not None:
        environment['TURBOIO_RUNTIME_CONFIG'] = str(runtime_file)
    return environment


def require_enrollment_ready(home, sessions):
    # Older explicitly managed profiles keep their existing ownership checks.
    # Newly CLI-enrolled homes must have completed registration and preflight;
    # config/runtime files written before a failed preflight are insufficient.
    if read_policy(home) != CLI_POLICY:
        return
    try:
        ready = private_json(Path(home) / '.turboio-enrollment-ready.json')
        expected = {'schema': 1, 'session_id': next(iter(sessions)),
                    'profile': CLI_POLICY['profile'],
                    'source_config_modified': False, 'model_called': False,
                    'task_dispatched': False}
        if len(sessions) != 1 or ready != expected:
            raise ValueError()
    except Exception:
        raise RuntimeJournalError('RUNTIME_ENROLLMENT_NOT_READY') from None
