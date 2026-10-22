import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prompter_cli', Path(__file__).with_name('io-prompter-cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class PrompterCliTests(unittest.TestCase):
    def run_case(self, action, mode='complete'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'prm-'+'a'*32
            command = dict(schema=1, id=original, action='stop', expires_at=1, expected_binding='b'*64)
            raw = json.dumps(command, separators=(',', ':'))
            if action == 'reconcile':
                folder = root/'prompter-cli'/original
                folder.mkdir(parents=True)
                (folder/'command.json').write_text(raw, encoding='utf8')
            sent = []
            def transfer(hdc, device, direction, source, target):
                nonlocal command, raw
                if direction == 'send':
                    self.assertTrue(str(target).endswith('/prompter-stop.json' if action == 'stop' else '/prompter-command.json'))
                    raw = Path(source).read_text(encoding='utf8')
                    command = json.loads(raw)
                    sent.append(command)
                    if mode == 'timeout': raise subprocess.TimeoutExpired('hdc', 2)
                else:
                    receipt = dict(schema=1, id=command['id'], request_json=raw, state=mode, lens_verified=False, snapshot=dict(active=False), exit_wait_confirmed=action == 'stop')
                    if mode == 'mismatch': receipt['request_json'] += ' '
                    Path(target).write_text(json.dumps(receipt), encoding='utf8')
                return True
            args = ['cli', action, '--device', 'synthetic']
            if action == 'stop': args += ['--binding', 'b'*64]
            if action == 'reconcile': args += ['--id', original]
            with patch.object(cli.transport, 'PRIVATE', root/'private'), patch.object(cli.transport, 'transfer', side_effect=transfer), patch.object(cli.sys, 'argv', args), contextlib.redirect_stdout(io.StringIO()) as output:
                if mode == 'mismatch':
                    with self.assertRaises(ValueError): cli.main()
                    return
                self.assertEqual(cli.main(), 0 if mode == 'complete' else 2)
            result = json.loads(output.getvalue())
            self.assertNotIn('request_json', result)
            self.assertEqual(len(sent), 0 if action == 'reconcile' else 1)
            if sent: self.assertEqual(sent[0]['action'], action)
            if mode == 'timeout': self.assertEqual(result['state'], 'unknown')

    def test_status(self): self.run_case('status')
    def test_bound_stop(self): self.run_case('stop')
    def test_readonly_reconcile(self): self.run_case('reconcile')
    def test_unknown_delivery_never_retries(self): self.run_case('stop', 'timeout')
    def test_uncertain_exit(self): self.run_case('stop', 'uncertain')
    def test_receipt_mismatch(self): self.run_case('status', 'mismatch')
    def test_no_start_command(self):
        with patch.object(cli.sys, 'argv', ['cli', 'start', '--device', 'synthetic']), patch.object(cli.transport, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit): cli.main()
            transfer.assert_not_called()


if __name__ == '__main__': unittest.main()
