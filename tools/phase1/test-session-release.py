import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
import zipfile


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package, deploy, remote = map(load, ('package-session-release', 'deploy-session-release', 'remote-server-release'))
ROOT = Path(__file__).resolve().parents[2]
BASELINE = 'aa813663a1ab7e0a9c201f58a462b8803cc75b9f'


class SessionBundleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='io-session-package-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.payloads = package.payloads({n: (ROOT / n).read_bytes() for n in package.SOURCES})
        old = deploy.baseline_metadata(ROOT, BASELINE, vars(package))
        self.manifest = {'schema': 1, 'profile': package.PROFILE, 'node': 'v22.23.2', 'source_commit': '1' * 40,
                         'baseline_commit': BASELINE, 'production_deployed': False, 'rehearsal_sha256': '2' * 64,
                         'baseline_sha256': old['before_sha256'], 'shared_contract_sha256': old['shared_contract_sha256'],
                         'files': {n: {'sha256': package.sha(v), 'bytes': len(v)} for n, v in self.payloads.items()}}

    def bundle(self, mutate=lambda v: None):
        values = {**self.payloads, 'manifest.json': json.dumps(self.manifest).encode()}
        mutate(values)
        file = self.root / 'test.zip'
        with zipfile.ZipFile(file, 'w') as z:
            for n, value in values.items():
                z.writestr(n, value)
        return file

    def test_runtime_contains_module_marker_and_three_schemas_in_one_switch(self):
        m = package.inspect_bundle(self.bundle())
        self.assertEqual(len(m['files']), 21)
        self.assertTrue(all(n.startswith('rebuild/material-server/') for n in m['files']))
        self.assertEqual(m['profile'], 'agent-session-directory-v1')
        marker = json.loads(self.payloads[package.MARKER])
        for name in package.SCHEMAS:
            self.assertEqual(marker['files'][name], package.sha((ROOT / 'docs/contracts' / name).read_bytes()))

    def test_missing_member_unknown_member_and_wrong_profile_are_rejected(self):
        for name in (package.MARKER, package.LOCAL[0], 'rebuild/material-server/agent-sessions.mjs'):
            with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE'):
                package.inspect_bundle(self.bundle(lambda v: v.pop(name)))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE'):
            package.inspect_bundle(self.bundle(lambda v: v.__setitem__('unreviewed-file', b'no')))
        self.manifest['profile'] = 'material-audio-v1'
        with self.assertRaisesRegex(ValueError, 'MANIFEST_INVALID'):
            package.inspect_bundle(self.bundle())

    def test_schema_marker_hash_and_existing_audio_changes_are_rejected(self):
        original = self.payloads[package.MARKER]
        self.payloads[package.MARKER] = b'{}'
        self.manifest['files'][package.MARKER] = {'sha256': package.sha(b'{}'), 'bytes': 2}
        with self.assertRaisesRegex(ValueError, 'RELEASE_CONTRACT_MARKER_INVALID'):
            package.inspect_bundle(self.bundle())
        self.payloads[package.MARKER] = original
        self.manifest['files'][package.MARKER] = {'sha256': package.sha(original), 'bytes': len(original)}
        self.manifest['baseline_sha256']['rebuild/material-server/audio.mjs'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'UNRELATED_RUNTIME_CHANGED'):
            package.inspect_bundle(self.bundle())


class RollbackGuardTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='io-session-rollback-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.db = self.root / 'synthetic.sqlite'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE queue_revisions(kind TEXT, state TEXT, body TEXT)')
            db.execute('CREATE TABLE agent_defaults(owner TEXT,revision INTEGER)')
            db.execute("INSERT INTO agent_defaults VALUES ('synthetic',1)")
        self.current, self.stage, self.backup, self.rejected = [self.root / n for n in ('current', 'stage', 'backup', 'rejected')]
        for folder, version in ((self.current, 'old'), (self.stage, 'new')):
            folder.mkdir()
            (folder / 'code').write_text(version)
        (self.stage / 'release-contracts.json').write_text('new schema marker')
        self.running = True
        self.calls = []

    def add(self, state='running', body=None):
        with sqlite3.connect(self.db) as db:
            db.execute('INSERT INTO queue_revisions VALUES (?,?,?)', ('task', state, json.dumps(body or {'execution': {'phase': 'running'}})))

    def switch(self, guard):
        def matches(folder, version):
            return folder.is_dir() and (folder / 'code').read_text() == version and (folder / 'release-contracts.json').exists() == (version == 'new')
        def stop():
            self.calls.append('stop')
            self.running = False
        def start():
            self.calls.append('start')
            self.running = True
        def health(version):
            self.assertTrue(self.running)
            self.assertTrue(matches(self.current, version))
        return remote.CodeSwitch(self.current, self.stage, self.backup, self.rejected, matches, stop, start, health, lambda _: None, lambda _: None, rollback_guard=guard)

    def test_directory_tables_only_allow_legacy_rollback(self):
        self.assertTrue(deploy.rollback_guard(self.db)['legacy_rollback_allowed'])
        switch = self.switch(lambda: deploy.rollback_guard(self.db))
        switch.activate()
        switch.rollback()
        self.assertTrue(self.running)
        self.assertEqual((self.current / 'code').read_text(), 'old')
        self.assertFalse((self.current / 'release-contracts.json').exists())
        self.assertEqual((self.rejected / 'release-contracts.json').read_text(), 'new schema marker')

    def test_any_new_state_or_historical_execution_blocks_without_stopping_new_service(self):
        switch = self.switch(lambda: deploy.rollback_guard(self.db))
        switch.activate()
        for state, body in [('stop_requested', {}), ('stop_unconfirmed', {}), ('stopped', {}), ('resume_requested', {}), ('completed', {'execution': {'phase': 'completed'}}), ('failed', {'control': {'kind': 'stop'}})]:
            with sqlite3.connect(self.db) as db:
                db.execute('DELETE FROM queue_revisions')
                db.execute('INSERT INTO queue_revisions VALUES (?,?,?)', ('task', state, json.dumps(body)))
            before = self.db.read_bytes()
            count = len(self.calls)
            with self.assertRaisesRegex(ValueError, 'SESSION_DATA_PREVENTS_LEGACY_ROLLBACK'):
                switch.rollback()
            self.assertEqual(len(self.calls), count)
            self.assertTrue(self.running)
            self.assertEqual((self.current / 'code').read_text(), 'new')
            self.assertEqual(self.db.read_bytes(), before)

    def test_write_racing_stop_restarts_new_code_without_switching_or_replacing_database(self):
        checks = 0
        def guard():
            nonlocal checks
            checks += 1
            if checks == 2:
                self.add()
            return deploy.rollback_guard(self.db)
        switch = self.switch(guard)
        switch.activate()
        with self.assertRaisesRegex(ValueError, 'SESSION_DATA_PREVENTS_LEGACY_ROLLBACK'):
            switch.rollback()
        self.assertEqual(self.calls[-2:], ['stop', 'start'])
        self.assertTrue(self.running)
        self.assertEqual((self.current / 'code').read_text(), 'new')
        self.assertEqual((self.backup / 'code').read_text(), 'old')
        self.assertFalse(self.rejected.exists())

    def test_session_profile_cannot_omit_hooks_or_claim_unreviewed_schema_paths(self):
        metadata = {'release_id': 'synthetic-session', 'archive_sha256': remote.sha(b'synthetic')}
        for profile in ({'FILES': (), 'CONTRACTS': (), 'RELEASE_PROFILE': package.PROFILE},
                        {'FILES': (), 'CONTRACTS': (), 'RELEASE_PROFILE': package.PROFILE, 'LOCAL_CONTRACTS': ('unknown',), 'existing_audio_health': lambda: None, 'rollback_guard': lambda: None}):
            with self.assertRaisesRegex(ValueError, 'SESSION_PROFILE_HOOK_REQUIRED'):
                remote.run_remote(metadata, b'synthetic', profile)


if __name__ == '__main__':
    unittest.main()
