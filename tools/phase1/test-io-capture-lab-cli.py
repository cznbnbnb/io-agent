import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('lab_cli', Path(__file__).with_name('io-capture-lab-cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def snapshot(**change):
    s = {k: False for k in cli.BOOLS}
    s.update({k: 0 for k in cli.COUNTS})
    s.update(phase='listening', active=True, connected=True, foreground=True, applicable=True, metrics_available=True,
             attempt_sha256='a'*64, expected_binding='b'*64, expected_peer='c'*64, expected_connection=7,
             exit_evidence='none', recorder_stop='not_attempted', exit_write='not_attempted',
             last_compressed_sha256='', pcm_rms=0, pcm_peak=0, exit_reason=-1, transcript_status='pending', boundary_evidence='none')
    return {**s, **change}


class LabGuardTests(unittest.TestCase):
    def test_controls_require_exact_applicable_snapshot_and_have_no_start(self):
        valid = snapshot()
        self.assertEqual(cli.command('stop', valid)['expected_binding'], 'b'*64)
        for changed in ({'applicable': False}, {'connected': False}, {'expected_connection': 0}, {'expected_binding': ''}):
            with self.assertRaises(ValueError): cli.command('stop', {**valid, **changed})
        for action in ('start', 'clear', 'confirm-exit'):
            with self.assertRaises(ValueError): cli.command(action, valid)

    def test_snapshot_rejects_sensitive_or_malformed_extra_fields(self):
        valid = snapshot()
        self.assertTrue(cli.snapshot_valid(valid))
        for change in ({'text': 'private'}, {'binding': 'capture-lab-secret'}, {'type1_packets': -1}, {'pcm_rms': float('nan')}, {'expected_connection': True}):
            self.assertFalse(cli.snapshot_valid({**valid, **change}))

    def test_old_or_restored_attempt_never_becomes_new_guard_target(self):
        self.assertFalse(cli.select_attempt(snapshot(), 'a'*64))
        self.assertFalse(cli.select_attempt(snapshot(metrics_available=False, observation_restored=True), ''))
        self.assertFalse(cli.select_attempt(snapshot(phase='cleanup_pending'), ''))
        self.assertFalse(cli.select_attempt(snapshot(applicable=False), ''))
        for change in ({'expected_binding': ''}, {'expected_peer': ''}, {'expected_connection': 0}, {'observation_restored': True}):
            self.assertFalse(cli.select_attempt(snapshot(**change), ''))

    def test_write_completion_or_local_seal_does_not_prove_device_exit(self):
        local = snapshot(active=False, phase='cleanup_pending', stop_submitted=True, worker_exited=True, input_sealed=True,
                         recorder_stop='submitted', exit_write='submitted')
        self.assertFalse(cli.confirms_exit(local, 'a'*64))
        self.assertTrue(cli.confirms_exit({**local, 'exit_evidence': 'device_event'}, 'a'*64))
        self.assertFalse(cli.confirms_exit({**local, 'exit_evidence': 'device_event'}, 'd'*64))

    def test_transport_timeout_is_not_a_delivery_receipt(self):
        with patch.object(cli.subprocess, 'run', side_effect=subprocess.TimeoutExpired('synthetic', 3)):
            self.assertFalse(cli.transfer('synthetic', 'synthetic', 'send', 'a', 'b'))

    def test_exchange_send_recv_and_sleep_share_one_total_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            now, calls = [0.0], []
            def transfer(hdc, device, direction, source, target, timeout=3):
                calls.append((direction, timeout))
                now[0] += min(.7, timeout)
                return direction == 'send'
            with patch.object(cli.time, 'monotonic', side_effect=lambda: now[0]), \
                 patch.object(cli.time, 'sleep', side_effect=lambda n: now.__setitem__(0, now[0]+n)), \
                 patch.object(cli, 'transfer', side_effect=transfer):
                result = cli.exchange(Path(directory)/'request', {'hdc': 'synthetic', 'device': 'synthetic'}, cli.command('status'), seconds=1)
            self.assertLessEqual(now[0], 1)
            self.assertAlmostEqual(calls[0][1], 1)
            self.assertAlmostEqual(calls[1][1], .3)
            self.assertEqual(result['state'], 'unknown')

    def guard_fixture(self, exchange):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        folder, now = Path(directory.name), [0.0]
        cfg = {'hdc': 'synthetic', 'device': 'synthetic', 'seconds': 25, 'baseline': ''}
        calls = []
        def run(path, cfg, command, seconds=5):
            calls.append((now[0], dict(command)))
            return exchange(path, command, now[0], len(calls))
        with patch.object(cli.time, 'monotonic', side_effect=lambda: now[0]), \
             patch.object(cli.time, 'sleep', side_effect=lambda n: now.__setitem__(0, now[0]+n)), \
             patch.object(cli, 'exchange', side_effect=run):
            cli.guard_armed(folder, cfg)
        return calls, json.loads((folder/'guard-result.json').read_text(encoding='utf8'))

    def test_guard_deadline_survives_observation_failure_and_stops_only_once(self):
        def exchange(path, command, now, count):
            if command['action'] == 'stop': return {'state': 'complete'}
            if count == 1: return {'state': 'complete', 'snapshot': snapshot()}
            if now < 25: raise ValueError('unreadable status')
            return {'state': 'complete', 'snapshot': snapshot(active=False, phase='draft', worker_exited=True, input_sealed=True, exit_evidence='device_event')}
        calls, result = self.guard_fixture(exchange)
        writes = [(at, c) for at, c in calls if c['action'] != 'status']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], 25)
        self.assertEqual(writes[0][1]['expected_binding'], 'b'*64)
        self.assertTrue(result['exit_confirmed'])
        self.assertFalse(result['stop_replayed'])

    def test_guard_refuses_to_follow_a_replacement_attempt(self):
        def exchange(path, command, now, count):
            return {'state': 'complete', 'snapshot': snapshot(attempt_sha256=('a' if count == 1 else 'd')*64)}
        calls, result = self.guard_fixture(exchange)
        writes = [(at, c) for at, c in calls if c['action'] != 'status']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], 25)
        self.assertEqual(writes[0][1]['expected_binding'], 'b'*64)
        self.assertFalse(result['exit_confirmed'])
        self.assertTrue(result['replacement_observed'])
        self.assertEqual(result['reason'], 'attempt_changed_after_stop')

    def test_guard_does_not_stop_an_unbound_or_restored_capture(self):
        calls, result = self.guard_fixture(lambda *args: {'state': 'complete', 'snapshot': snapshot(metrics_available=False, observation_restored=True)})
        self.assertTrue(all(c['action'] == 'status' for _, c in calls))
        self.assertFalse(result['stop_sent'])
        self.assertFalse(result['exit_confirmed'])

    def test_disconnect_redaction_does_not_disarm_the_original_deadline(self):
        def exchange(path, command, now, count):
            if count == 1: return {'state': 'complete', 'snapshot': snapshot()}
            if command['action'] == 'stop': return {'state': 'error'}
            return {'state': 'complete', 'snapshot': snapshot(connected=False, applicable=False, attempt_sha256='', expected_binding='', expected_peer='', expected_connection=0)}
        calls, result = self.guard_fixture(exchange)
        writes = [(at, c) for at, c in calls if c['action'] != 'status']
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][0], 25)
        self.assertEqual(writes[0][1]['expected_connection'], 7)
        self.assertNotIn('replacement_observed', result)
        self.assertFalse(result['exit_confirmed'])

    def test_cleanup_is_not_retried_or_exit_forged_when_device_gives_no_ack(self):
        calls, result = self.guard_fixture(lambda *args: {'state': 'complete', 'snapshot': snapshot(input_sealed=True, worker_exited=True, stop_submitted=True)})
        self.assertEqual([c['action'] for _, c in calls if c['action'] != 'status'], ['stop'])
        self.assertFalse(result['exit_confirmed'])
        self.assertTrue(result['cleanup_pending'])


if __name__ == '__main__':
    unittest.main()
