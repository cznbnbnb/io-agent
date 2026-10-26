import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('deploy-material-transfer-release.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r4-publisher-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = publisher.ROOT / 'rebuild/android-app/build/r4-server-source-review.zip'

    def changed_bundle(self, mutate):
        with zipfile.ZipFile(self.bundle) as source:
            values = {n: source.read(n) for n in source.namelist()}
        mutate(values)
        path = self.root / 'changed.zip'
        with zipfile.ZipFile(path, 'w') as target:
            for n, data in values.items():
                target.writestr(n, data)
        return path

    def test_historical_bundle_is_committed_but_current_audio_source_requires_new_review(self):
        metadata = publisher.inspect_bundle(self.bundle)
        with zipfile.ZipFile(self.bundle) as archive:
            for name in publisher.FILES:
                committed = subprocess.check_output(['git', 'show', metadata['source_commit'] + ':' + name], cwd=publisher.ROOT)
                self.assertEqual(committed.replace(b'\r\n', b'\n'), archive.read(name).replace(b'\r\n', b'\n'))
        with self.assertRaisesRegex(ValueError, 'CURRENT_SOURCE_DIFFERS'):
            publisher.reviewed(self.bundle)

    def test_changed_payload_refused(self):
        path = self.changed_bundle(lambda v: v.__setitem__('rebuild/material-server/http.mjs', b'changed'))
        with self.assertRaisesRegex(ValueError, 'SOURCE_HASH_MISMATCH'):
            publisher.inspect_bundle(path)

    def test_missing_runtime_refused(self):
        path = self.changed_bundle(lambda v: v.pop('rebuild/material-server/devices.mjs'))
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE'):
            publisher.inspect_bundle(path)

    def test_wrong_profile_refused(self):
        def change(values):
            m = json.loads(values['manifest.json'])
            m['profile'] = 'unreviewed'
            values['manifest.json'] = json.dumps(m).encode()
        with self.assertRaisesRegex(ValueError, 'MANIFEST_INVALID'):
            publisher.inspect_bundle(self.changed_bundle(change))

    def test_audio_runtime_cannot_use_text_only_release_profile(self):
        def change(values):
            key = 'rebuild/material-server/store.mjs'
            values[key] += b"\nimport {AudioArchive} from './audio.mjs';\n"
            metadata = json.loads(values['manifest.json'])
            metadata['files'][key] = {'bytes': len(values[key]), 'sha256': publisher.sha(values[key])}
            values['manifest.json'] = json.dumps(metadata).encode()
        with self.assertRaisesRegex(ValueError, 'AUDIO_RELEASE_PROFILE_REQUIRED'):
            publisher.inspect_bundle(self.changed_bundle(change))

    def test_packager_refuses_audio_before_creating_any_archive(self):
        spec = importlib.util.spec_from_file_location('audio_boundary_packager',
            Path(__file__).with_name('package-material-transfer-release.py'))
        packager = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(packager)
        source = self.root / 'rebuild/material-server/store.mjs'
        source.parent.mkdir(parents=True)
        source.write_text("import {AudioArchive} from './audio.mjs';")
        output = self.root / 'must-not-exist.zip'
        with self.assertRaisesRegex(ValueError, 'AUDIO_RELEASE_PROFILE_REQUIRED'):
            packager.build(self.root, self.root / 'not-read.json', 'a' * 40, output)
        self.assertFalse(output.exists())

    def test_backup_is_consistent_and_never_restores(self):
        source = self.root / 'source.sqlite'
        with sqlite3.connect(source) as db:
            db.execute('CREATE TABLE example(value TEXT)')
            db.execute("INSERT INTO example VALUES ('synthetic original')")
        backup = self.root / 'backup.sqlite'
        result = publisher.backup_database(source, backup)
        self.assertEqual(result['quick_check'], 'ok')
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(source) as db:
            db.execute("INSERT INTO example VALUES ('synthetic newer')")
        before = backup.read_bytes()
        with self.assertRaisesRegex(ValueError, 'BACKUP_PATH_INVALID'):
            publisher.backup_database(source, backup)
        self.assertEqual(before, backup.read_bytes())
        with sqlite3.connect(source) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM example').fetchone()[0], 2)
        with sqlite3.connect(backup) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM example').fetchone()[0], 1)

    def test_backup_symlink_refused(self):
        source = self.root / 'source.sqlite'
        source.write_bytes(b'preserve')
        link = self.root / 'link.sqlite'
        link.symlink_to(source)
        with self.assertRaisesRegex(ValueError, 'BACKUP_PATH_INVALID'):
            publisher.backup_database(source, link)
        self.assertEqual(source.read_bytes(), b'preserve')

    def test_live_change_refused_before_backup(self):
        # Review rejection is covered above; independently exercise the live
        # baseline boundary with this historical bundle's immutable manifest.
        manifest = publisher.inspect_bundle(self.bundle)
        before = dict(manifest['baseline_sha256'])
        before['rebuild/material-server/material-transfer.mjs'] = None
        metadata = {'release_id': manifest['release_id'], 'archive_sha256': publisher.sha(self.bundle.read_bytes()),
                    'before_sha256': before}
        paths = {k: self.root / k for k in ('current', 'journal', 'archive', 'stage', 'backup', 'rejected')}
        controller = {'locations': lambda _: paths, 'source_hashes': lambda *_: {}}
        with self.assertRaisesRegex(ValueError, 'LIVE_BASELINE_CHANGED'):
            publisher.remote_apply(controller, metadata, self.bundle.read_bytes())
        self.assertEqual(list(self.root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
