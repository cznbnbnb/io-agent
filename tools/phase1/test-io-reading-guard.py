import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('reading_guard_test', Path(__file__).with_name('io-reading-guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
SOURCE = 'read-'+'a'*32
DID = '11111111-2222-4333-8444-555555555555'


class ReadingGuardTests(unittest.TestCase):
    def pair(self):
        r = dict(schema=1, operation=SOURCE, checkOnly=True, choice=0, uid='', peer='synthetic-peer', connection=3, did=DID)
        binding = hashlib.sha256(('synthetic-peer\n3\n'+DID).encode()).hexdigest()
        return r, dict(active=True, connected=True, can_stop=True, binding=binding)

    def test_original_identity_requires_full_generation_and_did(self):
        r, s = self.pair()
        self.assertEqual(guard.original_binding(r, s, SOURCE), s['binding'])
        for changed in [dict(operation='read-'+'b'*32), dict(checkOnly=False), dict(choice=1), dict(uid='foreign'),
                        dict(connection=4), dict(peer='other'), dict(did='22222222-2222-4333-8444-555555555555'),
                        dict(connection=True), dict(schema=True)]:
            self.assertIsNone(guard.original_binding(dict(r, **changed), s, SOURCE))
        for changed in [dict(active=False), dict(connected=False), dict(can_stop=False), dict(active=1), dict(binding='f'*64)]:
            self.assertIsNone(guard.original_binding(r, dict(s, **changed), SOURCE))

    def prepare_job(self, root):
        folder = root/SOURCE
        folder.mkdir()
        command = dict(schema=1, id=SOURCE, action='check', expires_at=99999)
        raw = json.dumps(command).encode()
        (folder/'command.json').write_bytes(raw)
        job = dict(schema=1, source_id=SOURCE, hdc='synthetic-hdc', device='synthetic', command_sha256=hashlib.sha256(raw).hexdigest())
        guard.save(folder/'guard.json', job)
        return folder, job

    def test_job_rejects_changed_command_or_interactive_start(self):
        with tempfile.TemporaryDirectory() as directory:
            folder, job = self.prepare_job(Path(directory))
            self.assertEqual(guard.validate_job(folder/'guard.json'), job)
            raw = json.loads((folder/'command.json').read_text())
            raw['action'] = 'start'
            (folder/'command.json').write_text(json.dumps(raw))
            with self.assertRaises(ValueError): guard.validate_job(folder/'guard.json')

    def stop_case(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder, job = self.prepare_job(root)
            r, s = self.pair()
            if mode == 'foreign': r['operation'] = 'read-'+'b'*32
            sent, reconciled = [], []
            def send(args, **kwargs):
                self.assertTrue(args[-1].endswith('/prompter-stop.json'))
                intent = guard.read_json(folder/'guard-stop-intent.json')
                command = guard.read_json(Path(args[-2]))
                self.assertEqual(intent['stop_id'], command['id'])
                self.assertEqual(command['action'], 'stop')
                self.assertEqual(command['expected_binding'], s['binding'])
                self.assertEqual(set(command), {'schema','id','action','expires_at','expected_binding'})
                sent.append(command)
                if mode == 'timeout': raise subprocess.TimeoutExpired('send', 3)
                return Mock(returncode=0, stdout=b'FileTransfer finish')
            def reconcile(job, stop_id):
                reconciled.append(stop_id)
                return dict(id=stop_id, state='uncertain', exit_wait_confirmed=False, lens_verified=False)
            with patch.object(guard.transport, 'PRIVATE', root/'private'), \
                 patch.object(guard, 'receive', side_effect=[r, s]), \
                 patch.object(guard.subprocess, 'run', side_effect=send), \
                 patch.object(guard, 'reconcile', side_effect=reconcile):
                result = guard.stop_original(job, folder)
                self.assertFalse(result['replayed'])
                if mode == 'foreign':
                    self.assertEqual(sent, [])
                    self.assertEqual(reconciled, [])
                    self.assertFalse(result['exit_confirmed'])
                else:
                    self.assertEqual(len(sent), 1)
                    self.assertEqual(result['stop_transfer_submitted'], mode != 'timeout')
                    self.assertEqual(reconciled, [sent[0]['id']])
                    again = guard.stop_original(job, folder)
                    self.assertEqual(len(sent), 1)
                    self.assertEqual(reconciled, [sent[0]['id']]*2)
                    self.assertFalse(again['observation']['exit_wait_confirmed'])

    def test_exact_owner_persists_intent_before_one_stop(self): self.stop_case('normal')
    def test_uncertain_send_only_reconciles_same_id(self): self.stop_case('timeout')
    def test_changed_operation_has_no_authority_to_stop(self): self.stop_case('foreign')

    def test_read_timeout_does_not_send_stop_or_claim_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            folder, job = self.prepare_job(Path(directory))
            with patch.object(guard, 'receive', side_effect=subprocess.TimeoutExpired('recv', 3)), \
                 patch.object(guard.subprocess, 'run') as send:
                with self.assertRaises(subprocess.TimeoutExpired): guard.stop_original(job, folder)
                send.assert_not_called()

    def test_restarting_a_claimed_guard_never_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            folder, job = self.prepare_job(Path(directory))
            guard.save(folder/'guard-claim.json', {'pid': 1})
            with patch.object(guard, 'stop_original') as stop:
                with self.assertRaises(FileExistsError): guard.run(folder/'guard.json')
                stop.assert_not_called()

    def test_ready_file_alone_does_not_prove_process_liveness(self):
        with tempfile.TemporaryDirectory() as directory:
            folder, job = self.prepare_job(Path(directory))
            (folder/'guard.json').unlink()
            command = guard.read_json(folder/'command.json')
            def spawn(*args, **kwargs):
                digest = hashlib.sha256((folder/'guard.json').read_bytes()).hexdigest()
                guard.save(folder/'guard-ready.json', dict(pid=42, source_id=SOURCE, job_sha256=digest))
                return Mock(pid=42, poll=lambda: 0)
            with patch.object(guard.subprocess, 'Popen', side_effect=spawn):
                with self.assertRaises(ValueError): guard.arm(folder, command, 'synthetic-hdc', 'synthetic')

    def test_deadline_runs_only_after_ready_and_claim_are_persisted(self):
        with tempfile.TemporaryDirectory() as directory:
            folder, job = self.prepare_job(Path(directory))
            def stop(actual_job, actual_folder):
                self.assertEqual(actual_job, job)
                self.assertEqual(actual_folder, folder)
                self.assertTrue((folder/'guard-claim.json').is_file())
                self.assertTrue((folder/'guard-ready.json').is_file())
                self.assertFalse((folder/'guard-ready.partial').exists())
                return dict(exit_confirmed=False, reason='test-no-owner')
            with patch.object(guard, 'CUTOFF_SECONDS', 1), \
                 patch.object(guard.time, 'monotonic', side_effect=[0, 0, .5, 1]), \
                 patch.object(guard.time, 'sleep') as sleep, \
                 patch.object(guard, 'stop_original', side_effect=stop) as stopped:
                guard.run(folder/'guard.json')
                stopped.assert_called_once()
                sleep.assert_called_once_with(.25)
            self.assertFalse(guard.read_json(folder/'guard-result.json')['exit_confirmed'])


if __name__ == '__main__': unittest.main()
