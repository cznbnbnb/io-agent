import importlib.util
import json
from pathlib import Path
import sqlite3
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

    def test_reviewed_commit_and_rehearsal(self):
        result = publisher.reviewed(self.bundle)
        self.assertEqual(set(result['before_sha256']), set(publisher.FILES))
        self.assertIsNone(result['before_sha256']['rebuild/material-server/material-transfer.mjs'])

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
        metadata = publisher.reviewed(self.bundle)
        paths = {k: self.root / k for k in ('current', 'journal', 'archive', 'stage', 'backup', 'rejected')}
        controller = {'locations': lambda _: paths, 'source_hashes': lambda *_: {}}
        with self.assertRaisesRegex(ValueError, 'LIVE_BASELINE_CHANGED'):
            publisher.remote_apply(controller, metadata, self.bundle.read_bytes())
        self.assertEqual(list(self.root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
