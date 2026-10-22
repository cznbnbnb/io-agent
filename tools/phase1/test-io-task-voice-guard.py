"""Synthetic-only guard contract tests; no HDC, audio, UI or model is invoked."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('task_voice_guard', Path(__file__).with_name('io-task-voice-guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
WALL = 1792300000


def reply(**changes):
    value = dict(schema=1, context_key='synthetic-context', operation_id='synthetic-operation', request_id='synthetic-request',
                 request_revision=7, task_id='synthetic-task', route=dict(computer_id='computer', agent_id='agent', project_id='project', session_id='session'),
                 expires_at=guard.datetime.fromtimestamp(WALL + 40, guard.timezone.utc).isoformat(), question='Synthetic question', mode='free_text', options=[])
    return {**value, **changes}


def draft(b):
    return dict(schema=2, binding=b, plan={}, stage='proposal', cleanup_uid='', cleanup_peer='', card_stage='', used_uids=[],
                option_id=None, text='', input_source='phone', voice_source=None)


def row(b=None, **changes):
    token = dict(format='turboio-task-voice/1', attempt_id='voice-'+'a'*32, peer='SYNTHETIC-PEER', reply=b or reply())
    handle = dict(ownerId=token['attempt_id'], cleanupId='b'*32, uuid='synthetic-uuid-A',
                  directory='/data/synthetic/files/recordings/take-'+'c'*32, peer=token['peer'], connectionEpoch=0)
    return {**dict(schema=1, token=json.dumps(token, ensure_ascii=False, separators=(',', ':')), auth_epoch=8, handle=handle,
                  cancelled=False, stop_requested=False, phase='capturing', text='', origin=None), **changes}


def status(r=None, **changes):
    s = {k: False for k in guard.BOOLS}
    s.update({k: 0 for k in guard.COUNTS})
    s.update({k: '' for k in guard.STRINGS})
    s.update(request_id='synthetic-request', request_revision=7, task_id='synthetic-task', operation_id='synthetic-operation', stage='voice_authorized',
             capture_phase='listening', capture_active=True, exit_evidence='none', binding_applicable=True, capture_metrics_available=False,
             recorder_stop='not_attempted', exit_write='not_attempted', exit_reason=-1, pcm_rms=0, pcm_peak=0,
             transcript_status='pending', boundary_evidence='none')
    r = r or row()
    token = guard.strict_json(r['token'])
    s.update(attempt_id=token['attempt_id'], binding_sha256=guard.digest(r['token']))
    return {**s, **changes}


def idle(**changes):
    return status(**{**dict(stage='proposal', capture_phase='idle', capture_active=False, attempt_id='', binding_sha256='', binding_applicable=False), **changes})


class FakeClock:
    def __init__(self): self.now = 0.0
    def wall(self): return WALL + self.now
    def mono(self): return self.now
    def sleep(self, seconds):
        if seconds < 0: raise AssertionError('negative sleep')
        self.now += seconds


class FakeApi:
    def __init__(self, clock, change=None, saved=None):
        self.clock, self.change, self.saved = clock, change, saved
        self.calls, self.status_count, self.read_count = [], 0, 0
    def read(self, name, seconds):
        self.calls.append((self.clock.now, 'read', name, seconds))
        if name == 'task-decision-draft.json': return draft(reply())
        self.read_count += 1
        return self.saved if self.read_count == 1 else row()
    def exchange(self, action, expected='', seconds=2):
        self.calls.append((self.clock.now, action, expected, seconds))
        if action == 'voice-finish':
            return dict(state='complete', send_attempted=True, transfer_completed=True, control_call_completed=True, task_snapshot=None)
        self.status_count += 1
        s = idle() if self.status_count == 1 else status()
        if self.change and self.status_count > 1:
            s = self.change(self, s)
        return dict(state='complete', task_snapshot=s)


class TaskVoiceGuardTests(unittest.TestCase):
    def run_guard(self, api=None, clock=None):
        clock = clock or FakeClock()
        api = api or FakeApi(clock)
        ready, stopped = [], []
        result = guard.Guard(api, reply(), clock).run(lambda: ready.append(clock.now), before_stop=lambda target: stopped.append(copy.deepcopy(target)))
        return api, clock, result, ready, stopped

    def test_binding_exact_eleven_fields_and_options_order(self):
        self.assertEqual(len(guard.binding(reply())), 11)
        for b in (reply(schema=True), reply(request_revision=True), reply(route={'computer_id':'a'}), reply(mode='choice'), reply(extra='x')):
            with self.subTest(b=b), self.assertRaises(ValueError): guard.binding(b)
        a = reply(mode='choice', options=[dict(option_id='a', label='A'), dict(option_id='b', label='B')])
        r = row(a)
        reversed_binding = {**a, 'options': list(reversed(a['options']))}
        self.assertIsNone(guard.select_target(status(r), r, reversed_binding, ''))

    def test_full_binding_changes_rejected_despite_same_four_ids(self):
        original = reply()
        for changed in (reply(question='Different'), reply(context_key='different'), reply(expires_at=reply()['expires_at'].replace('+00:00', 'Z')),
                        reply(route={**original['route'], 'session_id':'different'})):
            r = row(changed)
            self.assertIsNone(guard.select_target(status(r), r, original, ''))

    def test_original_token_bytes_not_reserialized_hash(self):
        r = row()
        self.assertIsNotNone(guard.select_target(status(r), r, reply(), ''))
        spaced = {**r, 'token': json.dumps(guard.strict_json(r['token']), indent=1)}
        self.assertIsNone(guard.select_target(status(r), spaced, reply(), ''))

    def test_old_restored_cancelled_waiting_and_wrong_stage_never_bind(self):
        r = row()
        for s, item, baseline in ((status(), r, 'voice-'+'a'*32), (status(observation_restored=True), r, ''),
                (status(), row(cancelled=True), ''), (status(), row(stop_requested=True), ''),
                (status(capture_phase='transcribing'), row(phase='waiting'), ''), (status(stage='review'), r, '')):
            self.assertIsNone(guard.select_target(s, item, reply(), baseline))

    def test_malformed_uuid_owner_peer_epoch_and_directory_rejected(self):
        for values in ({'uuid':'../wrong'}, {'ownerId':'voice-'+'d'*32}, {'peer':'OTHER'}, {'cleanupId':'no'},
                       {'connectionEpoch':True}, {'directory':'/data/recordings/../take-'+'c'*32}):
            r = row()
            r['handle'].update(values)
            with self.subTest(values=values), self.assertRaises(ValueError): guard.journal(r)
        for epoch in (0, True, -1):
            with self.assertRaises(ValueError): guard.journal(row(auth_epoch=epoch))
        self.assertIsNotNone(guard.journal(row()))  # auth 8 != recording epoch 0 is valid.

    def test_origin_must_match_exact_uuid_owner_directory_and_peer(self):
        r = row()
        h = r['handle']
        origin = dict(schema=1, name=h['directory'].rsplit('/',1)[1], uuid=h['uuid'], owner_id=h['ownerId'], cleanup_id=h['cleanupId'],
                      peer=h['peer'], raw_bytes=240, raw_sha256='a'*64, result_sha256='b'*64, material_id='synthetic-material', material_revision=1, exit_evidence='device_event')
        r.update(origin=origin, phase='complete', text='synthetic text')
        self.assertIsNotNone(guard.journal(r))
        for key in ('uuid', 'owner_id', 'cleanup_id', 'peer', 'name'):
            changed = copy.deepcopy(r)
            changed['origin'][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(ValueError): guard.journal(changed)

    def test_duplicate_keys_partial_shapes_and_unknown_sensitive_snapshot_rejected(self):
        with self.assertRaises(ValueError): guard.strict_json('{"schema":1,"schema":1}')
        with self.assertRaises(ValueError): guard.strict_json('{"x":NaN}')
        for r in ({}, {**row(), 'partial': True}, {**row(), 'schema': True}):
            with self.assertRaises(ValueError): guard.journal(r)
        for s in ({**status(), 'text':'private'}, {**status(), 'capture_active':1}, {**status(), 'pcm_rms':float('nan')}):
            with self.assertRaises(ValueError): guard.snapshot(s)

    def test_preflight_absent_or_wrong_original_task_does_not_write_phone(self):
        for value in (None, draft(reply(question='different'))):
            c = FakeClock()
            api = FakeApi(c)
            with patch.object(api, 'read', return_value=value), self.assertRaises(ValueError):
                guard.Guard(api, reply(), c).run(lambda: self.fail('must not ready'))
            self.assertEqual(api.status_count, 0)

    def test_expired_or_over_300_seconds_preflight_has_no_transport(self):
        c = FakeClock()
        api = FakeApi(c)
        for expiry in (WALL, WALL-1, WALL+301):
            b = reply(expires_at=guard.datetime.fromtimestamp(expiry, guard.timezone.utc).isoformat())
            with self.assertRaises(ValueError): guard.Guard(api, b, c).run(lambda: self.fail())
        self.assertEqual(api.calls, [])

    def test_paused_active_and_changed_preflight_do_not_ready(self):
        for s in (idle(paused=True), status(), idle(request_revision=8), idle(stage='review')):
            c = FakeClock()
            api = FakeApi(c)
            with patch.object(api, 'exchange', return_value={'state':'complete','task_snapshot':s}), self.assertRaises(ValueError):
                guard.Guard(api, reply(), c).run(lambda: self.fail())

    def test_missing_capture_file_allowed_only_explicit_empty_idle_baseline(self):
        c = FakeClock()
        api = FakeApi(c)
        real_read = api.read
        def read(name, seconds):
            if name == 'task-recording-capture.json' and api.read_count == 0:
                api.read_count += 1
                raise ValueError('synthetic absent')
            return real_read(name, seconds)
        with patch.object(api, 'read', side_effect=read):
            result = guard.Guard(api, reply(), c).run(lambda: None)
        self.assertTrue(result['bound'])
        c = FakeClock()
        api = FakeApi(c)
        with patch.object(api, 'read', side_effect=lambda name, seconds: draft(reply()) if name.startswith('task-decision') else (_ for _ in ()).throw(ValueError())), \
             patch.object(api, 'exchange', return_value={'state':'complete','task_snapshot':idle(capture_phase='draft')}), self.assertRaises(ValueError):
            guard.Guard(api, reply(), c).run(lambda: self.fail())

    def test_115_no_pcm_metrics_is_accepted_and_deadline_binds_once(self):
        api, c, result, ready, stopped = self.run_guard()
        finishes = [x for x in api.calls if x[1] == 'voice-finish']
        self.assertEqual(len(finishes), 1)
        self.assertAlmostEqual(finishes[0][0], 20)
        self.assertEqual(finishes[0][2], guard.digest(row()['token']))
        self.assertEqual(len(stopped), 1)
        self.assertEqual(ready, [0])
        self.assertTrue(result['control_call_completed'])
        self.assertFalse(result['exit_confirmed'])
        self.assertFalse(result['stop_replayed'])

    def test_binding_a_then_b_still_exact_stop_a_at_original_deadline(self):
        def change(api, s):
            return {**s, 'binding_sha256':'d'*64, 'attempt_id':'voice-'+'d'*32} if api.status_count > 3 else s
        c = FakeClock()
        api, _, result, _, _ = self.run_guard(FakeApi(c, change), c)
        finishes = [x for x in api.calls if x[1] == 'voice-finish']
        self.assertEqual([(x[0], x[2]) for x in finishes], [(20, guard.digest(row()['token']))])
        self.assertTrue(result['replacement_observed'])
        self.assertFalse(result['exit_confirmed'])

    def test_observation_failure_after_a_does_not_disarm_or_replay(self):
        def change(api, s):
            if api.status_count > 3: raise ValueError('synthetic timeout')
            return s
        c = FakeClock()
        api, _, result, _, _ = self.run_guard(FakeApi(c, change), c)
        finishes = [x for x in api.calls if x[1] == 'voice-finish']
        self.assertEqual(len(finishes), 1)
        self.assertEqual(finishes[0][0], 20)
        self.assertTrue(result['observation_failed'])

    def test_unknown_or_running_stop_does_not_overwrite_inbox_with_status(self):
        for stop_state in ('unknown', 'running'):
            with self.subTest(stop_state=stop_state):
                c = FakeClock()
                api = FakeApi(c)
                original = api.exchange
                def exchange(action, expected='', seconds=2):
                    if action != 'voice-finish': return original(action, expected, seconds)
                    api.calls.append((c.now, action, expected, seconds))
                    c.sleep(seconds)
                    return dict(state=stop_state, send_attempted=True, transfer_completed=True, control_call_completed=False)
                with patch.object(api, 'exchange', side_effect=exchange):
                    _, _, result, _, _ = self.run_guard(api, c)
                writes = [x for x in api.calls if x[1] == 'voice-finish']
                self.assertEqual(len(writes), 1)
                self.assertEqual(writes[0][2], guard.digest(row()['token']))
                self.assertEqual(api.calls[-1][1], 'voice-finish')
                self.assertEqual(c.now, 22)
                self.assertEqual(result['reason'], 'stop_receipt_unknown_inbox_preserved')
                self.assertFalse(result['exit_confirmed'])
                self.assertFalse(result['stop_replayed'])

    def test_unverifiable_stop_receipt_also_preserves_original_inbox(self):
        c = FakeClock()
        api = FakeApi(c)
        original = api.exchange
        def exchange(action, expected='', seconds=2):
            if action != 'voice-finish': return original(action, expected, seconds)
            api.calls.append((c.now, action, expected, seconds))
            api.last_outcome = dict(send_attempted=True, transfer_completed=True)
            raise ValueError('synthetic corrupt receipt')
        with patch.object(api, 'exchange', side_effect=exchange):
            _, _, result, _, _ = self.run_guard(api, c)
        self.assertEqual(api.calls[-1][1], 'voice-finish')
        self.assertEqual(api.calls[-1][2], guard.digest(row()['token']))
        self.assertEqual(sum(x[1] == 'voice-finish' for x in api.calls), 1)
        self.assertTrue(result['stop_send_attempted'])
        self.assertFalse(result['control_call_completed'])
        self.assertFalse(result['exit_confirmed'])

    def test_stop_command_ten_second_consumption_lifetime_has_two_second_total_io_budget(self):
        c, sent, calls = FakeClock(), [], []
        def transfer(cfg, direction, source, target, seconds):
            calls.append((direction, seconds))
            if direction == 'send': sent.append(json.loads(Path(source).read_text(encoding='utf8')))
            c.sleep(min(.7, seconds))
            return direction == 'send'
        with tempfile.TemporaryDirectory() as temp, patch.object(guard, 'transfer', side_effect=transfer):
            result = guard.Hdc(Path(temp), {'hdc':'synthetic', 'device':'synthetic'}, c).exchange('voice-finish', 'a'*64, 2)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['expected_voice_binding'], 'a'*64)
        self.assertAlmostEqual(guard.stamp(sent[0]['expires_at']) - guard.stamp(sent[0]['created_at']), 10)
        self.assertLessEqual(c.now, 2)
        self.assertAlmostEqual(calls[0][1], 2)
        self.assertEqual(result['state'], 'unknown')

    def test_local_seal_receipt_empty_journal_and_changed_attempt_are_not_exit(self):
        target = guard.select_target(status(), row(), reply(), '')
        for s in (status(stop_submitted=True, worker_exited=True, input_sealed=True), idle(),
                  status(exit_evidence='user_confirmation'), status(exit_evidence='device_event', binding_sha256='d'*64)):
            self.assertFalse(guard.confirms_exit(s, target))
        self.assertTrue(guard.confirms_exit(status(exit_evidence='device_event'), target))
        self.assertIsNone(guard.journal(None))

    def test_device_event_retained_without_following_clear_or_new_draft(self):
        def change(api, s):
            return {**s, 'capture_active':False, 'capture_phase':'transcribing', 'exit_evidence':'device_event'} if api.status_count > 3 else s
        c = FakeClock()
        api, _, result, _, _ = self.run_guard(FakeApi(c, change), c)
        self.assertTrue(result['exit_confirmed'])
        self.assertFalse(any(x[1] == 'voice-finish' for x in api.calls))

    def test_no_new_authorization_expires_without_any_finish(self):
        c = FakeClock()
        api, _, result, _, _ = self.run_guard(FakeApi(c, lambda api, s: idle()), c)
        self.assertFalse(result['bound'])
        self.assertFalse(any(x[1] == 'voice-finish' for x in api.calls))
        self.assertAlmostEqual(c.now, 43)

    def test_transport_send_receipt_and_sleep_share_strict_budget_no_resend(self):
        c, calls = FakeClock(), []
        def transfer(cfg, direction, source, target, seconds):
            calls.append((direction, seconds))
            c.sleep(min(.7, seconds))
            return direction == 'send'
        with tempfile.TemporaryDirectory() as temp, patch.object(guard, 'transfer', side_effect=transfer):
            result = guard.Hdc(Path(temp), {'hdc':'synthetic', 'device':'synthetic'}, c).exchange('voice-finish', 'a'*64, 1)
        self.assertLessEqual(c.now, 1)
        self.assertEqual(sum(x[0] == 'send' for x in calls), 1)
        self.assertAlmostEqual(calls[1][1], .3)
        self.assertTrue(result['send_attempted'])
        self.assertTrue(result['transfer_completed'])
        self.assertFalse(result['control_call_completed'])

    def test_transport_timeout_is_unknown_and_never_device_exit(self):
        with patch.object(guard.subprocess, 'run', side_effect=subprocess.TimeoutExpired('synthetic', 1)):
            self.assertFalse(guard.transfer({'hdc':'synthetic','device':'synthetic'}, 'send', 'a', 'b', 1))

    def test_running_claim_without_snapshot_is_not_completed_or_replayed(self):
        c, sent, receives = FakeClock(), [], []
        def transfer(cfg, direction, source, target, seconds):
            c.sleep(min(.1, seconds))
            if direction == 'send':
                sent.append(json.loads(Path(source).read_text(encoding='utf8')))
            else:
                receives.append(True)
                value = dict(schema=1, id=sent[0]['id'], request_json=json.dumps(sent[0]), state='running', started_at='', finished_at='', error='',
                             snapshot={}, control_call_completed=False)
                Path(target).write_text(json.dumps(value), encoding='utf8')
            return True
        with tempfile.TemporaryDirectory() as temp, patch.object(guard, 'transfer', side_effect=transfer):
            result = guard.Hdc(Path(temp), {'hdc':'synthetic','device':'synthetic'}, c).exchange('voice-finish', 'a'*64, 1)
        self.assertEqual(len(sent), 1)
        self.assertGreater(len(receives), 0)
        self.assertFalse(result['control_call_completed'])
        self.assertEqual(result['state'], 'unknown')
        self.assertLessEqual(c.now, 1)

    def test_receipt_id_content_corruption_or_extra_data_rejected_without_replay(self):
        for change in ({'id':'dbg-'+'d'*32}, {'request_json':'{}'}, {'control_call_completed':1}, {'private_body':'bad'}):
            c, sent = FakeClock(), []
            def transfer(cfg, direction, source, target, seconds):
                c.sleep(.1)
                if direction == 'send':
                    sent.append(json.loads(Path(source).read_text(encoding='utf8')))
                else:
                    value = dict(schema=1, id=sent[0]['id'], request_json=json.dumps(sent[0]), state='complete', started_at='', finished_at='', error='',
                                 snapshot={}, task_snapshot=status(), control_call_completed=True)
                    Path(target).write_text(json.dumps({**value, **change}), encoding='utf8')
                return True
            with tempfile.TemporaryDirectory() as temp, patch.object(guard, 'transfer', side_effect=transfer), self.assertRaises(ValueError):
                guard.Hdc(Path(temp), {'hdc':'synthetic','device':'synthetic'}, c).exchange('voice-finish', 'a'*64)
            self.assertEqual(len(sent), 1)

    def test_no_start_confirm_clear_recover_or_cancel_actions(self):
        with tempfile.TemporaryDirectory() as temp:
            api = guard.Hdc(Path(temp), {'hdc':'synthetic','device':'synthetic'}, FakeClock())
            for action in ('start', 'voice-cancel', 'voice-recover', 'clear', 'confirm-exit', 'cleanup', 'show-card'):
                with self.assertRaises(ValueError): api.exchange(action)
            self.assertEqual(list(Path(temp).iterdir()), [])

    def test_private_file_limit_symlink_and_duplicate_input_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'reply.json'
            path.write_text('x'*65536, encoding='ascii')
            with self.assertRaises(ValueError): guard.private_read(path, 65536)
            path.write_text('{"schema":1,"schema":1}', encoding='ascii')
            with self.assertRaises(ValueError): guard.private_read(path, 65536)

    def test_single_device_lock_excludes_second_guard(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(guard.transport, 'PRIVATE', Path(temp)):
            with guard.transport.note_local_lock('task-voice-guard-synthetic'):
                with self.assertRaises(ValueError):
                    with guard.transport.note_local_lock('task-voice-guard-synthetic'):
                        self.fail('second guard acquired lock')

    def test_child_reentry_never_replays_old_guard_or_transfer(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = root/'guard.json'
            guard.durable(job, dict(schema=1, nonce='a'*32, hdc='synthetic', device='synthetic', reply=reply()))
            with patch.object(guard, 'PRIVATE', root), patch.object(guard.transport, 'PRIVATE', root), \
                 patch.object(guard.Guard, 'run', return_value={'ready':False,'exit_confirmed':False}) as run, \
                 patch.object(guard, 'transfer', side_effect=AssertionError('no phone')):
                guard.child(job)
                with self.assertRaises(FileExistsError): guard.child(job)
                self.assertEqual(run.call_count, 1)

    def test_readiness_requires_live_process_nonce_fresh_heartbeat_and_unexpired_task(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = root/'guard.json'
            guard.durable(job, dict(schema=1, nonce='a'*32, hdc='synthetic', device='synthetic', reply=reply()))
            guard.durable(root/'guard.ready', dict(pid=1234, nonce='a'*32, expires_at=reply()['expires_at']))
            guard.durable(root/'heartbeat.json', dict(pid=1234, nonce='a'*32, at=WALL))
            with patch.object(guard, 'PRIVATE', root), patch.object(guard.time, 'time', return_value=WALL), patch.object(guard, 'process_alive', return_value=True):
                self.assertTrue(guard.live(job))
                with patch.object(guard, 'process_alive', return_value=False): self.assertFalse(guard.live(job))
                with patch.object(guard.time, 'time', return_value=WALL+5): self.assertFalse(guard.live(job))
                (root/'heartbeat.json').write_text(json.dumps(dict(pid=1234, nonce='b'*32, at=WALL)), encoding='utf8')
                self.assertFalse(guard.live(job))
                (root/'heartbeat.json').write_text(json.dumps(dict(pid=1234, nonce='a'*32, at=WALL+41)), encoding='utf8')
                with patch.object(guard.time, 'time', return_value=WALL+41): self.assertFalse(guard.live(job))


if __name__ == '__main__':
    unittest.main()
