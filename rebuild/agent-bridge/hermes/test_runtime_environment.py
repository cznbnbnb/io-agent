"""A poisoned launching shell or partial enrollment cannot select another task home."""
import json
from pathlib import Path
import tempfile
import unittest

from restricted_profile import CLI_POLICY, WORKSPACE_POLICY
from runtime_environment import managed_environment, require_enrollment_ready
from runtime_journal import RuntimeJournalError


class RuntimeEnvironmentTests(unittest.TestCase):
    def test_shell_selectors_removed_but_network_and_os_preserved(self):
        inherited = {'PATH': 'prepared-runtime', 'SystemRoot': 'system',
                     'HTTPS_PROXY': 'http://localhost:7890', 'PYTHONIOENCODING': 'cp936',
                     'HERMES_HOME': 'other-home', 'hermes_profile': 'other-profile',
                     'HERMES_CONFIG_PATH': 'other-config', 'HERMES_ENV': 'other-secrets',
                     'HERMES_UNKNOWN_FUTURE_SELECTOR': 'other',
                     'turboio_question_config': 'other-operation',
                     'TURBOIO_RUNTIME_CONFIG': 'other-runtime'}
        original = dict(inherited)
        actual = managed_environment(inherited, 'enrolled-home', 'bound-runtime')
        self.assertEqual(inherited, original)
        self.assertEqual(actual, {key: original[key] for key in
            ['PATH', 'SystemRoot', 'HTTPS_PROXY', 'PYTHONIOENCODING']} |
            {'HERMES_HOME': 'enrolled-home', 'HERMES_DISABLE_LAZY_INSTALLS': '1',
             'HERMES_ACP_SKIP_CONFIGURED_MCP': '1', 'TURBOIO_RUNTIME_CONFIG': 'bound-runtime'})
        self.assertNotIn('TURBOIO_RUNTIME_CONFIG', managed_environment(inherited, 'new-home'))

    def test_partial_enrollment_and_foreign_ready_marker_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / '.turboio-tool-policy.json').write_text(json.dumps(CLI_POLICY))
            sessions = {'expected-session': {'project_id': 'test', 'cwd': temp}}
            with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_ENROLLMENT_NOT_READY'):
                require_enrollment_ready(home, sessions)
            ready = {'schema': 1, 'session_id': 'expected-session',
                     'profile': CLI_POLICY['profile'], 'source_config_modified': False,
                     'model_called': False, 'task_dispatched': False}
            file = home / '.turboio-enrollment-ready.json'
            file.write_text(json.dumps(ready))
            require_enrollment_ready(home, sessions)
            for mutation in [{'session_id': 'other-session'}, {'model_called': True},
                             {'unexpected': 'field'}]:
                file.write_text(json.dumps(ready | mutation))
                with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_ENROLLMENT_NOT_READY'):
                    require_enrollment_ready(home, sessions)
            file.write_text(json.dumps(ready))
            with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_ENROLLMENT_NOT_READY'):
                require_enrollment_ready(home, sessions | {'another-session': {}})

    def test_ready_marker_must_name_the_enrolled_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / '.turboio-tool-policy.json').write_text(json.dumps(WORKSPACE_POLICY))
            sessions = {'expected-session': {'project_id': 'test', 'cwd': temp}}
            ready = {'schema': 1, 'session_id': 'expected-session',
                     'profile': WORKSPACE_POLICY['profile'], 'source_config_modified': False,
                     'model_called': False, 'task_dispatched': False}
            file = home / '.turboio-enrollment-ready.json'
            file.write_text(json.dumps(ready))
            require_enrollment_ready(home, sessions)
            # A question-only enrollment cannot be widened by swapping the policy file.
            file.write_text(json.dumps(ready | {'profile': CLI_POLICY['profile']}))
            with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_ENROLLMENT_NOT_READY'):
                require_enrollment_ready(home, sessions)

    def test_legacy_profile_does_not_acquire_implicit_cli_registration(self):
        with tempfile.TemporaryDirectory() as temp:
            require_enrollment_ready(temp, {'existing-registered-session': {}})


if __name__ == '__main__':
    unittest.main()
