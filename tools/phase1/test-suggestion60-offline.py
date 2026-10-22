"""Affected offline checks only: no firmware/device execution or flashing."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('suggest60', Path(__file__).with_name('build-suggestion60-offline.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Suggestion60Tests(unittest.TestCase):
    version = '1.0.4.12'

    @classmethod
    def setUpClass(cls):
        cls.profile = m.PROFILES[cls.version]
        cls.candidate, cls.report = m.build(cls.version)
        with zipfile.ZipFile(cls.profile['archive']) as z:
            cls.originals = {e.filename: z.read(e) for e in z.infolist()}
        cls.original = cls.originals['nuttx_ap.bin']
        with zipfile.ZipFile(io.BytesIO(cls.candidate)) as z:
            cls.patched = z.read('nuttx_ap.bin')

    def test_only_four_instructions_and_manifest_md5_changed(self):
        allowed = {va-m.BASE+i for _, va, _, _, _ in self.profile['patches'] for i in range(4)}
        actual = {i for i, (a, b) in enumerate(zip(self.original, self.patched)) if a != b}
        self.assertEqual(actual, allowed)
        self.assertEqual(len(self.original), len(self.patched))
        self.assertEqual(len(actual), 16)
        changed = {e['name'] for e in self.report['members'] if e['content_changed']}
        self.assertEqual(changed, {'nuttx_ap.bin', 'OtaFileInfo.json'})
        self.assertFalse(self.report['flash_authorized'])
        self.assertFalse(self.report['device_contacted'])
        self.assertEqual(self.report['checks']['unchanged_other_payloads'], self.profile['payloads']-1)
        if self.version == '1.0.4.12':
            self.assertEqual(self.report['candidate_sha256'], 'cb8046d0c1a7218e7c8309f2df04224630ce4dce5cb615f2a7e05300025ebfb2')

    def test_llvm_assembler_matches_patch_and_conditional_context(self):
        sdk = Path(os.environ.get('DEVECO_HOME', 'D:/APP/DevEcoStudio'))/'sdk/default/openharmony/native/llvm/bin'
        clang, objcopy = sdk/'clang.exe', sdk/'llvm-objcopy.exe'
        if not clang.is_file() or not objcopy.is_file():
            self.skipTest('DevEco LLVM unavailable; assembler check NOT passed')
        with tempfile.TemporaryDirectory(dir=m.stock.ROOT/'rebuild/phase1/device-private') as folder:
            obj, binary = Path(folder)/'reference.o', Path(folder)/'reference.bin'
            subprocess.run([str(clang), '--target=arm-none-eabi', '-mcpu=cortex-m33', '-mthumb', '-c',
                            str(Path(__file__).with_name('suggestion60-instructions.S')), '-o', str(obj)], check=True, capture_output=True)
            subprocess.run([str(objcopy), '-O', 'binary', '--only-section=.text', str(obj), str(binary)], check=True, capture_output=True)
            reference = binary.read_bytes()
        self.assertEqual(len(reference), 22)
        for _, _, _, after, register in self.profile['patches']:
            self.assertEqual(bytes.fromhex(after), reference[:4] if register == 'r1' else reference[4:8])
        start, end = self.profile['initial_block']
        self.assertEqual(self.patched[start-m.BASE:end-m.BASE], reference[8:])

    def test_modified_or_already_patched_input_rejected(self):
        damaged = bytearray(self.original)
        damaged[20] ^= 1
        for data in [damaged, self.patched]:
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                m.patch_ap(data, self.version)

    def test_unlisted_change_wrong_immediate_or_length_rejected(self):
        for offset in [0, self.profile['patches'][0][1]-m.BASE, len(self.patched)-1]:
            damaged = bytearray(self.patched)
            damaged[offset] ^= 1
            with self.assertRaises(ValueError):
                m.verify_ap(self.original, damaged, self.version)
        with self.assertRaises(ValueError):
            m.verify_ap(self.original, self.patched+b'\0', self.version)

    def test_other_payload_and_manifest_tampering_rejected(self):
        for target in ['OtaFileInfo.json', next(n for n in self.originals if n not in ['nuttx_ap.bin', 'OtaFileInfo.json'])]:
            output = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(self.candidate)) as source, zipfile.ZipFile(output, 'w') as dest:
                for e in source.infolist():
                    data = source.read(e)
                    if e.filename == target:
                        changed = bytearray(data)
                        if target == 'OtaFileInfo.json':
                            # Valid JSON and same length, but wrong AP checksum.
                            md5 = next(r['Md5'] for r in json.loads(data) if r['Name'] == 'nuttx_ap.bin').encode()
                            data = data.replace(md5, b'0'*32)
                        else:
                            changed[-1] ^= 1
                            data = bytes(changed)
                    dest.writestr(copy.copy(e), data)
            with self.assertRaises(ValueError):
                m.verify_archive(output.getvalue(), self.originals, self.patched)

    def test_write_refuses_existing_directory_and_report_mismatch(self):
        private = m.stock.ROOT/'rebuild/phase1/device-private'
        with tempfile.TemporaryDirectory(dir=private) as folder:
            sentinel = Path(folder)/'sentinel'
            sentinel.write_bytes(b'keep')
            with self.assertRaises(FileExistsError):
                m.write_candidate(Path(folder), self.candidate, self.report)
            self.assertEqual(sentinel.read_bytes(), b'keep')
            with self.assertRaisesRegex(ValueError, 'does not match report'):
                m.write_candidate(Path(folder)/'new', b'wrong', self.report)
            self.assertFalse((Path(folder)/'new').exists())


class Suggestion60NewFirmwareTests(Suggestion60Tests):
    version = '1.0.5.5'

    def test_cli_requires_explicit_firmware_before_writes(self):
        private = m.stock.ROOT/'rebuild/phase1/device-private'
        with tempfile.TemporaryDirectory(dir=private) as folder:
            output = Path(folder)/'must-not-be-created'
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('build-suggestion60-offline.py')),
                                     '--output-dir', str(output)], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn(b'--firmware-version', result.stderr)
            self.assertFalse(output.exists())

    def test_old_profile_refuses_new_ap_and_new_profile_refuses_old_ap(self):
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            m.patch_ap(self.original, '1.0.4.12')
        with zipfile.ZipFile(m.PROFILES['1.0.4.12']['archive']) as z:
            old_ap = z.read('nuttx_ap.bin')
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            m.patch_ap(old_ap, '1.0.5.5')


if __name__ == '__main__':
    unittest.main(verbosity=2)
