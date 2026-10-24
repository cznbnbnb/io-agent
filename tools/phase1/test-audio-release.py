import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


support, package, deploy, remote = map(load, ('audio-release-support', 'package-audio-release', 'deploy-audio-release', 'remote-server-release'))


class ExpiryPublisherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='io-audio-publisher-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.unit_root = self.root / 'systemd'
        self.unit_root.mkdir()
        self.patch = patch.object(support, 'UNIT_ROOT', self.unit_root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.db = self.root / 'text.sqlite'
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE meta(key TEXT, value TEXT)')
            db.execute("INSERT INTO meta VALUES ('server_id','synthetic-server')")
        self.archive = self.root / 'review.zip'
        self.module = (package.Path(__file__).resolve().parents[2] / support.MODULE).read_bytes()
        with zipfile.ZipFile(self.archive, 'w') as z:
            z.writestr(support.MODULE, self.module)
        self.commands = []
        self.controller = {'BASE': self.root, 'DB': str(self.db), 'NODE': '/opt/turboio/node22/bin/node',
                           'regular_bytes': remote.regular_bytes, 'sync_dir': remote.sync_dir,
                           'locations': lambda key: {'archive': self.archive}, 'run': self.run_command}
        self.metadata = {'release_id': 'synthetic-release', 'server_id_sha256': hashlib.sha256(b'synthetic-server').hexdigest()}
        self.digest = hashlib.sha256(self.module).hexdigest()
        self.manifest = {'files': {support.MODULE: {'sha256': self.digest}}}

    def run_command(self, args, **kwargs):
        self.commands.append(args)
        if args[:2] == ['systemctl', 'is-active']:
            return 'active'
        if args[:2] == ['systemctl', 'is-enabled']:
            return 'enabled'
        if '--property=Result' in args:
            return 'success'
        if '--property=ExecMainStatus' in args:
            return '0'
        return ''

    def test_module_and_timer_are_independent_and_content_bound(self):
        proof = support.prepare(self.controller, self.metadata, self.manifest)
        module = Path(proof['module_path'])
        self.assertEqual(module.read_bytes(), self.module)
        self.assertTrue(module.is_relative_to(self.root / 'audio-expiry-v1'))
        self.assertFalse(module.is_relative_to(self.root / 'rebuild/material-server'))
        unit = (self.unit_root / support.SERVICE).read_text()
        self.assertIn('PrivateNetwork=true', unit)
        self.assertIn('--server-id synthetic-server', unit)
        self.assertIn('ReadWritePaths=' + str(self.root), unit)
        self.assertNotIn('credential', unit)
        self.assertTrue(proof['survives_http_rollback'])
        self.assertFalse(Path(str(self.db) + '.audio.sqlite').exists())
        self.assertEqual(support.prepare(self.controller, self.metadata, self.manifest), proof)
        self.assertIn(['systemctl', 'enable', '--now', support.TIMER], self.commands)
        self.assertFalse(any('turboio-material.service' in a for a in self.commands))

    def test_conflicting_unit_or_symlink_is_not_replaced(self):
        p = self.unit_root / support.SERVICE
        p.write_bytes(b'unknown operator unit')
        with self.assertRaisesRegex(ValueError, 'EXPIRY_EXISTING_ASSET_DIFFERS'):
            support.prepare(self.controller, self.metadata, self.manifest)
        self.assertEqual(p.read_bytes(), b'unknown operator unit')
        self.assertFalse(self.commands)
        self.assertFalse((self.root / 'audio-expiry-v1' / self.digest / 'audio-expiry.mjs').exists())
        p.unlink()
        p.symlink_to(self.archive)
        with self.assertRaises(ValueError):
            support.prepare(self.controller, self.metadata, self.manifest)
        self.assertTrue(p.is_symlink())

    def test_account_mismatch_or_existing_audio_refuses_before_units(self):
        with self.assertRaisesRegex(ValueError, 'EXPIRY_SERVER_BINDING_CHANGED'):
            support.prepare(self.controller, dict(self.metadata, server_id_sha256='0' * 64), self.manifest)
        Path(str(self.db) + '.audio.sqlite').write_bytes(b'unknown audio storage')
        with self.assertRaisesRegex(ValueError, 'EXISTING_AUDIO_DATABASE_REVIEW_REQUIRED'):
            support.prepare(self.controller, self.metadata, self.manifest)
        self.assertFalse(self.commands)
        self.assertFalse(list(self.unit_root.iterdir()))

    def test_unit_arguments_reject_injection(self):
        for sid in ('server\nExecStart=/bin/false', 'server --extra', '', '*'):
            with self.assertRaisesRegex(ValueError, 'EXPIRY_UNIT_ARGUMENT'):
                support.units('/opt/node', '/opt/expiry.mjs', '/var/lib/db', sid)

    def test_expiry_start_failure_does_not_claim_ready_or_touch_http(self):
        def fail(args, **kwargs):
            if args == ['systemctl', 'start', support.SERVICE]:
                raise ValueError('SYNTHETIC_EXPIRY_FAILURE')
            return self.run_command(args, **kwargs)
        self.controller['run'] = fail
        with self.assertRaisesRegex(ValueError, 'SYNTHETIC_EXPIRY_FAILURE'):
            support.prepare(self.controller, self.metadata, self.manifest)
        self.assertFalse(any('turboio-material.service' in a for a in self.commands))
        self.assertTrue((self.unit_root / support.TIMER).exists())

    def test_text_backup_is_consistent_and_excludes_audio_sidecar(self):
        Path(str(self.db) + '.audio.sqlite').write_bytes(b'synthetic original audio')
        result = deploy.backup_text(self.controller, self.metadata)
        with sqlite3.connect(result['path']) as backup:
            self.assertEqual(backup.execute('SELECT value FROM meta').fetchone(), ('synthetic-server',))
        self.assertFalse(Path(result['path']).read_bytes().find(b'synthetic original audio') >= 0)
        self.assertFalse(result['audio_backed_up'])
        with self.assertRaisesRegex(ValueError, 'TEXT_BACKUP_PATH'):
            deploy.backup_text(self.controller, self.metadata)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='io-audio-bundle-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        repo = Path(__file__).resolve().parents[2]
        self.payloads = {n: (repo / n).read_bytes() for n in package.FILES}
        self.manifest = {'schema': 1, 'profile': package.PROFILE, 'node': 'v22.23.2',
                         'production_deployed': False, 'source_commit': '1' * 40,
                         'rehearsal_sha256': '2' * 64,
                         'baseline_sha256': {n: None if n in package.ADDED else '3' * 64 for n in package.FILES},
                         'files': {n: {'sha256': package.sha(v), 'bytes': len(v)} for n, v in self.payloads.items()}}

    def bundle(self, mutate=lambda v: None):
        values = dict(self.payloads, **{'manifest.json': json.dumps(self.manifest).encode()})
        mutate(values)
        path = self.root / 'test.zip'
        with zipfile.ZipFile(path, 'w') as z:
            for n, value in values.items():
                z.writestr(n, value)
        return path

    def test_complete_scope_and_independent_module_are_mandatory(self):
        self.assertTrue(package.inspect_bundle(self.bundle())['release_id'].startswith('r4-audio-'))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE'):
            package.inspect_bundle(self.bundle(lambda v: v.pop(support.MODULE)))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE'):
            package.inspect_bundle(self.bundle(lambda v: v.__setitem__('unexpected-secret', b'no')))

    def test_payload_tampering_and_baseline_scope_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_HASH_MISMATCH'):
            package.inspect_bundle(self.bundle(lambda v: v.__setitem__(support.MODULE, b'changed')))
        self.manifest['baseline_sha256'][support.MODULE] = '4' * 64
        with self.assertRaisesRegex(ValueError, 'BASELINE_INVALID'):
            package.inspect_bundle(self.bundle())


if __name__ == '__main__':
    unittest.main()
