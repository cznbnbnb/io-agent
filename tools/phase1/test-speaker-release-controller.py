import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent


class ControllerTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('controller', TOOLS / 'deploy-speaker-server-release.py')
        self.controller = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.controller)
        self.base = Path(tempfile.gettempdir()).resolve()
        self.root = Path(tempfile.mkdtemp(prefix='turboio-controller-test-', dir=self.base)).resolve()
        self.addCleanup(self.cleanup)
        (self.root / 'rebuild/phase1').mkdir(parents=True)
        self.controller.ROOT = self.root
        self.metadata = {'release_id': 'synthetic-release', 'archive_sha256': 'a' * 64, 'before_sha256': {}}
        self.calls = []
        self.connections = []

    def cleanup(self):
        if self.root.parent != self.base or not self.root.name.startswith('turboio-controller-test-') or self.root.is_symlink():
            raise ValueError('TEST_CLEANUP_OUT_OF_SCOPE')
        shutil.rmtree(self.root)

    def connect(self):
        class Connection:
            closed = False
            def close(self):
                self.closed = True
        connection = Connection()
        self.connections.append(connection)
        return connection

    def invoke(self, mode, execute):
        args = ['deploy-speaker-server-release.py', '--archive', str(self.root / 'synthetic.zip')] + ([mode] if mode else [])
        with patch.object(sys, 'argv', args), patch.object(self.controller, 'reviewed', return_value=self.metadata), \
             patch.object(self.controller, 'connect', side_effect=self.connect), \
             patch.object(self.controller, 'execute', side_effect=execute), contextlib.redirect_stdout(io.StringIO()):
            status = self.controller.main()
        path = self.root / ('rebuild/phase1/synthetic-release' + ('-deploy.json' if mode == '--apply' else '-deployment-inspection.json'))
        return status, json.loads(path.read_text(encoding='utf-8'))

    def test_default_mode_never_uploads_or_applies(self):
        def execute(connection, metadata, archive=None):
            self.calls.append(archive)
            return {'release_id': metadata['release_id'], 'status': 'not_recorded'}
        status, report = self.invoke(None, execute)
        self.assertEqual(status, 0)
        self.assertEqual(self.calls, [None])
        self.assertEqual(report['mode'], 'inspect')
        self.assertTrue(self.connections[0].closed)

    def test_lost_apply_reply_only_inspects_same_journal_and_never_reapplies(self):
        def execute(connection, metadata, archive=None):
            self.calls.append((metadata['release_id'], archive is not None))
            if archive is not None:
                raise TimeoutError('synthetic observation timeout')
            return {'release_id': metadata['release_id'], 'status': 'staged_verified', 'owner_alive': True}
        status, report = self.invoke('--apply', execute)
        self.assertEqual(status, 1)
        self.assertEqual(self.calls, [('synthetic-release', True), ('synthetic-release', False)])
        self.assertEqual(report['status'], 'outcome_unknown')
        self.assertTrue(report['inspection_after_error']['owner_alive'])
        self.assertEqual(len(self.connections), 2)
        self.assertTrue(all(connection.closed for connection in self.connections))

    def test_confirmed_deployment_does_not_create_a_second_connection_or_retry(self):
        def execute(connection, metadata, archive=None):
            self.calls.append(archive is not None)
            return {'release_id': metadata['release_id'], 'phase': 'deployed', 'credentials_minted': False}
        status, report = self.invoke('--apply', execute)
        self.assertEqual(status, 0)
        self.assertEqual(self.calls, [True])
        self.assertEqual(report['status'], 'deployed')
        self.assertFalse(report['credentials_minted'])
        self.assertEqual(len(self.connections), 1)

    def test_publisher_report_hashes_the_actual_speaker_controller_and_all_current_review_tools(self):
        def execute(connection,metadata,archive=None):
            return {'release_id':metadata['release_id'],'phase':'deployed','credentials_minted':False}
        status,report=self.invoke('--apply',execute)
        self.assertEqual(status,0)
        required={'package-speaker-server-release.py','remote-server-release.py','deploy-speaker-server-release.py',
                  'speaker-server-release-preflight.py','rehearse-speaker-server-release.mjs'}
        self.assertEqual(set(report['publisher_source_sha256']),required)
        self.assertNotIn('deploy-server-release.py',report['publisher_source_sha256'])
        for name in required:
            self.assertEqual(report['publisher_source_sha256'][name],self.controller.package.sha((TOOLS/name).read_bytes()))

    def review_lifecycle(self, change=None):
        artifact = self.root / 'rebuild/phase1/artifacts/synthetic-release.zip'
        artifact.parent.mkdir()
        artifact.write_bytes(b'synthetic-reviewed-archive')
        digest = self.controller.package.sha(artifact.read_bytes())
        baseline = {'status': 'preflight_passed', 'release_id': 'synthetic-release',
                    'archive_sha256': digest, 'before_sha256': dict.fromkeys(self.controller.package.FILES)}
        rehearsal = {'status': 'passed', 'release_id': 'synthetic-release', 'archive_sha256': digest,
                     'scenario': 'material-speakers-v1.2', 'production_changed': False,
                     'rehearsal_source_sha256': self.controller.package.sha((TOOLS / 'rehearse-speaker-server-release.mjs').read_bytes()),
                     'checks': ['upgrade_advertises_material_1_2','old_runtime_refuses_material_1_2','upgrade_accepts_speaker_revisions','upgrade_preserves_split_and_corrected_source','rollback_keeps_material_1_2_json','rollback_refuses_new_1_2_events','rollback_keeps_original_receipt','rollback_keeps_existing_request_lifecycle','original_schemas_unchanged','additive_schema_retained_on_rollback']}
        if change:
            change(rehearsal)
        for suffix, data in [('preflight', baseline), ('rehearsal', rehearsal)]:
            (self.root / ('rebuild/phase1/synthetic-release-' + suffix + '.json')).write_text(json.dumps(data), encoding='utf-8')
        with patch.object(self.controller.package, 'inspect', return_value={'release_id': 'synthetic-release', 'verified_tests': 68,'source_git_commit':'a'*40}), \
             patch.object(self.controller.package, 'sources', return_value=({}, {})),patch.object(self.controller.package,'committed_payloads'):
            return self.controller.reviewed(artifact)

    def test_lifecycle_review_accepts_bound_upgrade_and_rollback_evidence(self):
        self.assertEqual(self.review_lifecycle()['release_id'], 'synthetic-release')

    def test_old_rehearsal_scenario_cannot_authorize_lifecycle_release(self):
        with self.assertRaisesRegex(ValueError, 'SPEAKER_REHEARSAL_NOT_VERIFIED'):
            self.review_lifecycle(lambda r: r.update(scenario='baseline'))

    def test_changed_rehearsal_script_invalidates_previous_green_record(self):
        with self.assertRaisesRegex(ValueError, 'SPEAKER_REHEARSAL_NOT_VERIFIED'):
            self.review_lifecycle(lambda r: r.update(rehearsal_source_sha256='0' * 64))

    def test_missing_code_rollback_proof_cannot_authorize_lifecycle_release(self):
        with self.assertRaisesRegex(ValueError, 'SPEAKER_REHEARSAL_NOT_VERIFIED'):
            self.review_lifecycle(lambda r: r['checks'].remove('rollback_keeps_material_1_2_json'))


if __name__ == '__main__':
    unittest.main()
