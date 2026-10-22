import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('reading_cli', Path(__file__).with_name('io-long-read-cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class ReadingRecoveryTests(unittest.TestCase):
    def test_suspended_start_does_not_write_intent_or_contact_phone(self):
        self.suspended('start')

    def test_check_guard_failure_never_contacts_phone(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(cli.transport, 'PRIVATE', Path(directory)/'private'), \
                 patch.object(cli, 'arm_guard', side_effect=ValueError('dead guard')), \
                 patch.object(cli.transport, 'transfer') as transfer, \
                 patch.object(cli.sys, 'argv', ['cli', 'check', '--device', 'synthetic']):
                with self.assertRaises(ValueError): cli.main()
                transfer.assert_not_called()

    def test_guard_death_at_last_boundary_never_sends_check(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(cli.transport, 'PRIVATE', Path(directory)/'private'), \
                 patch.object(cli, 'arm_guard', return_value=Mock(poll=lambda: 1)), \
                 patch.object(cli.transport, 'transfer') as transfer, \
                 patch.object(cli.sys, 'argv', ['cli', 'check', '--device', 'synthetic']):
                with self.assertRaises(ValueError): cli.main()
                transfer.assert_not_called()

    def suspended(self, action):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(cli.transport, 'PRIVATE', root/'private'), \
                 patch.object(cli.transport, 'transfer') as transfer, \
                 patch.object(cli.sys, 'argv', ['cli', action, '--device', 'synthetic']), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(cli.main(), 2)
            self.assertEqual(json.loads(output.getvalue())['error'], 'READING_PROBE_SUSPENDED')
            transfer.assert_not_called()
            self.assertEqual(list(root.iterdir()), [])

    def recovery(self, action):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = 'read-'+'a'*32
            sent, received, ordering = [], [], []
            command = dict(schema=1, id=original, action='start', expires_at=1)
            if action == 'reconcile':
                folder = root/'long-reading-cli'/original
                folder.mkdir(parents=True)
                (folder/'command.json').write_text(json.dumps(command), encoding='utf8')
            def transfer(hdc, device, direction, source, target):
                nonlocal command
                if direction == 'send':
                    ordering.append('send')
                    command = json.loads(Path(source).read_text(encoding='utf8'))
                    sent.append(command)
                else:
                    received.append(source)
                    record = dict(operation=original, phase='pending', outcome='pending', choice=0,
                                  deadline=0, readStarted=0, readEnded=0, exitConfirmed=False, error='')
                    receipt = dict(schema=1, id=command['id'], request_json=json.dumps(command),
                                   state='complete', error='', record=record, lens_verified=False)
                    Path(target).write_text(json.dumps(receipt), encoding='utf8')
                return True
            args = ['cli', action, '--device', 'synthetic']
            if action == 'stop': args += ['--source-id', original]
            if action == 'reconcile': args += ['--id', original]
            def arm(*args):
                ordering.append('arm')
                self.assertEqual(args[1]['action'], 'check')
                return Mock(poll=lambda: None)
            with patch.object(cli.transport, 'PRIVATE', root/'private'), \
                 patch.object(cli, 'arm_guard', side_effect=arm), \
                 patch.object(cli.transport, 'transfer', side_effect=transfer), \
                 patch.object(cli.sys, 'argv', args), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(cli.main(), 0)
            self.assertFalse(json.loads(output.getvalue())['lens_verified'])
            self.assertEqual(len(received), 1)
            if action == 'reconcile': self.assertEqual(sent, [])
            else:
                self.assertEqual(len(sent), 1)
                self.assertEqual(sent[0]['action'], action)
                if action == 'stop': self.assertEqual(sent[0]['source_id'], original)
            if action == 'check': self.assertEqual(ordering, ['arm', 'send'])

    def test_status_remains_available(self): self.recovery('status')
    def test_original_operation_cleanup_remains_available(self): self.recovery('stop')
    def test_reconcile_old_start_only_reads_its_receipt(self): self.recovery('reconcile')
    def test_check_arms_before_single_submission(self): self.recovery('check')


if __name__ == '__main__': unittest.main()
