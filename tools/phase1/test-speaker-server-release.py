import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release_package', ROOT / 'tools/phase1/package-speaker-server-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.gettempdir()).resolve()
        self.temp = Path(tempfile.mkdtemp(prefix='turboio-release-test-', dir=self.base)).resolve()
        self.addCleanup(self.remove_temp)
        self.source = self.temp / 'source'
        for name in release.FILES + release.VERIFICATION_SOURCES + ('rebuild/material-server/verification/result.json',):
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)

    def remove_temp(self):
        if self.temp.parent != self.base or not self.temp.name.startswith('turboio-release-test-') or self.temp.is_symlink():
            raise ValueError('TEST_CLEANUP_OUT_OF_SCOPE')
        shutil.rmtree(self.temp)

    def package(self):
        return release.build(self.source, self.temp / 'out', 'io-test-release')

    def rewrite(self, change):
        result = self.package()
        archive = Path(result['archive'])
        with zipfile.ZipFile(archive) as z:
            entries = {name: z.read(name) for name in z.namelist()}
        change(entries)
        altered = self.temp / 'altered.zip'
        with zipfile.ZipFile(altered, 'x') as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return altered

    def test_allowlist_excludes_private_data_dependencies_and_deploy_automation(self):
        private = self.source / 'rebuild/material-server/private/credential.json'
        private.parent.mkdir()
        private.write_text('synthetic-private-sentinel', encoding='utf-8')
        result = self.package()
        self.assertEqual(set(result['files']), set(release.FILES))
        with zipfile.ZipFile(result['archive']) as z:
            self.assertEqual(set(z.namelist()), set(release.FILES) | {'manifest.json'})
            self.assertNotIn(b'synthetic-private-sentinel', b''.join(z.read(name) for name in z.namelist()))

    def test_modified_code_cannot_inherit_a_previous_green_report(self):
        source = self.source / 'rebuild/material-server/http.mjs'
        source.write_bytes(source.read_bytes() + b'\n// unverified modification\n')
        with self.assertRaisesRegex(ValueError, 'SOURCE_NOT_VERIFIED'):
            self.package()

    def test_failed_verification_cannot_be_packaged(self):
        file = self.source / 'rebuild/material-server/verification/result.json'
        report = json.loads(file.read_text(encoding='utf-8'))
        report['status'] = 'failed'
        file.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'SERVER_VERIFICATION_NOT_PASSED'):
            self.package()

    def test_missing_lifecycle_suite_cannot_borrow_other_green_checks(self):
        file = self.source / 'rebuild/material-server/verification/result.json'
        report = json.loads(file.read_text(encoding='utf-8'))
        report['suites'] = [s for s in report['suites'] if s['file'] != 'tests/request-lifecycle.test.mjs']
        file.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'REQUEST_LIFECYCLE_NOT_VERIFIED'):
            self.package()

    def test_lifecycle_suite_failure_cannot_borrow_overall_passed_status(self):
        file = self.source / 'rebuild/material-server/verification/result.json'
        report = json.loads(file.read_text(encoding='utf-8'))
        suite = next(s for s in report['suites'] if s['file'] == 'tests/request-lifecycle.test.mjs')
        suite['failed'] = 1
        file.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'REQUEST_LIFECYCLE_NOT_VERIFIED'):
            self.package()

    def test_modified_lifecycle_test_or_verifier_invalidates_evidence(self):
        for name in release.VERIFICATION_SOURCES:
            with self.subTest(name=name):
                source = self.source / name
                original = source.read_bytes()
                source.write_bytes(original + b'\n')
                with self.assertRaisesRegex(ValueError, 'VERIFICATION_SOURCE_CHANGED'):
                    self.package()
                source.write_bytes(original)

    def test_tampering_is_detected_before_extraction(self):
        def change(entries):
            entries['rebuild/material-server/store.mjs'] += b'\n// tampered\n'
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_HASH_MISMATCH'):
            release.inspect(self.rewrite(change))

    def test_extra_or_traversal_member_is_rejected(self):
        def change(entries):
            entries['../private.json'] = b'synthetic'
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_SCOPE_INVALID'):
            release.inspect(self.rewrite(change))

    def test_manifest_cannot_choose_output_paths(self):
        def change(entries):
            manifest = json.loads(entries['manifest.json'])
            manifest['release_id'] = '../outside'
            entries['manifest.json'] = json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError, 'MANIFEST_INVALID'):
            release.inspect(self.rewrite(change))

    def test_existing_archive_is_not_overwritten(self):
        result = self.package()
        original = Path(result['archive']).read_bytes()
        with self.assertRaises(FileExistsError):
            self.package()
        self.assertEqual(Path(result['archive']).read_bytes(), original)


    def test_missing_speaker_or_query_suite_cannot_borrow_other_checks(self):
        file=self.source/'rebuild/material-server/verification/result.json'
        original=file.read_text(encoding='utf-8')
        for suite in ['tests/speakers.test.mjs','tests/query.test.mjs']:
            report=json.loads(original);report['suites']=[s for s in report['suites'] if s['file']!=suite];file.write_text(json.dumps(report),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'SPEAKER_QUERY_SUITE_NOT_VERIFIED'): self.package()
        file.write_text(original,encoding='utf-8')

    def test_schema_1_2_is_required_and_cannot_be_removed_from_archive(self):
        def change(entries): del entries['docs/contracts/event-v1.2.schema.json']
        with self.assertRaisesRegex(ValueError,'ARCHIVE_SCOPE_INVALID'): release.inspect(self.rewrite(change))

    def test_release_profile_cannot_be_swapped_for_lifecycle_only(self):
        def change(entries):
            manifest=json.loads(entries['manifest.json']);manifest['release_profile']='request-lifecycle';entries['manifest.json']=json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError,'MANIFEST_INVALID'): release.inspect(self.rewrite(change))

    def test_manifest_cannot_hide_private_or_unreviewed_extra_fields(self):
        def change(entries):
            manifest=json.loads(entries['manifest.json']);manifest['unexpected_private_data']='synthetic-only';entries['manifest.json']=json.dumps(manifest).encode()
        with self.assertRaisesRegex(ValueError,'MANIFEST_INVALID'): release.inspect(self.rewrite(change))

if __name__ == '__main__':
    unittest.main()
