import importlib.util
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('io_card_cli', Path(__file__).with_name('io-card-cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class CachedPowerTests(unittest.TestCase):
    def test_matching_actual_rx_is_timestamped_but_still_cached(self):
        body = {'generalSettings': {'autoLockTime': 15}}
        result = cli.cached_power(json.dumps(body), json.dumps({'t': 100000, 'dir': 'rx', 'type': 4, 'json': json.dumps(body)}), now=110)
        self.assertEqual(result['auto_lock_seconds'], 15)
        self.assertEqual(result['cache_age_seconds'], 10)
        self.assertTrue(result['last_rx_matches_cache'])
        self.assertFalse(result['fresh_device_query_performed'])
        self.assertIsNone(result['notification_timeout_seconds'])

    def test_newer_conflicting_rx_does_not_adopt_an_older_matching_timestamp(self):
        body = {'generalSettings': {'autoLockTime': 15}}
        rows = [{'t': 100000, 'dir': 'rx', 'type': 4, 'json': json.dumps(body)},
                {'t': 105000, 'dir': 'rx', 'type': 4, 'json': json.dumps({'generalSettings': {'autoLockTime': 5}})}]
        result = cli.cached_power(json.dumps(body), '\n'.join(map(json.dumps, rows)), now=110)
        self.assertFalse(result['last_rx_matches_cache'])
        self.assertIsNone(result['last_device_read_at'])
        self.assertIsNone(result['cache_age_seconds'])

    def test_missing_rx_or_tx_does_not_become_device_evidence(self):
        body = {'generalSettings': {'autoLockTime': 15}}
        for trace in ['', '{truncated', json.dumps({'t': 100000, 'dir': 'tx', 'type': 4, 'json': json.dumps(body)})]:
            result = cli.cached_power(json.dumps(body), trace)
            self.assertFalse(result['last_rx_matches_cache'])
            self.assertIsNone(result['last_device_read_at'])

    def test_invalid_unknown_and_boolean_settings_fail_instead_of_inventing_a_default(self):
        for body in [{}, [], None, {'generalSettings': []}, {'generalSettings': None},
                     {'generalSettings': {'autoLockTime': True}}, {'generalSettings': {'autoLockTime': '15'}}]:
            with self.assertRaises(ValueError):
                cli.cached_power(json.dumps(body), '')

    def test_invalid_or_future_timestamp_does_not_create_readback_age(self):
        body = {'generalSettings': {'autoLockTime': 15}}
        for timestamp in [True, -1, 0, 110001, 10 ** 100]:
            result = cli.cached_power(json.dumps(body), json.dumps({'t': timestamp, 'dir': 'rx', 'type': 4, 'json': body}), now=110)
            self.assertIsNone(result['last_device_read_at'])
            self.assertIsNone(result['cache_age_seconds'])


class CommandTests(unittest.TestCase):
    def test_legacy_card_commands_keep_exact_six_field_schema(self):
        command = cli.make_command('show-card', 'dbg-' + 'a' * 32)
        self.assertEqual(command['schema'], 1)
        self.assertEqual(set(command), {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid'})
        self.assertNotIn('expected_voice_binding', command)

    def test_task_commands_require_exact_observed_hash_and_never_voice_start(self):
        read = cli.make_command('task-status', 'dbg-' + 'a' * 32)
        self.assertEqual(read['schema'], 2)
        self.assertEqual(read['expected_voice_binding'], '')
        self.assertEqual(len(read), 7)
        for action in ['voice-finish', 'voice-cancel', 'voice-recover']:
            command = cli.make_command(action, 'dbg-' + 'a' * 32, binding_sha256='b' * 64)
            self.assertEqual(command['expected_voice_binding'], 'b' * 64)
            self.assertEqual(command['expected_uid'], '')
            for bad in ['', 'b' * 63, 'B' * 64]:
                with self.assertRaises(ValueError):
                    cli.make_command(action, 'dbg-' + 'a' * 32, binding_sha256=bad)
        for action in ['voice-start', 'submit', 'set-stage', 'semantic-cmd']:
            with self.assertRaises(ValueError):
                cli.make_command(action, 'dbg-' + 'a' * 32)

    def test_cross_channel_bindings_are_rejected_before_host_intent_or_transfer(self):
        for action, uid, binding in [('task-status', '', 'a' * 64), ('voice-finish', 'p10-card', 'a' * 64),
                                     ('show-card', '', 'a' * 64), ('remove-card', 'p10-card', 'a' * 64),
                                     ('status', 'p10-card', ''), ('remove-card', '', '')]:
            with self.assertRaises(ValueError):
                cli.make_command(action, 'dbg-' + 'a' * 32, uid, binding)

    def test_review_card_uses_exact_seven_field_schema3_and_a_separate_complete_reply_hash(self):
        command = cli.make_command('review-card', 'dbg-' + 'a' * 32, reply_binding_sha256='c' * 64)
        self.assertEqual(command['schema'], 3)
        self.assertEqual(set(command), {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid', 'expected_reply_binding'})
        self.assertEqual(command['expected_uid'], '')
        self.assertEqual(command['expected_reply_binding'], 'c' * 64)
        self.assertNotIn('expected_voice_binding', command)
        for invalid in ['', 'c' * 63, 'C' * 64, 'complete private answer']:
            with self.assertRaises(ValueError):
                cli.make_command('review-card', 'dbg-' + 'a' * 32, reply_binding_sha256=invalid)

    def test_review_and_voice_hash_arguments_cannot_be_crossed_or_combined(self):
        for action in ['status', 'show-card', 'remove-card', 'task-status', 'voice-finish', 'voice-cancel', 'voice-recover']:
            with self.assertRaises(ValueError):
                cli.make_command(action, 'dbg-' + 'a' * 32, reply_binding_sha256='b' * 64)
        for uid, binding in [('p10-card', ''), ('', 'a' * 64), ('p10-card', 'a' * 64)]:
            with self.assertRaises(ValueError):
                cli.make_command('review-card', 'dbg-' + 'a' * 32, uid, binding, reply_binding_sha256='b' * 64)

    def test_reconcile_and_cached_power_reject_reply_bindings_before_any_transfer(self):
        for argv in [['card-cli', 'reconcile', '--id', 'dbg-' + 'a' * 32, '--reply-binding-sha256', 'b' * 64],
                     ['card-cli', 'cached-power', '--reply-binding-sha256', 'b' * 64]]:
            with patch.object(cli.sys, 'argv', argv), patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main()
                transfer.assert_not_called()

    def test_review_host_intent_and_reconcile_never_reissue_a_display_or_claim_answer_submission(self):
        command, directions = {}, []

        def transfer(_hdc, _device, direction, source, target):
            directions.append(direction)
            if direction == 'send':
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
            else:
                result = {'schema': 1, 'id': command['id'], 'request_json': json.dumps(command),
                          'state': 'complete', 'error': '', 'started_at': command['created_at'], 'finished_at': command['created_at'],
                          'snapshot': {}, 'task_snapshot': {'stage': 'review', 'review_ready': False, 'draft_saved': True},
                          'control_call_completed': True}
                Path(target).write_text(json.dumps(result), encoding='utf-8')
            return True

        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-card-cli-') as folder, \
                patch.object(cli, 'PRIVATE', Path(folder)), patch.object(cli, 'transfer', side_effect=transfer):
            output = io.StringIO()
            with patch.object(cli.sys, 'argv', ['card-cli', 'review-card', '--reply-binding-sha256', 'b' * 64]), contextlib.redirect_stdout(output):
                self.assertEqual(cli.main(), 0)
            intent, receipt = map(json.loads, output.getvalue().splitlines())
            self.assertFalse(intent['synthetic_card_only'])
            self.assertFalse(intent['opens_microphone'])
            self.assertFalse(intent['submits_answer'])
            self.assertTrue(intent['requires_physical_confirmation'])
            self.assertFalse(receipt['lens_display_verified'])
            self.assertIn('control_call_only', receipt['completion_scope'])
            self.assertEqual(command['schema'], 3)
            self.assertEqual(len(command), 7)
            self.assertEqual(directions, ['send', 'recv'])
            directions.clear()
            with patch.object(cli.sys, 'argv', ['card-cli', 'reconcile', '--id', command['id']]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(), 0)
            self.assertEqual(directions, ['recv'])


class RecoveryCommandTests(unittest.TestCase):
    def test_recovery_schema4_has_exact_eight_fields_and_only_explicit_local_sources(self):
        command_id = 'dbg-' + 'a' * 32
        keys = {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid',
                'expected_recovery_binding', 'recovery_source'}
        status = cli.make_command('recovery-status', command_id)
        self.assertEqual(set(status), keys)
        self.assertEqual(status['schema'], 4)
        self.assertEqual(status['expected_uid'], '')
        self.assertEqual(status['expected_recovery_binding'], '')
        self.assertEqual(status['recovery_source'], '')
        for source in ['main', 'partial', 'resume']:
            with self.subTest(source=source):
                command = cli.make_command('recovery-restore', command_id,
                                           recovery_binding_sha256='b' * 64, recovery_source=source)
                self.assertEqual(set(command), keys)
                self.assertEqual(command['schema'], 4)
                self.assertEqual(command['recovery_source'], source)
                self.assertEqual(command['expected_recovery_binding'], 'b' * 64)
                self.assertNotIn('expected_voice_binding', command)
                self.assertNotIn('expected_reply_binding', command)

    def test_status_accepts_no_selection_and_restore_requires_a_strong_hash_and_known_source(self):
        command_id = 'dbg-' + 'a' * 32
        for kwargs in [{'recovery_binding_sha256': 'b' * 64}, {'recovery_source': 'main'},
                       {'recovery_binding_sha256': 'b' * 64, 'recovery_source': 'main'}]:
            with self.subTest(status=kwargs), self.assertRaises(ValueError):
                cli.make_command('recovery-status', command_id, **kwargs)
        for binding in ['', 'b' * 63, 'B' * 64, 'private full answer']:
            with self.subTest(binding=binding), self.assertRaises(ValueError):
                cli.make_command('recovery-restore', command_id,
                                 recovery_binding_sha256=binding, recovery_source='partial')
        for source in ['', 'unknown', '../main', 'D:/private/task-decision-draft.json', 'main.original']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                cli.make_command('recovery-restore', command_id,
                                 recovery_binding_sha256='b' * 64, recovery_source=source)

    def test_recovery_bindings_cannot_mix_with_legacy_voice_or_review_schemas(self):
        command_id = 'dbg-' + 'a' * 32
        for action in ['status', 'show-card', 'remove-card', *cli.TASK_ACTIONS, cli.REVIEW_ACTION]:
            for kwargs in [{'recovery_binding_sha256': 'b' * 64}, {'recovery_source': 'main'}]:
                with self.subTest(action=action, kwargs=kwargs), self.assertRaises(ValueError):
                    cli.make_command(action, command_id, **kwargs)
        for action in cli.RECOVERY_ACTIONS:
            for kwargs in [{'uid': 'p10-card'}, {'binding_sha256': 'a' * 64}, {'reply_binding_sha256': 'a' * 64}]:
                with self.subTest(action=action, kwargs=kwargs), self.assertRaises(ValueError):
                    cli.make_command(action, command_id, recovery_binding_sha256='b' * 64,
                                     recovery_source='partial', **kwargs)

    def test_invalid_recovery_arguments_and_injected_text_fail_before_any_transfer(self):
        base = ['card-cli', 'recovery-restore', '--recovery-binding-sha256', 'b' * 64]
        invalid = [base + ['--recovery-source', '../escape'], base + ['--recovery-source', 'unknown'],
                   base + ['--recovery-source', 'partial', '--text', 'injected full answer'],
                   base + ['--recovery-source', 'main', '--reply-binding-sha256', 'a' * 64],
                   ['card-cli', 'recovery-status', '--recovery-binding-sha256', 'b' * 64],
                   ['card-cli', 'recovery-status', '--recovery-source', 'partial']]
        for action in ['reconcile', 'cached-power']:
            for extra in [['--recovery-binding-sha256', 'b' * 64], ['--recovery-source', 'resume']]:
                invalid.append(['card-cli', action, *(['--id', 'dbg-' + 'a' * 32] if action == 'reconcile' else []), *extra])
        for argv in invalid:
            with self.subTest(argv=argv), patch.object(cli.sys, 'argv', argv), \
                    patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main()
                transfer.assert_not_called()

    def run_recovery_transfer(self, action, *, error=False, ambiguous_send=False):
        """Only synthetic files below this test process's D: temporary directory."""
        self.assertEqual(Path(__file__).resolve().drive.upper(), 'D:')
        command, directions = {}, []
        metadata = {'phase': 'protected', 'inspection_sha256': 'c' * 64,
                    'transaction_id': '', 'can_resume': error, 'reason': '',
                    'main': {'present': True, 'valid': True, 'eligible': True, 'bytes': 300,
                             'text_length': 22, 'sha256': 'd' * 64, 'stage': 'review', 'reason': ''},
                    'partial': {'present': False, 'valid': False, 'eligible': False,
                                'bytes': 0, 'text_length': 0, 'sha256': '', 'stage': '', 'reason': 'missing'}}

        def transfer(_hdc, _device, direction, source, target):
            directions.append(direction)
            if direction == 'send':
                self.assertTrue(Path(source).is_file(), 'host intent must already exist before mocked transfer')
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
                self.assertEqual(command['schema'], 4)
                self.assertEqual(len(command), 8)
                return not ambiguous_send
            result = {'schema': 1, 'id': command['id'], 'request_json': json.dumps(command),
                      'state': 'error' if error else 'complete',
                      'error': 'DEBUG_OPERATION_FAILED' if error else '',
                      'started_at': command['created_at'], 'finished_at': command['created_at'],
                      'snapshot': {}, 'task_snapshot': {'stage': 'review', 'draft_saved': False},
                      'recovery_snapshot': metadata, 'control_call_completed': not error}
            Path(target).write_text(json.dumps(result), encoding='utf-8')
            return True

        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-recovery-cli-') as folder, \
                patch.object(cli, 'PRIVATE', Path(folder)), patch.object(cli, 'transfer', side_effect=transfer), \
                patch.object(cli.subprocess, 'run', side_effect=AssertionError('no actual HDC or subprocess')):
            argv = ['card-cli', action]
            if action == 'recovery-restore':
                argv += ['--recovery-binding-sha256', 'b' * 64, '--recovery-source', 'partial']
            output = io.StringIO()
            with patch.object(cli.sys, 'argv', argv), contextlib.redirect_stdout(output):
                self.assertEqual(cli.main(), 2 if ambiguous_send else 1 if error else 0)
            rows = list(map(json.loads, output.getvalue().splitlines()))
            intent = rows[0]
            self.assertFalse(intent['synthetic_card_only'])
            self.assertFalse(intent['opens_microphone'])
            self.assertFalse(intent['submits_answer'])
            self.assertFalse(intent['requires_physical_confirmation'])
            self.assertEqual(intent['restores_paused_local_draft_only'], action == 'recovery-restore')
            self.assertEqual(directions, ['send'] if ambiguous_send else ['send', 'recv'])
            if not ambiguous_send:
                receipt = rows[1]
                self.assertEqual(receipt['recovery_snapshot'], metadata)
                self.assertEqual(receipt['control_call_completed'], not error)
                self.assertFalse(receipt['draft_saved'])
                self.assertFalse(receipt['lens_display_verified'])
                self.assertIn('local_recovery_control_only', receipt['completion_scope'])
                self.assertIn('no answer submitted', receipt['completion_scope'])
                self.assertNotIn('task_completed', receipt)
                self.assertNotIn('answer_accepted', receipt)
            else:
                self.assertEqual(rows[1]['state'], 'unknown')
                self.assertIn('do not resend', rows[1]['next'])
            directions.clear()
            reconciled = io.StringIO()
            with patch.object(cli.sys, 'argv', ['card-cli', 'reconcile', '--id', command['id']]), \
                    contextlib.redirect_stdout(reconciled):
                self.assertEqual(cli.main(), 1 if error else 0)
            self.assertEqual(directions, ['recv'], 'reconcile must never resend restoration or status')
            receipt = json.loads(reconciled.getvalue())
            self.assertEqual(receipt['recovery_snapshot'], metadata)
            self.assertEqual(receipt['recovery_snapshot']['can_resume'], error)
            self.assertIn('no answer submitted', receipt['completion_scope'])

    def test_recovery_status_returns_only_metadata_and_reconcile_receives_without_resending(self):
        self.run_recovery_transfer('recovery-status')

    def test_explicit_restore_completion_is_local_control_not_an_answer_or_device_effect(self):
        self.run_recovery_transfer('recovery-restore')

    def test_failed_restore_keeps_new_metadata_for_explicit_resume_and_error_reconcile_never_retries(self):
        self.run_recovery_transfer('recovery-restore', error=True)

    def test_ambiguous_restore_transfer_persists_original_intent_and_reconcile_never_reissues_it(self):
        self.run_recovery_transfer('recovery-restore', ambiguous_send=True)


class LocalQueryCommandTests(unittest.TestCase):
    @staticmethod
    def query(**changes):
        return {'from': 0, 'to': 0, 'keyword': '运费', 'speaker': '', 'limit': 10, 'cursor': '', **changes}

    def test_schema5_is_exact_read_only_query_without_other_bindings(self):
        query = self.query(speaker='发言人A', cursor='a' * 64 + ':0')
        command = cli.make_command('search-local', 'dbg-' + 'a' * 32, local_query=query)
        self.assertEqual(command['schema'], 5)
        self.assertEqual(set(command), {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid', 'local_query'})
        self.assertEqual(command['expected_uid'], '')
        self.assertEqual(command['local_query'], query)
        query['keyword'] = 'changed after construction'
        self.assertEqual(command['local_query']['keyword'], '运费')
        for extra in [{'uid': 'p10-card'}, {'binding_sha256': 'a' * 64}, {'reply_binding_sha256': 'a' * 64},
                      {'recovery_binding_sha256': 'a' * 64}, {'recovery_source': 'main'}]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                cli.make_command('search-local', 'dbg-' + 'a' * 32, local_query=self.query(), **extra)

    def test_filter_rejects_unknown_fields_invalid_ranges_text_bounds_and_noncanonical_cursors(self):
        invalid = [None, {}, [], self.query(extra='unknown'), self.query(**{'from': True}), self.query(**{'from': -1}),
                   self.query(**{'from': 10, 'to': 0}), self.query(**{'from': 1, 'to': 1}), self.query(to=367 * 86400000),
                   self.query(to=9007199254740992), self.query(**{'from': 8640000000000000, 'to': 8640000000000001}), self.query(keyword=' ', speaker='', **{'from': 1000, 'to': 2000}),
                   self.query(keyword='中' * 201), self.query(keyword='😀' * 101), self.query(keyword='\ud800'),
                   self.query(keyword='\u0080'), self.query(speaker='\n甲'), self.query(speaker='人' * 81),
                   self.query(limit=True), self.query(limit=0), self.query(limit=11),
                   self.query(cursor='A' * 64 + ':1'), self.query(cursor='a' * 64 + ':01'),
                   self.query(cursor='a' * 64 + ':9007199254740992')]
        for query in invalid:
            with self.subTest(query=repr(query)), self.assertRaises(ValueError):
                cli.make_command('search-local', 'dbg-' + 'a' * 32, local_query=query)
        valid = self.query(keyword='', speaker='发言人A', **{'from': 1000, 'to': 2000})
        self.assertEqual(cli.make_command('search-local', 'dbg-' + 'a' * 32, local_query=valid)['local_query'], valid)

    def test_query_arguments_cannot_be_used_on_other_commands_or_inject_paths_before_transfer(self):
        actions = ['status', 'show-card', 'remove-card', *cli.TASK_ACTIONS, cli.REVIEW_ACTION, *cli.RECOVERY_ACTIONS, 'cached-power', 'reconcile']
        for action in actions:
            for option in [['--keyword', '运费'], ['--speaker', ''], ['--from-ms', '0'], ['--limit', '10'], ['--cursor', '']]:
                argv = ['card-cli', action, *option]
                with self.subTest(action=action, option=option), patch.object(cli.sys, 'argv', argv), \
                        patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        cli.main()
                    transfer.assert_not_called()
        for extra in [[], ['--limit', '11'], ['--from-ms', '-1', '--keyword', 'x'], ['--keyword', '\n'],
                      ['--keyword', 'x', '--path', '../recordings'], ['--keyword', 'x', '--text', 'injected'],
                      ['--keyword', 'x', '--binding-sha256', 'a' * 64]]:
            with self.subTest(extra=extra), patch.object(cli.sys, 'argv', ['card-cli', 'search-local', *extra]), \
                    patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main()
                transfer.assert_not_called()

    def test_requested_local_references_and_partial_coverage_survive_large_receipt_and_reconcile_without_resend(self):
        command, directions = {}, []
        hit = {'reference': {'material_id': 'material-' + 'a' * 64, 'revision': 3, 'text_revision': 2,
                             'utterance_id': 'utterance-' + 'b' * 64, 'content_sha256': 'c' * 64,
                             'source_range': {'parent_utterance_id': 'parent-original', 'parent_revision': 1,
                                              'start_ms': 100, 'end_ms': 900, 'text_start': 0, 'text_end': 4}},
               'kind': 'recording', 'name': 'take-' + 'd' * 32, 'start_ms': None, 'end_ms': None,
               'excerpt': '运费沿用上次部分' * 20, 'speaker_id': 'speaker-0', 'speaker_label': '发言人A',
               'speaker_basis': 'unknown', 'label_basis': 'anonymous', 'is_self': False,
               'transcription_state': 'partial', 'audio_available': True}
        page = {'schema': 1, 'scope': 'local_canonical_only', 'hits': [hit] * 10, 'has_more': True,
                'next_cursor': 'e' * 64 + ':10', 'snapshot_sha256': 'e' * 64,
                'scanned': 20, 'unreadable': 1, 'incomplete': True, 'incomplete_reason': 'unreadable', 'legacy_not_indexed': True}

        def transfer(_hdc, _device, direction, source, target):
            directions.append(direction)
            if direction == 'send':
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
            else:
                result = {'schema': 1, 'id': command['id'], 'request_json': json.dumps(command), 'state': 'complete', 'error': '',
                          'started_at': command['created_at'], 'finished_at': command['created_at'], 'snapshot': {},
                          'control_call_completed': True, 'local_query': page}
                raw = json.dumps(result, ensure_ascii=False)
                self.assertGreater(len(raw.encode('utf-8')), 8192)
                self.assertLessEqual(len(raw.encode('utf-8')), 65536)
                Path(target).write_text(raw, encoding='utf-8')
            return True

        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-local-query-cli-') as folder, \
                patch.object(cli, 'PRIVATE', Path(folder)), patch.object(cli, 'transfer', side_effect=transfer), \
                patch.object(cli.subprocess, 'run', side_effect=AssertionError('no actual HDC or subprocess')):
            output = io.StringIO()
            argv = ['card-cli', 'search-local', '--keyword', '运费', '--speaker', '发言人A', '--from-ms', '1000', '--to-ms', '2000']
            with patch.object(cli.sys, 'argv', argv), contextlib.redirect_stdout(output):
                self.assertEqual(cli.main(), 0)
            intent, receipt = map(json.loads, output.getvalue().splitlines())
            self.assertEqual(command['schema'], 5)
            self.assertEqual(command['local_query']['limit'], 10)
            self.assertTrue(intent['reads_local_canonical_only'])
            self.assertTrue(intent['may_include_sensitive_excerpts'])
            self.assertFalse(intent['opens_microphone'])
            self.assertFalse(intent['submits_answer'])
            self.assertFalse(intent['restores_paused_local_draft_only'])
            self.assertFalse(intent['requires_physical_confirmation'])
            self.assertEqual(receipt['local_query'], page)
            self.assertTrue(receipt['contains_sensitive_local_excerpts'])
            self.assertFalse(receipt['draft_saved'])
            self.assertIn('local_canonical_query_only', receipt['completion_scope'])
            self.assertIn('incomplete and legacy coverage', receipt['completion_scope'])
            self.assertEqual(directions, ['send', 'recv'])
            directions.clear()
            with patch.object(cli.sys, 'argv', ['card-cli', 'reconcile', '--id', command['id']]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(), 0)
            self.assertEqual(directions, ['recv'])

    def test_oversized_receipt_is_rejected_before_json_decode(self):
        command = {}

        def transfer(_hdc, _device, direction, source, target):
            if direction == 'send':
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
            else:
                Path(target).write_bytes(b' ' * 65537)
            return True

        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-local-query-size-') as folder, \
                patch.object(cli, 'PRIVATE', Path(folder)), patch.object(cli, 'transfer', side_effect=transfer), \
                patch.object(cli.sys, 'argv', ['card-cli', 'search-local', '--keyword', '运费']), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, 'bounded size'):
            cli.main()


class SavedSummaryCommandTests(unittest.TestCase):
    @staticmethod
    def selection(**changes):
        return {'day': '2026-10-15', 'summary_id': 'saved-2026-10-15-cache', 'content_sha256': 'a' * 64,
                'offset': 0, 'max_chars': 4000, **changes}

    def test_schema6_list_and_chunk_read_have_exact_fields_and_no_other_bindings(self):
        for action, selection in [('list-summaries', {'day': '2026-10-15', 'limit': 10, 'cursor': ''}),
                                  ('read-summary', self.selection())]:
            command = cli.make_command(action, 'dbg-' + 'a' * 32, saved_summary=selection)
            self.assertEqual(command['schema'], 6)
            self.assertEqual(set(command), {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid', 'saved_summary'})
            self.assertEqual(command['expected_uid'], '')
            self.assertEqual(command['saved_summary'], selection)
            selection['day'] = '2026-10-16'
            self.assertEqual(command['saved_summary']['day'], '2026-10-15')
            for extra in [{'uid': 'p10-card'}, {'binding_sha256': 'a' * 64}, {'reply_binding_sha256': 'a' * 64},
                          {'recovery_binding_sha256': 'a' * 64}, {'recovery_source': 'main'}, {'local_query': LocalQueryCommandTests.query()}]:
                with self.subTest(action=action, extra=extra), self.assertRaises(ValueError):
                    cli.make_command(action, 'dbg-' + 'a' * 32, saved_summary=self.selection() if action == 'read-summary' else {'day': '2026-10-15', 'limit': 10, 'cursor': ''}, **extra)

    def test_saved_query_and_ref_validation_rejects_bad_dates_paths_bounds_and_extra_fields(self):
        bad_days = ['1969-12-31', '10000-01-01', '2026-02-29', '2026-04-31', '2026-1-01', '../2026-10-15', '', True]
        filters = [None, [], {}, {'day': '2026-10-15', 'limit': True, 'cursor': ''},
                   {'day': '2026-10-15', 'limit': 11, 'cursor': ''}, {'day': '2026-10-15', 'limit': 10, 'cursor': 'a' * 64 + ':01'},
                   {'day': '2026-10-15', 'limit': 10, 'cursor': 'a' * 64 + ':9007199254740992'},
                   *[{'day': day, 'limit': 10, 'cursor': ''} for day in bad_days]]
        reads = [self.selection(day=day) for day in bad_days] + [self.selection(summary_id='../private.md'), self.selection(summary_id='saved-2026-10-16-cache'),
                 self.selection(content_sha256='A' * 64), self.selection(content_sha256=''), self.selection(offset=-1), self.selection(offset=True),
                 self.selection(offset=2097153), self.selection(max_chars=1), self.selection(max_chars=4001), self.selection(path='D:/private')]
        for action, values in [('list-summaries', filters), ('read-summary', reads)]:
            for value in values:
                with self.subTest(action=action, selection=value), self.assertRaises(ValueError):
                    cli.make_command(action, 'dbg-' + 'a' * 32, saved_summary=value)
        for day in ['1970-01-01', '2000-02-29', '9999-12-31']:
            self.assertEqual(cli.make_command('list-summaries', 'dbg-' + 'a' * 32, saved_summary={'day': day, 'limit': 1, 'cursor': ''})['saved_summary']['day'], day)

    def test_all_summary_flags_are_exclusive_even_when_the_supplied_value_is_the_default(self):
        flags = [['--summary-day', '2026-10-15'], ['--summary-id', ''], ['--summary-sha256', ''], ['--summary-limit', '10'],
                 ['--summary-cursor', ''], ['--offset', '0'], ['--max-chars', '4000']]
        for action in ['status', 'show-card', 'remove-card', *cli.TASK_ACTIONS, cli.REVIEW_ACTION, *cli.RECOVERY_ACTIONS, 'search-local', 'cached-power', 'reconcile']:
            for flag in flags:
                with self.subTest(action=action, flag=flag), patch.object(cli.sys, 'argv', ['cli', action, *flag]), \
                        patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        cli.main()
                    transfer.assert_not_called()
        for argv in [['list-summaries', '--summary-day', '2026-10-15', '--offset', '0'],
                     ['list-summaries', '--summary-day', '2026-10-15', '--summary-id', ''],
                     ['read-summary', '--summary-day', '2026-10-15', '--summary-id', 'saved-2026-10-15-cache', '--summary-sha256', 'a' * 64, '--summary-limit', '10'],
                     ['list-summaries', '--summary-day', '2026-10-15', '--limit', '10'],
                     ['read-summary', '--summary-day', '2026-10-15', '--keyword', 'x']]:
            with self.subTest(argv=argv), patch.object(cli.sys, 'argv', ['cli', *argv]), patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main()
                transfer.assert_not_called()

    def run_summary(self, action, payload=None, *, error='', extra_args=(), reconcile=True):
        command, directions = {}, []
        def transfer(_hdc, _device, direction, source, target):
            directions.append(direction)
            if direction == 'send':
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
            else:
                result = {'schema': 1, 'id': command['id'], 'request_json': json.dumps(command), 'state': 'error' if error else 'complete', 'error': error,
                          'started_at': command['created_at'], 'finished_at': command['created_at'], 'snapshot': {}, 'control_call_completed': not bool(error)}
                if payload is not None:
                    result['saved_summaries' if action == 'list-summaries' else 'saved_summary'] = payload
                Path(target).write_text(json.dumps(result, ensure_ascii=True), encoding='utf-8')
            return True
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-saved-summary-cli-') as folder, \
                patch.object(cli, 'PRIVATE', Path(folder)), patch.object(cli, 'transfer', side_effect=transfer), \
                patch.object(cli.subprocess, 'run', side_effect=AssertionError('no actual HDC/network/agent process')):
            argv = ['cli', action, '--summary-day', '2026-10-15']
            if action == 'read-summary':
                argv += ['--summary-id', 'saved-2026-10-15-cache', '--summary-sha256', 'a' * 64]
            output = io.StringIO()
            with patch.object(cli.sys, 'argv', [*argv, *extra_args]), contextlib.redirect_stdout(output):
                code = cli.main()
            rows = list(map(json.loads, output.getvalue().splitlines()))
            self.assertEqual(command['schema'], 6)
            self.assertEqual(directions, ['send', 'recv'])
            self.assertFalse(rows[0]['opens_microphone'])
            self.assertFalse(rows[0]['submits_answer'])
            self.assertFalse(rows[0]['requires_physical_confirmation'])
            self.assertTrue(rows[0]['reads_saved_journals_only'])
            self.assertFalse(rows[-1]['lens_display_verified'])
            self.assertIn('local_saved_journal_read_only', rows[-1]['completion_scope'])
            for key in ['summary_note_receipt', 'summary_notes', 'summary_note_chunk', 'summary_note_pending', 'annotation_saved', 'playback_snapshot', 'audio_output_verified']:
                self.assertNotIn(key, rows[-1], 'schema6 result shape must stay unchanged')
            self.assertNotIn('user_note_action_only', rows[0])
            if reconcile:
                directions.clear()
                again = io.StringIO()
                with patch.object(cli.sys, 'argv', ['cli', 'reconcile', '--id', command['id']]), contextlib.redirect_stdout(again):
                    self.assertEqual(cli.main(), code)
                self.assertEqual(directions, ['recv'])
                self.assertEqual(json.loads(again.getvalue()), rows[-1])
            return code, rows[-1]

    def test_saved_list_returns_metadata_without_inventing_generation_identity_and_reconciles_without_resend(self):
        page = {'schema': 1, 'scope': 'local_saved_journals', 'day': '2026-10-15', 'items': [
            {'reference': {key: value for key, value in self.selection().items() if key in ('day', 'summary_id', 'content_sha256')},
             'file_kind': 'day_cache', 'bytes': 300, 'state': 'current', 'source_sha256': 'b' * 64, 'can_open': True, 'producer': 'unknown', 'generated_at': ''}],
            'next_cursor': '', 'has_more': False, 'snapshot_sha256': 'c' * 64, 'scanned': 1, 'unreadable': 0, 'incomplete': False, 'incomplete_reason': ''}
        code, receipt = self.run_summary('list-summaries', page)
        self.assertEqual(code, 0)
        self.assertEqual(receipt['saved_summaries'], page)
        self.assertIsNone(receipt['saved_summary'])
        self.assertFalse(receipt['contains_sensitive_saved_markdown'])

    def test_explicit_chunks_preserve_utf16_progress_full_file_ref_emoji_and_eof(self):
        ref = {key: value for key, value in self.selection().items() if key in ('day', 'summary_id', 'content_sha256')}
        parts = [(0, '甲😀', 3, True), (3, '\n乙', 5, False), (5, '', 5, False)]
        assembled = ''
        for offset, markdown, next_offset, more in parts:
            chunk = {'schema': 1, 'reference': ref, 'source_sha256': 'b' * 64, 'markdown': markdown, 'offset': offset, 'next_offset': next_offset, 'total_utf16': 5, 'has_more': more}
            code, receipt = self.run_summary('read-summary', chunk, extra_args=['--offset', str(offset), '--max-chars', '3'])
            self.assertEqual(code, 0)
            self.assertEqual(receipt['saved_summary'], chunk)
            self.assertTrue(receipt['contains_sensitive_saved_markdown'])
            assembled += markdown
        self.assertEqual(assembled, '甲😀\n乙')

    def test_chunk_ref_offset_and_progress_mismatches_are_rejected_without_printing_markdown(self):
        ref = {key: value for key, value in self.selection().items() if key in ('day', 'summary_id', 'content_sha256')}
        chunk = {'schema': 1, 'reference': ref, 'source_sha256': 'b' * 64, 'markdown': '秘密😀', 'offset': 0, 'next_offset': 4, 'total_utf16': 6, 'has_more': True}
        for changes in [{'reference': {**ref, 'content_sha256': 'c' * 64}}, {'offset': 1}, {'next_offset': 3}, {'has_more': False}, {'total_utf16': 2097153}, {'markdown': '\ud800'}, {'markdown': ''}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.run_summary('read-summary', {**chunk, **changes}, reconcile=False)

    def test_stale_read_and_untrusted_error_text_never_leak_body_or_paths_and_reconcile_only_reads(self):
        for raw, expected in [('SAVED_SUMMARY_STALE', 'SAVED_SUMMARY_STALE'), ('SAVED_SUMMARY_INVALID', 'SAVED_SUMMARY_INVALID'),
                              ('D:/private/sensitive.md full saved model text', 'DEBUG_OPERATION_FAILED')]:
            code, receipt = self.run_summary('read-summary', error=raw)
            self.assertEqual(code, 1)
            self.assertEqual(receipt['error'], expected)
            self.assertIsNone(receipt['saved_summary'])
            self.assertFalse(receipt['control_call_completed'])
            if raw != expected:
                self.assertNotIn(raw, json.dumps(receipt))


class SummaryNoteCommandTests(unittest.TestCase):
    operation = 'noteop-2026-10-15-' + 'd' * 32

    @classmethod
    def body(cls, text='完整附注😀\n下一行', **changes):
        return {'operation_id': cls.operation, 'parent': {'day': '2026-10-15', 'summary_id': 'saved-2026-10-15-cache', 'content_sha256': 'a' * 64},
                'source_sha256': 'b' * 64, 'text': text, **changes}

    def test_worst_escape_8192_utf16_note_is_complete_in_attachment_and_pending_result_under_limits(self):
        body = cli.validate_note_input(self.body('\x1f' * 8192))
        raw = cli.note_input_bytes(body)
        self.assertLessEqual(len(raw), 65536)
        self.assertEqual(json.loads(raw)['text'], '\x1f' * 8192)
        sha = cli.hashlib.sha256(raw).hexdigest()
        command = cli.make_command('save-summary-note', 'dbg-' + 'a' * 32, annotation={'operation_id': self.operation, 'body_sha256': sha})
        self.assertLessEqual(len(json.dumps(command).encode('utf-8')), 2048)
        pending_command = cli.make_command('read-summary-note-pending', 'dbg-' + 'b' * 32, annotation={'operation_id': self.operation, 'input_sha256': sha})
        result = {'schema': 1, 'id': pending_command['id'], 'request_json': json.dumps(pending_command), 'state': 'complete', 'summary_note_pending': body}
        self.assertLessEqual(len(json.dumps(result, ensure_ascii=False).encode('utf-8')), 65536)
        cli.validate_note_result(pending_command, None, None, None, body, 'complete')
        for invalid in [self.body('x' * 8193), self.body('\ud800'), self.body(' \t\n'), self.body(operation_id='noteop-' + 'd' * 32),
                        self.body(operation_id='noteop-2026-10-16-' + 'd' * 32), self.body(previous={'day': '2026-10-16', 'note_id': 'note-2026-10-16-'+'d'*32, 'content_sha256': 'e'*64})]:
            with self.assertRaises(ValueError):
                cli.validate_note_input(invalid)

    def test_schema7_is_exact_and_note_arguments_cannot_cross_schema_or_action_boundaries(self):
        selections = {'save-summary-note': {'operation_id': self.operation, 'body_sha256': 'a' * 64}, 'resume-summary-note': {'operation_id': self.operation, 'body_sha256': 'a' * 64},
                      'summary-note-status': {'operation_id': self.operation}, 'list-summary-notes': {'day': '2026-10-15', 'limit': 10, 'cursor': ''},
                      'read-summary-note': {'day': '2026-10-15', 'note_id': 'note-2026-10-15-'+'d'*32, 'content_sha256': 'a'*64, 'format': 'json', 'offset': 0, 'max_chars': 4000},
                      'read-summary-note-pending': {'operation_id': self.operation, 'input_sha256': 'a' * 64}}
        for action, annotation in selections.items():
            command = cli.make_command(action, 'dbg-' + 'a' * 32, annotation=annotation)
            self.assertEqual(command['schema'], 7)
            self.assertEqual(set(command), {'schema', 'id', 'action', 'created_at', 'expires_at', 'expected_uid', 'annotation'})
            self.assertEqual(command['annotation'], annotation)
            for extra in [{'uid': 'p10-card'}, {'binding_sha256': 'a' * 64}, {'saved_summary': {'day':'2026-10-15','limit':10,'cursor':''}}, {'local_query': LocalQueryCommandTests.query()}]:
                with self.subTest(action=action, extra=extra), self.assertRaises(ValueError):
                    cli.make_command(action, 'dbg-' + 'a' * 32, annotation=annotation, **extra)
        for action in ['status', 'search-local', *cli.SUMMARY_ACTIONS, *cli.RECOVERY_ACTIONS]:
            with self.assertRaises(ValueError):
                cli.make_command(action, 'dbg-' + 'a' * 32, annotation=selections['save-summary-note'])
        wrong = [('save-summary-note', {'operation_id':self.operation,'body_sha256':'A'*64}), ('summary-note-status', {'operation_id':self.operation,'body_sha256':'a'*64}),
                 ('read-summary-note', {**selections['read-summary-note'],'offset':8388609}), ('read-summary-note', {**selections['read-summary-note'],'format':'txt'}),
                 ('read-summary-note-pending',{'operation_id':self.operation,'input_sha256':''})]
        for action, annotation in wrong:
            with self.assertRaises(ValueError):
                cli.make_command(action, 'dbg-' + 'a' * 32, annotation=annotation)

    def test_note_flags_are_strictly_exclusive_including_explicit_defaults_before_any_transfer(self):
        flags = [['--note-operation-id', self.operation], ['--note-file', 'unavailable'], ['--note-day', '2026-10-15'], ['--note-parent-id', ''],
                 ['--note-parent-sha256', ''], ['--note-source-sha256', ''], ['--note-previous-id', ''], ['--note-previous-sha256', ''], ['--note-limit', '10'],
                 ['--note-cursor', ''], ['--note-id', ''], ['--note-sha256', ''], ['--note-format', 'md'], ['--note-offset', '0'], ['--note-max-chars', '4000'], ['--note-input-sha256', '']]
        for action in ['status', 'show-card', *cli.TASK_ACTIONS, *cli.SUMMARY_ACTIONS, *cli.RECOVERY_ACTIONS, 'search-local', 'cached-power', 'reconcile']:
            for flag in flags:
                with patch.object(cli.sys, 'argv', ['cli', action, *flag]), patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        cli.main()
                    transfer.assert_not_called()
        for argv in [['summary-note-status','--note-operation-id',self.operation,'--note-offset','0'], ['list-summary-notes','--note-day','2026-10-15','--note-operation-id',self.operation],
                     ['read-summary-note-pending','--note-operation-id',self.operation,'--note-file','unavailable'], ['read-summary-note','--note-day','2026-10-15','--max-chars','4000']]:
            with patch.object(cli.sys, 'argv', ['cli', *argv]), patch.object(cli, 'transfer') as transfer, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main()
                transfer.assert_not_called()

    def run_note(self, action, *, text='完整附注😀\n下一行', failure='', state='saved', error='', effect_saved=False, change_source=False):
        command, directions, loaded, effects = {}, [], {}, []
        ref = {'day':'2026-10-15','note_id':'note-2026-10-15-'+'d'*32,'content_sha256':'c'*64}
        body = self.body(text)
        body_sha = cli.hashlib.sha256(cli.note_input_bytes(body)).hexdigest()
        receipt = {'schema':1,'operation_id':self.operation,'state':state,'input_sha256':body_sha,'source_sha256':'b'*64,'can_open':state=='saved','replayed':False,'note':'','created_at':'2026-10-15T12:00:00.000Z'}
        if state == 'saved':
            receipt['reference'] = ref
        def transfer(_hdc, _device, direction, source, target):
            if direction == 'send' and str(target).endswith('-annotation.json'):
                directions.append('body')
                intent = Path(source).parent / 'command.json'
                self.assertTrue(intent.is_file(), 'both complete files must exist before any transfer')
                raw = Path(source).read_bytes()
                loaded.update(json.loads(raw))
                self.assertEqual(loaded['text'], text)
                expected = json.loads(intent.read_text(encoding='utf-8'))
                self.assertEqual(expected['annotation']['body_sha256'], cli.hashlib.sha256(raw).hexdigest())
                self.assertEqual(str(target), cli.REMOTE + '/' + expected['id'] + '-annotation.json')
                return failure != 'body'
            if direction == 'send':
                directions.append('command')
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
                if action in cli.NOTE_WRITES:
                    self.assertTrue((Path(source).parent/'command-transfer-attempted.json').is_file())
                    if effect_saved and failure != 'command':
                        effects.append((loaded['operation_id'], loaded['text']))  # Core committed, then its post-read failed.
                return failure != 'command'
            directions.append('recv')
            result = {'schema':1,'id':command['id'],'request_json':json.dumps(command),'state':'error' if error else 'complete','error':error,
                      'started_at':command['created_at'],'finished_at':command['created_at'],'snapshot':{},'control_call_completed':not bool(error)}
            if not error:
                if action in (*cli.NOTE_WRITES,'summary-note-status'):
                    result['summary_note_receipt'] = receipt
                elif action == 'read-summary-note-pending':
                    result['summary_note_pending'] = body
                elif action == 'list-summary-notes':
                    result['summary_notes'] = {'schema':1,'scope':'local_summary_notes','day':'2026-10-15','items':[receipt], 'next_cursor':'','has_more':False,'snapshot_sha256':'e'*64,'scanned':1,'incomplete':False,'incomplete_reason':''}
                else:
                    result['summary_note_chunk'] = {'schema':1,'reference':ref,'format':'json','text':'甲😀','offset':0,'next_offset':3,'total_utf16':8,'has_more':True,'source_sha256':'b'*64}
            raw = json.dumps(result,ensure_ascii=True).encode('utf-8')
            self.assertLessEqual(len(raw),65536)
            Path(target).write_bytes(raw)
            return True
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent, prefix='.test-note-cli-') as folder, patch.object(cli,'PRIVATE',Path(folder)/'private'), \
                patch.object(cli,'transfer',side_effect=transfer), patch.object(cli.subprocess,'run',side_effect=AssertionError('no actual HDC/network')):
            text_file=Path(folder)/'text.txt';text_file.write_bytes(text.encode('utf-8'))
            argv=['cli',action]
            if action in cli.NOTE_WRITES:
                argv += ['--note-operation-id',self.operation,'--note-file',str(text_file),'--note-day','2026-10-15','--note-parent-id','saved-2026-10-15-cache','--note-parent-sha256','a'*64,'--note-source-sha256','b'*64]
            elif action == 'summary-note-status':
                argv += ['--note-operation-id',self.operation]
            elif action == 'read-summary-note-pending':
                argv += ['--note-operation-id',self.operation,'--note-input-sha256',body_sha]
            elif action == 'list-summary-notes':
                argv += ['--note-day','2026-10-15']
            else:
                argv += ['--note-day','2026-10-15','--note-id',ref['note_id'],'--note-sha256',ref['content_sha256'],'--note-format','json']
            output=io.StringIO()
            with patch.object(cli.sys,'argv',argv),contextlib.redirect_stdout(output):
                code=cli.main()
            rows=list(map(json.loads,output.getvalue().splitlines()))
            self.assertFalse(rows[0]['opens_microphone']);self.assertFalse(rows[0]['submits_answer']);self.assertTrue(rows[0]['user_note_action_only'])
            if failure:
                self.assertEqual(code,2)
                self.assertEqual(directions,['body'] if failure=='body' else ['body','command'])
                self.assertEqual(rows[-1]['state'],'command_not_sent' if failure=='body' else 'unknown')
                return
            self.assertEqual(code,1 if error else 0)
            self.assertEqual(directions,['body','command','recv'] if action in cli.NOTE_WRITES else ['command','recv'])
            if action in cli.NOTE_WRITES:
                local=cli.PRIVATE/'6HQ0226407055391'/command['id']
                if not error and state=='saved':
                    self.assertFalse((local/'annotation.json').exists(), 'only a verified durable saved receipt retires the generated copy')
                else:
                    self.assertEqual((local/'annotation.json').read_bytes(),cli.note_input_bytes(body), 'pending or unknown result retains complete input for same-operation recovery')
                self.assertTrue((local/'command.json').is_file());self.assertTrue((local/'result.json').is_file())
                self.assertEqual(text_file.read_bytes(),text.encode('utf-8'),'original --note-file is never removed or changed')
                if change_source:
                    text_file.write_bytes(b'user changed the original source after the ambiguous call')
                inventory=sorted(path.name for path in local.parent.iterdir())
            self.assertNotIn(text,output.getvalue() if action!='read-summary-note-pending' else '')
            self.assertIn('local_user_note_only',rows[-1]['completion_scope'])
            self.assertNotIn('playback_snapshot',rows[-1]);self.assertNotIn('audio_output_verified',rows[-1])
            directions.clear()
            again=io.StringIO()
            with patch.object(cli.sys,'argv',['cli','reconcile','--id',command['id']]),contextlib.redirect_stdout(again):
                self.assertEqual(cli.main(),code)
            self.assertEqual(directions,['recv'])
            self.assertEqual(json.loads(again.getvalue()),rows[-1])
            if action in cli.NOTE_WRITES:
                self.assertEqual(sorted(path.name for path in local.parent.iterdir()),inventory, 'reconcile does not allocate a new command or operation')
                if error or state!='saved':
                    self.assertEqual((local/'annotation.json').read_bytes(),cli.note_input_bytes(body))
                if change_source:
                    self.assertEqual(text_file.read_bytes(),b'user changed the original source after the ambiguous call')
                self.assertEqual(effects,[(self.operation,text)] if effect_saved else [])
            return rows[-1]

    def test_large_save_and_explicit_resume_stage_complete_input_before_command_and_only_reconcile(self):
        for action in cli.NOTE_WRITES:
            receipt=self.run_note(action,text='\x1f'*8192)
            self.assertTrue(receipt['annotation_saved'])
        receipt=self.run_note('save-summary-note',state='pending',change_source=True)
        self.assertFalse(receipt['annotation_saved'])
        self.assertTrue(receipt['control_call_completed'])

    def test_saved_effect_with_error_receipt_stays_unknown_and_preserves_same_operation_complete_input(self):
        receipt=self.run_note('save-summary-note',text='完整已提交原文😀\n不可用新文件覆盖',error='NOTE_IO',effect_saved=True,change_source=True)
        self.assertIsNone(receipt['annotation_saved'])
        self.assertFalse(receipt['control_call_completed'])
        self.assertIsNone(receipt['summary_note_receipt'])

    def test_annotation_saved_is_tristate_and_never_infers_no_effect_from_missing_receipt(self):
        self.assertTrue(cli.note_saved_state({'state':'saved'}))
        for state in ['missing','reserved','pending','stale']:
            self.assertIs(cli.note_saved_state({'state':state}),False)
        for receipt in [None,{}, {'state':'blocked'},{'state':'corrupt'},{'state':'error'}]:
            self.assertIsNone(cli.note_saved_state(receipt))

    def test_attachment_failure_never_sends_command_and_uncertain_command_never_retries(self):
        self.run_note('save-summary-note',failure='body')
        self.run_note('resume-summary-note',failure='command')

    def test_status_list_pending_and_separate_json_chunk_are_explicit_read_only_actions(self):
        for action in ['summary-note-status','list-summary-notes','read-summary-note','read-summary-note-pending']:
            result=self.run_note(action,text='\x1f'*8192 if action=='read-summary-note-pending' else '完整附注😀\n下一行')
            if action=='read-summary-note':
                self.assertIsNone(result['saved_summary'])
                self.assertEqual(result['summary_note_chunk']['format'],'json')
                self.assertTrue(result['summary_note_chunk']['has_more'])
            elif action=='read-summary-note-pending':
                self.assertEqual(result['summary_note_pending']['text'],'\x1f'*8192)
                self.assertTrue(result['contains_sensitive_note_input'])
            if action!='summary-note-status':
                self.assertIsNone(result['annotation_saved'])

    def test_note_error_whitelist_and_pending_hash_mismatch_do_not_expose_body(self):
        for code in ['NOTE_INVALID','NOTE_STALE','NOTE_CONFLICT','NOTE_BLOCKED','NOTE_IO','D:/private/full-user-note']:
            result=self.run_note('save-summary-note',error=code)
            self.assertEqual(result['error'],code if code.startswith('NOTE_') else 'DEBUG_OPERATION_FAILED')
        pending=self.body('private full text')
        command=cli.make_command('read-summary-note-pending','dbg-'+'a'*32,annotation={'operation_id':self.operation,'input_sha256':'0'*64})
        with self.assertRaises(ValueError):
            cli.validate_note_result(command,None,None,None,pending,'complete')

    def test_note_metadata_times_and_separate_chunk_ref_format_progress_are_strict(self):
        command=cli.make_command('summary-note-status','dbg-'+'a'*32,annotation={'operation_id':self.operation})
        receipt={'schema':1,'operation_id':self.operation,'state':'pending','input_sha256':'a'*64,'source_sha256':'b'*64,'can_open':False,'replayed':False,'note':'','created_at':''}
        for stamp in ['', '2026-10-15T12:00:00.000Z', '2000-02-29T00:00:00.001Z']:
            cli.validate_note_result(command,{**receipt,'created_at':stamp},None,None,None,'complete')
        for stamp in ['2026-02-29T12:00:00.000Z','2026-10-15T12:00:00Z','2026-10-15T12:00:00.000+00:00','mtime',True,None]:
            with self.assertRaises(ValueError):
                cli.validate_note_result(command,{**receipt,'created_at':stamp},None,None,None,'complete')
        ref={'day':'2026-10-15','note_id':'note-2026-10-15-'+'d'*32,'content_sha256':'c'*64}
        command=cli.make_command('read-summary-note','dbg-'+'a'*32,annotation={**ref,'format':'md','offset':0,'max_chars':4})
        chunk={'schema':1,'reference':ref,'format':'md','text':'甲😀','offset':0,'next_offset':3,'total_utf16':8,'has_more':True,'source_sha256':'b'*64}
        cli.validate_note_result(command,None,None,chunk,None,'complete')
        for changes in [{'reference':{**ref,'content_sha256':'d'*64}},{'format':'json'},{'next_offset':2},{'has_more':False},{'text':'\ud800'},{'text':''}]:
            with self.assertRaises(ValueError):
                cli.validate_note_result(command,None,None,{**chunk,**changes},None,'complete')

    def test_129_unconfirmed_attachment_transfers_stop_before_a_new_command_directory_or_upload(self):
        directions=[]
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.test-note-cli-budget-') as folder, \
                patch.object(cli,'PRIVATE',Path(folder)/'private'),patch.object(cli.subprocess,'run',side_effect=AssertionError('no actual HDC')):
            text_file=Path(folder)/'source.txt';text_file.write_bytes(b'x')
            argv=['cli','save-summary-note','--note-operation-id',self.operation,'--note-file',str(text_file),'--note-day','2026-10-15',
                  '--note-parent-id','saved-2026-10-15-cache','--note-parent-sha256','a'*64,'--note-source-sha256','b'*64]
            def transfer(_hdc,_device,direction,source,target):
                directions.append(direction)
                self.assertTrue(str(target).endswith('-annotation.json'))
                return False  # Could already have reached the App; command must not follow.
            with patch.object(cli,'transfer',side_effect=transfer),patch.object(cli.sys,'argv',argv):
                for _ in range(128):
                    with contextlib.redirect_stdout(io.StringIO()):
                        self.assertEqual(cli.main(),2)
                root=cli.PRIVATE/'6HQ0226407055391';before=sorted(path.name for path in root.iterdir())
                self.assertEqual(sum(path.is_dir() for path in root.iterdir()),128)
                blocked=io.StringIO()
                with contextlib.redirect_stdout(blocked):
                    self.assertEqual(cli.main(),2)
                result=json.loads(blocked.getvalue());self.assertEqual(result['state'],'command_not_sent');self.assertEqual(result['error'],'NOTE_BLOCKED')
                self.assertIn('no new command directory or upload',result['next'])
                self.assertEqual(sorted(path.name for path in root.iterdir()),before)
                self.assertEqual(len(directions),128)
                self.assertEqual(text_file.read_bytes(),b'x')

    def test_real_local_note_file_lock_rejects_a_second_writer_and_releases_on_exit(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.test-note-cli-lock-') as folder,patch.object(cli,'PRIVATE',Path(folder)/'private'):
            with cli.note_local_lock('owned-device') as root:
                with self.assertRaisesRegex(ValueError,'busy'):
                    with cli.note_local_lock('owned-device'):
                        self.fail('second writer must not pass the same-device OS lock')
                self.assertEqual((root/'.note-staging.lock').stat().st_size,1)
            with cli.note_local_lock('owned-device'):
                pass  # Handle closure released the OS lock; no stale directory lock.

    def test_local_staging_preserves_unknown_and_failed_cleanup_copies_instead_of_ignoring_them(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.test-note-cli-unknown-') as folder,patch.object(cli,'PRIVATE',Path(folder)/'private'):
            with cli.note_local_lock('owned-device') as root:
                orphan=root/('dbg-'+'f'*32);orphan.mkdir();attachment=orphan/'annotation.json';attachment.write_bytes(b'unknown')
                with self.assertRaisesRegex(ValueError,'unknown'):
                    cli.note_staging_capacity(root,100)
                self.assertEqual(attachment.read_bytes(),b'unknown')
                body=self.body('exact retained copy');raw=cli.note_input_bytes(body);sha=cli.hashlib.sha256(raw).hexdigest();attachment.write_bytes(raw)
                command=cli.make_command('save-summary-note',orphan.name,annotation={'operation_id':self.operation,'body_sha256':sha})
                (orphan/'command.json').write_text(json.dumps(command),encoding='utf-8')
                saved={'schema':1,'operation_id':self.operation,'state':'saved','input_sha256':sha,'source_sha256':'b'*64,
                       'can_open':True,'replayed':False,'note':'','created_at':'2026-10-15T12:00:00.000Z',
                       'reference':{'day':'2026-10-15','note_id':'note-2026-10-15-'+'d'*32,'content_sha256':'c'*64}}
                result={'schema':1,'id':orphan.name,'request_json':json.dumps(command),'state':'complete','error':'','summary_note_receipt':saved}
                (orphan/'result.json').write_text(json.dumps(result),encoding='utf-8')
                with patch.object(Path,'unlink',side_effect=OSError('synthetic retained generated copy')),self.assertRaises(OSError):
                    cli.cleanup_local_note(orphan,command,result)
                self.assertTrue(attachment.exists())
                cli.note_staging_capacity(root,100)
                # Copies left after a cleanup failure count against the byte budget.
                with self.assertRaisesRegex(ValueError,'staging full'):
                    cli.note_staging_capacity(root,8388608)
                cli.cleanup_local_note(orphan,command,result)
                self.assertFalse(attachment.exists());self.assertTrue((orphan/'command.json').exists());self.assertTrue((orphan/'result.json').exists())


class PlaybackCommandTests(unittest.TestCase):
    session = 'playback-' + 'b' * 32

    @staticmethod
    def source(**changes):
        return {'kind':'recording','name':'take-'+'a'*32,'revision':0,'utterance_id':'',**changes}

    @classmethod
    def snapshot(cls, **changes):
        return {'schema':1,'session_id':cls.session,'phase':'paused','source':{**cls.source(),'audio_sha256':'c'*64,'format':'wav'},
                'position_ms':2345,'position_known':True,'duration_ms':10000,'duration_known':True,'native_state':'paused','callback_seq':4,
                'error':'','note':'','audio_output_verified':False,**changes}

    def test_schema8_closed_sources_anchors_sessions_and_seek_bounds_cannot_mix_old_channels(self):
        selections={'playback-play':self.source(revision=3,utterance_id='original-part'),'playback-status':{},'playback-seek':{'session_id':self.session,'position_ms':5000},
                    **{action:{'session_id':self.session} for action in ('playback-pause','playback-resume','playback-stop')}}
        for action,selection in selections.items():
            command=cli.make_command(action,'dbg-'+'d'*32,playback=selection)
            self.assertEqual(set(command),{'schema','id','action','created_at','expires_at','expected_uid','playback'})
            self.assertEqual(command['schema'],8);self.assertEqual(command['expected_uid'],'');self.assertEqual(command['playback'],selection)
            self.assertLessEqual(len(json.dumps(command).encode('utf-8')),2048)
            for extra in [{'uid':'p10-other'},{'binding_sha256':'a'*64},{'reply_binding_sha256':'a'*64},{'recovery_binding_sha256':'a'*64},
                          {'recovery_source':'main'},{'local_query':LocalQueryCommandTests.query()},{'saved_summary':{}},{'annotation':{}}]:
                with self.subTest(action=action,extra=extra),self.assertRaises(ValueError):
                    cli.make_command(action,'dbg-'+'d'*32,playback=selection,**extra)
        bad=[('playback-play',None),('playback-play',[]),('playback-play',self.source(kind='journal')),('playback-play',self.source(kind='lifelog')),
             ('playback-play',self.source(name='../audio.wav')),('playback-play',self.source(name='take-'+'A'*32)),('playback-play',self.source(revision=True)),
             ('playback-play',self.source(revision=1)),('playback-play',self.source(utterance_id='part')),('playback-play',self.source(revision=1000000000,utterance_id='part')),
             ('playback-play',self.source(revision=1,utterance_id='x'*257)),('playback-play',self.source(revision=1,utterance_id='bad\npart')),
             ('playback-play',self.source(revision=1,utterance_id='\ud800')),('playback-play',self.source(position_ms=0)),('playback-status',[]),('playback-status',{'session_id':self.session}),
             *[(action,{'session_id':bad_id}) for action in ('playback-pause','playback-resume','playback-stop') for bad_id in ('','../other','x'*129)],
             *[('playback-seek',{'session_id':self.session,'position_ms':value}) for value in (-1,86400001,1.5,True,None)]]
        for action,selection in bad:
            with self.subTest(action=action,selection=repr(selection)),self.assertRaises(ValueError):
                cli.make_command(action,'dbg-'+'d'*32,playback=selection)
        for action in ('status',*cli.TASK_ACTIONS,*cli.RECOVERY_ACTIONS,cli.LOCAL_ACTION,*cli.SUMMARY_ACTIONS,*cli.NOTE_ACTIONS):
            with self.assertRaises(ValueError):
                cli.make_command(action,'dbg-'+'d'*32,playback={})

    def test_playback_flags_are_exclusive_even_when_old_or_new_defaults_are_explicit(self):
        playback_flags=[['--playback-kind',''],['--playback-name',''],['--playback-revision','0'],['--playback-utterance-id',''],['--playback-session-id',''],['--playback-position-ms','0']]
        for action in ('status','show-card','remove-card','reconcile','cached-power',*cli.TASK_ACTIONS,cli.REVIEW_ACTION,*cli.RECOVERY_ACTIONS,cli.LOCAL_ACTION,*cli.SUMMARY_ACTIONS,*cli.NOTE_ACTIONS):
            for flag in playback_flags:
                with patch.object(cli.sys,'argv',['cli',action,*flag]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):cli.main()
                    transfer.assert_not_called()
        old_flags=[['--uid',''],['--id',''],['--binding-sha256',''],['--reply-binding-sha256',''],['--recovery-binding-sha256',''],['--recovery-source',''],
                   ['--from-ms','0'],['--to-ms','0'],['--keyword',''],['--speaker',''],['--limit','10'],['--cursor',''],['--summary-day',''],['--summary-id',''],
                   ['--summary-sha256',''],['--summary-limit','10'],['--summary-cursor',''],['--offset','0'],['--max-chars','4000'],
                   *[['--note-'+flag,'0' if flag in ('offset','limit','max-chars') else ''] for flag in ('operation-id','file','day','parent-id','parent-sha256','source-sha256','previous-id','previous-sha256','cursor','id','sha256','input-sha256','offset','limit','max-chars')],['--note-format','md']]
        for action in cli.PLAYBACK_ACTIONS:
            for flag in old_flags:
                with patch.object(cli.sys,'argv',['cli',action,*flag]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):cli.main()
                    transfer.assert_not_called()
        for action,flags in [('playback-status',['--playback-kind','recording']),('playback-play',['--playback-position-ms','0']),
                             ('playback-resume',['--playback-revision','0']),('playback-pause',['--playback-utterance-id','']),('playback-stop',['--playback-position-ms','0'])]:
            with patch.object(cli.sys,'argv',['cli',action,*flags]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):cli.main()
                transfer.assert_not_called()

    def run_playback(self,action,*,error='',unconfirmed=False):
        command,directions,effects={},[],[]
        argv=['cli',action]
        if action=='playback-play':
            argv += ['--playback-kind','recording','--playback-name',self.source()['name'],'--playback-revision','3','--playback-utterance-id','original-part']
        elif action!='playback-status':
            argv += ['--playback-session-id',self.session]
            if action=='playback-seek':argv += ['--playback-position-ms','5000']
        def transfer(_hdc,_device,direction,source,target):
            directions.append(direction)
            if direction=='send':
                self.assertEqual(str(target),cli.REMOTE+'/command.json','no audio or staging attachment is uploaded')
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
                self.assertEqual(command['schema'],8);self.assertEqual(len(list(Path(source).parent.iterdir())),1,'durable short intent exists before the only transfer')
                effects.append(command['action'])
                return not unconfirmed
            result={'schema':1,'id':command['id'],'request_json':json.dumps(command),'state':'error' if error else 'complete','error':error,
                    'started_at':command['created_at'],'finished_at':command['created_at'],'snapshot':{},'control_call_completed':not bool(error),
                    'playback_snapshot':self.snapshot()}
            raw=json.dumps(result).encode('utf-8');self.assertLessEqual(len(raw),65536);Path(target).write_bytes(raw);return True
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent,prefix='.test-playback-cli-') as folder,patch.object(cli,'PRIVATE',Path(folder)/'private'), \
                patch.object(cli,'transfer',side_effect=transfer),patch.object(cli.subprocess,'run',side_effect=AssertionError('no actual HDC/network')):
            output=io.StringIO()
            with patch.object(cli.sys,'argv',argv),contextlib.redirect_stdout(output):code=cli.main()
            rows=list(map(json.loads,output.getvalue().splitlines()))
            self.assertFalse(rows[0]['opens_microphone']);self.assertFalse(rows[0]['submits_answer']);self.assertFalse(rows[0]['audio_output_verified']);self.assertTrue(rows[0]['local_playback_control_only'])
            self.assertEqual(directions,['send'] if unconfirmed else ['send','recv'])
            self.assertEqual(code,2 if unconfirmed else 1 if error else 0)
            if unconfirmed:self.assertEqual(rows[-1]['state'],'unknown')
            local=cli.PRIVATE/'6HQ0226407055391'/command['id'];before=sorted(path.name for path in local.parent.iterdir());directions.clear()
            again=io.StringIO()
            with patch.object(cli.sys,'argv',['cli','reconcile','--id',command['id']]),contextlib.redirect_stdout(again):self.assertEqual(cli.main(),1 if error else 0)
            self.assertEqual(directions,['recv']);self.assertEqual(effects,[action]);self.assertEqual(sorted(path.name for path in local.parent.iterdir()),before)
            result=json.loads(again.getvalue());self.assertFalse(result['audio_output_verified']);self.assertFalse(result['playback_snapshot']['audio_output_verified'])
            self.assertIn('not proof of audible output',result['completion_scope']);self.assertIn('not current status',result['completion_scope'])
            for key in ('annotation_saved','summary_note_receipt','summary_note_pending'):self.assertNotIn(key,result)
            if not unconfirmed:self.assertEqual(result,rows[-1])
            return result

    def test_playback_cli_all_controls_save_short_intent_and_reconcile_only_observes_the_original_receipt(self):
        for action in cli.PLAYBACK_ACTIONS:
            result=self.run_playback(action)
            self.assertTrue(result['control_call_completed']);self.assertEqual(result['playback_snapshot']['position_ms'],2345,'requested seek position is not actual observed position')

    def test_lost_play_transfer_or_safe_error_never_replays_or_leaks_native_error_text(self):
        self.run_playback('playback-play',unconfirmed=True)
        for error in (*cli.PLAYBACK_ERRORS,'D:/private/audio.wav native secret'):
            result=self.run_playback('playback-stop',error=error)
            self.assertEqual(result['error'],error if error in cli.PLAYBACK_ERRORS else 'DEBUG_OPERATION_FAILED')
            self.assertFalse(result['control_call_completed'])
            if error not in cli.PLAYBACK_ERRORS:self.assertNotIn(error,json.dumps(result))

    def test_playback_snapshot_is_closed_metadata_with_real_callback_values_and_no_audibility_or_private_payload(self):
        command=cli.make_command('playback-status','dbg-'+'d'*32,playback={});good=self.snapshot()
        cli.validate_playback_result(command,good,'complete')
        idle=self.snapshot(session_id='',phase='idle',native_state='',position_ms=0,position_known=False,duration_ms=0,duration_known=False,callback_seq=0)
        del idle['source'];cli.validate_playback_result(command,idle,'complete');cli.validate_playback_result(command,None,'error')
        with self.assertRaises(ValueError):cli.validate_playback_result(command,None,'complete')
        invalid=[{'audio_output_verified':True},{'phase':'audible'},{'native_state':'native secret'},{'position_ms':True},{'duration_ms':-1},{'callback_seq':1.5},
                 {'session_id':'../another'},{'position_known':1},{'error':'PLAYBACK_/private/native'},{'note':'\ud800'},{'note':'x'*513},{'fd':42},
                 {'source':None},{'source':{**good['source'],'path':'D:/private/audio.wav'}},{'source':{**good['source'],'audio_sha256':'A'*64}},
                 {'source':{**good['source'],'kind':'journal'}},{'source':{**good['source'],'format':'rawopus'}}]
        for changes in invalid:
            with self.subTest(changes=repr(changes)),self.assertRaises(ValueError):cli.validate_playback_result(command,{**good,**changes},'complete')


class RecordingSummaryCommandTests(unittest.TestCase):
    job='rsum-'+'a'*32
    digest='b'*64

    @staticmethod
    def reference(**changes):
        return {'material_id':'mat-recording-'+'c'*32,'revision':2,'text_revision':1,'utterance_id':'u-1','content_sha256':'d'*64,**changes}

    @classmethod
    def view(cls, phase='queued', **changes):
        return {'schema':1,'job_id':cls.job,'state_sha256':cls.digest,'phase':phase,'note':'queued','source':cls.reference(),'model':'configured-model',
                'generated_at':'2026-10-16T01:00:00.000Z' if phase=='ready' else '', 'text_units':20,'piece_count':1,'leaf_count':1,'step_count':1,
                'completed_steps':1 if phase=='ready' else 0,'calls_used':1 if phase=='ready' else 0,'max_calls':30,'can_resume':False,'transcription_state':'partial','entries':[],**changes}

    def selections(self):
        return {'preview':{'reference':self.reference()},'start':{'job_id':self.job,'reference':self.reference(),'confirm_send':True},
                'status':{'job_id':self.job},'cancel':{'job_id':self.job,'state_sha256':self.digest},'resume':{'job_id':self.job,'state_sha256':self.digest,'confirm_send':True},
                'list':{'material_id':self.reference()['material_id'],'limit':10,'cursor':''},'read':{'job_id':self.job,'state_sha256':self.digest,'format':'md','offset':0,'max_chars':4000},
                'citation':{'job_id':self.job,'state_sha256':self.digest,'piece_id':'piece-0001'}}

    def test_schema9_exact_closed_actions_confirmation_refs_and_no_cross_schema_arguments(self):
        for suffix,selection in self.selections().items():
            action='recording-summary-'+suffix;command=cli.make_command(action,'dbg-'+'e'*32,recording_summary=selection)
            self.assertEqual(command['schema'],9);self.assertEqual(set(command),{'schema','id','action','created_at','expires_at','expected_uid','recording_summary'})
            self.assertEqual(command['recording_summary'],selection)
            for extra in [{'uid':'p10-a'},{'playback':{}},{'annotation':{}},{'saved_summary':{}},{'binding_sha256':self.digest}]:
                with self.subTest(action=action,extra=extra),self.assertRaises(ValueError):cli.make_command(action,'dbg-'+'e'*32,recording_summary=selection,**extra)
        for action in ['status',*cli.TASK_ACTIONS,*cli.NOTE_ACTIONS,*cli.PLAYBACK_ACTIONS]:
            with self.assertRaises(ValueError):cli.make_command(action,'dbg-'+'e'*32,recording_summary=self.selections()['status'])
        split=self.reference(source_range={'parent_utterance_id':'old','parent_revision':1,'start_ms':0,'end_ms':2000,'text_start':2,'text_end':10})
        self.assertEqual(cli.validate_recording_selection('recording-summary-preview',{'reference':split})['reference'],split)
        for suffix,changes in [('start',{'confirm_send':False}),('start',{'confirm_send':1}),('resume',{'state_sha256':''}),('list',{'limit':True}),('list',{'cursor':self.digest+':01'}),('read',{'offset':True}),('citation',{'piece_id':'../escape'})]:
            with self.subTest(suffix=suffix,changes=changes),self.assertRaises(ValueError):cli.validate_recording_selection('recording-summary-'+suffix,{**self.selections()[suffix],**changes})
        for ref in [self.reference(path='D:/secret.wav'),self.reference(material_id='mat-lifelog-'+'c'*32),self.reference(revision=True),self.reference(source_range=None),self.reference(utterance_id='\ud800')]:
            with self.assertRaises(ValueError):cli.validate_recording_selection('recording-summary-preview',{'reference':ref})

    def test_missing_confirmation_and_explicit_old_defaults_reject_before_file_access_or_transfer(self):
        invalid=[['recording-summary-start','--recording-reference','missing.json'],['recording-summary-resume','--recording-job-id',self.job,'--recording-state-sha256',self.digest],
                 ['recording-summary-status','--recording-job-id',self.job,'--confirm'],['recording-summary-status','--recording-job-id',self.job,'--uid',''],
                 ['recording-summary-list','--recording-material-id',self.reference()['material_id'],'--limit','10'],['status','--recording-cursor',''],['reconcile','--id','dbg-'+'a'*32,'--recording-offset','0']]
        for argv in invalid:
            with self.subTest(argv=argv),patch.object(cli.sys,'argv',['cli',*argv]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):cli.main()
                transfer.assert_not_called()

    def run_recording(self,suffix,payload=None,*,error='',extra_args=(),generated_job=False,reconcile=True):
        command,directions={},[]
        selection=self.selections()[suffix];action='recording-summary-'+suffix
        payload_field='recording_summary_'+('view' if suffix in ('start','status','cancel','resume') else 'chunk' if suffix=='read' else 'piece' if suffix=='citation' else suffix)
        def transfer(_hdc,_device,direction,source,target):
            directions.append(direction)
            if direction=='send':
                self.assertTrue(Path(source).is_file(),'intent must be stored before transport')
                command.update(json.loads(Path(source).read_text(encoding='utf-8')))
                self.assertNotIn('完整答案',json.dumps(command,ensure_ascii=False))
            else:
                result={'schema':1,'id':command['id'],'request_json':json.dumps(command),'state':'error' if error else 'complete','error':error,
                        'started_at':command['created_at'],'finished_at':command['created_at'],'snapshot':{},'control_call_completed':not bool(error)}
                if not error:
                    result[payload_field]=payload(command) if callable(payload) else payload
                Path(target).write_text(json.dumps(result,ensure_ascii=True),encoding='utf-8')
            return True
        with tempfile.TemporaryDirectory(prefix='turboio-recording-summary-cli-') as directory:
            base=Path(directory);self.assertEqual(base.drive.lower(),'d:','test must stay in controlled D scratch')
            ref=base/'reference.json';ref.write_text(json.dumps(self.reference()),encoding='utf-8')
            argv=['cli',action]
            if suffix in ('preview','start'):argv+=['--recording-reference',str(ref)]
            if 'job_id' in selection and not generated_job:argv+=['--recording-job-id',self.job]
            for key,flag in [('state_sha256','state-sha256'),('material_id','material-id'),('piece_id','piece-id')]:
                if key in selection:argv+=['--recording-'+flag,str(selection[key])]
            if suffix in ('start','resume'):argv+=['--confirm']
            output=io.StringIO()
            with patch.object(cli,'PRIVATE',base/'private'),patch.object(cli,'transfer',side_effect=transfer),patch.object(cli.subprocess,'run',side_effect=AssertionError('no real HDC/model/Agent')):
                with patch.object(cli.sys,'argv',[*argv,*extra_args]),contextlib.redirect_stdout(output):code=cli.main()
                rows=[json.loads(row) for row in output.getvalue().splitlines()]
                self.assertEqual(directions,['send','recv']);self.assertFalse(rows[0]['opens_microphone']);self.assertFalse(rows[0]['submits_answer']);self.assertTrue(rows[0]['recording_summary_job_only'])
                self.assertEqual(rows[0]['model_text_send_confirmed'],suffix in ('start','resume'));self.assertIn('complete is not ready',rows[-1]['completion_scope'])
                if reconcile:
                    directions.clear();again=io.StringIO()
                    with patch.object(cli.sys,'argv',['cli','reconcile','--id',command['id']]),contextlib.redirect_stdout(again):self.assertEqual(cli.main(),code)
                    self.assertEqual(directions,['recv']);self.assertEqual(json.loads(again.getvalue()),rows[-1])
                return code,rows[-1],command

    def test_queued_start_has_independent_job_and_reconcile_only_reads_a_control_receipt(self):
        code,row,command=self.run_recording('start',lambda c:self.view(job_id=c['recording_summary']['job_id']),generated_job=True)
        self.assertEqual(code,0);self.assertRegex(command['recording_summary']['job_id'],r'^rsum-[a-f0-9]{32}$');self.assertFalse(row['summary_ready']);self.assertEqual(row['recording_summary_view']['phase'],'queued')

    def test_readonly_preview_metadata_list_status_and_explicit_resume_cancel(self):
        preview={'schema':1,'text_units':20,'pieces':1,'leaf_count':1,'max_calls':30,'transcription_state':'partial'}
        self.run_recording('preview',preview)
        for suffix in ['status','resume','cancel']:self.run_recording(suffix,self.view('paused' if suffix=='cancel' else 'queued'))
        page={'items':[self.view('ready')],'next_cursor':'','has_more':False,'snapshot_sha256':self.digest,'scanned':1,'incomplete':False,'incomplete_reason':''}
        self.run_recording('list',page)
        empty={'material_id':'','revision':0,'text_revision':0,'utterance_id':'','content_sha256':''}
        for phase in ['missing','blocked']:
            cli.validate_recording_view(self.view(phase,source=empty,state_sha256='',model='',note='',text_units=0,piece_count=0,leaf_count=0,step_count=0,transcription_state=''),job=self.job)
        cli.validate_recording_view(self.view('stale',transcription_state=''),job=self.job)
        with self.assertRaises(ValueError):cli.validate_recording_view(self.view('blocked',source={**empty,'revision':False},state_sha256='',transcription_state=''),job=self.job)
        page.update(items=[],incomplete=True,incomplete_reason='read_limit');self.run_recording('list',page)

    def test_chunks_and_citations_preserve_exact_utf16_binding_without_a_model_call(self):
        chunk={'job_id':self.job,'state_sha256':self.digest,'format':'md','text':'完整😀','offset':0,'next_offset':4,'total_utf16':4,'has_more':False}
        _,row,_=self.run_recording('read',chunk);self.assertTrue(row['contains_sensitive_recording_summary'])
        piece={'id':'piece-0001','reference':self.reference(),'text_field':'utterance','char_start':0,'char_end':4,'text':'完整😀','speaker_label':'候选A','start_ms':None,'end_ms':None}
        self.run_recording('citation',piece)
        for changes in [{'state_sha256':'e'*64},{'offset':1},{'next_offset':3},{'text':'\ud800'},{'has_more':True}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.run_recording('read',{**chunk,**changes},reconcile=False)
        for changes in [{'id':'piece-0002'},{'char_end':3},{'start_ms':1,'end_ms':None},{'reference':self.reference(path='secret')}]:
            with self.assertRaises(ValueError):self.run_recording('citation',{**piece,**changes},reconcile=False)

    def test_ready_entries_are_bounded_with_evidence_and_partial_transcription_remains_explicit(self):
        entry={'category':'todo','text':'完整答案😀','evidence_ids':['piece-0001']}
        ready=self.view('ready',entries=[entry]);_,row,_=self.run_recording('status',ready)
        self.assertTrue(row['summary_ready']);self.assertEqual(row['recording_summary_view']['transcription_state'],'partial');self.assertTrue(row['contains_sensitive_recording_summary'])
        for changes in [{'entries':[entry]*21},{'entries':[dict(entry,text='x'*513)]},{'entries':[dict(entry,category='executed')]},{'calls_used':31},{'completed_steps':2},{'generated_at':''},{'source':self.reference(revision=True)},{'url':'private'}, {'state_sha256':'not-hash'}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):cli.validate_recording_view({**ready,**changes},job=self.job)

    def test_closed_errors_do_not_echo_private_server_or_fs_text(self):
        for raw,expected in [('RECORDING_SUMMARY_STALE','RECORDING_SUMMARY_STALE'),('private key and D:/audio/full transcript','DEBUG_OPERATION_FAILED')]:
            code,row,_=self.run_recording('status',error=raw);self.assertEqual(code,1);self.assertEqual(row['error'],expected)
            if raw!=expected:self.assertNotIn(raw,json.dumps(row))


class TodoCommandTests(unittest.TestCase):
    operation='tdel-'+'a'*32
    digest='b'*64
    stamp='2026-10-16T01:00:00.000Z'

    @staticmethod
    def reference(**changes):
        return {'id':101,'revision':2,'peer':'aabbccddeeff','content_sha256':'c'*64,**changes}

    @classmethod
    def item(cls,**changes):
        return {'reference':cls.reference(),'title':'合成待办😀','completed':False,'important':False,'delivery':'submitted','created':1760000000,'modified':1760000001,**changes}

    @classmethod
    def deletion(cls,**changes):
        return {'schema':1,'operation_id':cls.operation,'state_sha256':cls.digest,'revision':2,'phase':'submitted','note':'发送已提交，不代表眼镜删除确认',
                'todo':cls.item(),'attempts':1,'max_attempts':3,'can_cancel':False,'can_send':True,'receipt_observed':False,'receipt_success_count':-1,
                'receipt_failure_code':-1,'receipt_at':'','receipt_correlation':'none','query_observation':'not_queried','query_at':'',**changes}

    @classmethod
    def query(cls,**changes):
        return {'schema':1,'query_id':'tqry-'+'d'*32,'phase':'complete','peer':'aabbccddeeff','started_at':cls.stamp,'deadline_at':cls.stamp,
                'completed_at':cls.stamp,'batches':1,'received':0,'todo_total':0,'schedule_total':0,'note':'查询未见不代表删除确认','absence_is_confirmation':False,**changes}

    @classmethod
    def page(cls,scope='active',**changes):
        return {'schema':1,'scope':scope,'todos':[cls.item()] if scope=='active' else [],'deletions':[cls.deletion()] if scope=='deleted' else [],
                'next_cursor':'','has_more':False,'snapshot_sha256':cls.digest,'scanned':1,'incomplete':False,'incomplete_reason':'',**changes}

    def selections(self):
        return {'todo-list':{'scope':'active','limit':10,'cursor':''},'todo-delete':{'operation_id':self.operation,'reference':self.reference(),'confirm':True},
                'todo-delete-status':{'operation_id':self.operation},'todo-delete-cancel':{'operation_id':self.operation,'state_sha256':self.digest},
                'todo-delete-send':{'operation_id':self.operation,'state_sha256':self.digest,'confirm':True},'todo-query':{},'todo-query-status':{}}

    def test_schema10_exact_seven_actions_explicit_operation_confirmation_and_no_mixed_selectors(self):
        for action,selection in self.selections().items():
            command=cli.make_command(action,'dbg-'+'e'*32,todo=selection)
            self.assertEqual(command['schema'],10);self.assertEqual(set(command),{'schema','id','action','created_at','expires_at','expected_uid','todo'})
            self.assertLessEqual(len(json.dumps(command).encode()),2048)
            for extra in [{'uid':'card'},{'binding_sha256':self.digest},{'local_query':{}},{'playback':{}},{'recording_summary':{}}]:
                with self.subTest(action=action,extra=extra),self.assertRaises(ValueError):cli.make_command(action,'dbg-'+'e'*32,todo=selection,**extra)
        for action in ['status',*cli.TASK_ACTIONS,*cli.NOTE_ACTIONS,*cli.PLAYBACK_ACTIONS,*cli.RECORDING_ACTIONS]:
            with self.assertRaises(ValueError):cli.make_command(action,'dbg-'+'e'*32,todo={})
        invalid=[('todo-delete',{'confirm':False}),('todo-delete',{'confirm':1}),('todo-delete',{'operation_id':'generated-for-me'}),
                 ('todo-delete-send',{'state_sha256':''}),('todo-delete-status',{'confirm':True}),('todo-query',{'wire':22}),
                 ('todo-list',{'limit':True}),('todo-list',{'limit':11}),('todo-list',{'cursor':'tcur-'+self.digest+'-201'}),('todo-list',{'cursor':'tcur-'+self.digest+'-01'})]
        for action,changes in invalid:
            with self.subTest(action=action,changes=changes),self.assertRaises(ValueError):cli.validate_todo_selection(action,{**self.selections()[action],**changes})
        for ref in [self.reference(id=True),self.reference(revision=0),self.reference(id=9007199254740992),self.reference(peer='AA:BB:CC:DD:EE:FF'),self.reference(path='private')]:
            with self.assertRaises(ValueError):cli.validate_todo_selection('todo-delete',{**self.selections()['todo-delete'],'reference':ref})
        self.assertTrue(cli.todo_reference_valid(self.reference(id=9007199254740991,revision=9007199254740991,peer='')))
        self.assertTrue(cli.todo_cursor_valid('tcur-'+self.digest+'-200'))

    def test_missing_confirm_operation_and_cross_schema_flags_fail_before_transfer_or_reference_read(self):
        invalid=[['todo-delete','--todo-reference','does-not-exist.json','--todo-operation-id',self.operation],
                 ['todo-delete','--todo-reference','does-not-exist.json','--confirm'],['todo-delete-send','--todo-operation-id',self.operation,'--todo-state-sha256',self.digest],
                 ['todo-delete-status','--todo-operation-id',self.operation,'--confirm'],['todo-list','--limit','10'],['todo-query','--uid',''],
                 ['todo-query-status','--todo-operation-id',self.operation],['status','--todo-cursor',''],['reconcile','--id','dbg-'+'a'*32,'--todo-limit','10']]
        for argv in invalid:
            with self.subTest(argv=argv),patch.object(cli.sys,'argv',['cli',*argv]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):cli.main()
                transfer.assert_not_called()

    def run_todo(self,action,payload=None,*,error='',unconfirmed=False,scope='active',reconcile=True):
        command,directions,effects={},[],[];selection=self.selections()[action]
        field='todo_page' if action=='todo-list' else 'todo_query' if action in ('todo-query','todo-query-status') else 'todo_deletion'
        if payload is None:payload=self.page(scope) if field=='todo_page' else self.query() if field=='todo_query' else self.deletion()
        def transfer(_hdc,_device,direction,source,target):
            directions.append(direction)
            if direction=='send':
                self.assertEqual(target,cli.REMOTE+'/command.json','no attachment, arbitrary wire or audio is sent')
                command.update(json.loads(Path(source).read_text(encoding='utf-8')));self.assertEqual(command['schema'],10)
                self.assertLessEqual(Path(source).stat().st_size,2048);effects.append(command['action']);return not unconfirmed
            result={'schema':1,'id':command['id'],'request_json':json.dumps(command),'state':'error' if error else 'complete','error':error,
                    'started_at':command['created_at'],'finished_at':command['created_at'],'snapshot':{},'control_call_completed':not bool(error)}
            if not error:result[field]=payload
            raw=json.dumps(result).encode();self.assertLessEqual(len(raw),65536);Path(target).write_bytes(raw);return True
        with tempfile.TemporaryDirectory(prefix='turboio-todo095-cli-') as folder:
            base=Path(folder);self.assertEqual(base.drive.lower(),'d:','test must use managed D scratch');reference=base/'reference.json';reference.write_text(json.dumps(self.reference()),encoding='utf-8')
            argv=['cli',action]
            if 'operation_id' in selection:argv+=['--todo-operation-id',self.operation]
            if 'state_sha256' in selection:argv+=['--todo-state-sha256',self.digest]
            if action=='todo-delete':argv+=['--todo-reference',str(reference)]
            if action in ('todo-delete','todo-delete-send'):argv+=['--confirm']
            if action=='todo-list':argv+=['--todo-scope',scope]
            with patch.object(cli,'PRIVATE',base/'private'),patch.object(cli,'transfer',side_effect=transfer),patch.object(cli.subprocess,'run',side_effect=AssertionError('no actual HDC/device/network')):
                output=io.StringIO()
                with patch.object(cli.sys,'argv',argv),contextlib.redirect_stdout(output):code=cli.main()
                rows=[json.loads(line) for line in output.getvalue().splitlines()]
                self.assertEqual(directions,['send'] if unconfirmed else ['send','recv']);self.assertEqual(code,2 if unconfirmed else 1 if error else 0)
                self.assertTrue(rows[0]['todo_action_only']);self.assertFalse(rows[0]['opens_microphone']);self.assertFalse(rows[0]['submits_answer'])
                self.assertEqual(rows[0]['todo_delete_send_confirmed'],action in ('todo-delete','todo-delete-send'));self.assertEqual(rows[0]['operation_id'],selection.get('operation_id',''))
                if reconcile:
                    directions.clear();again=io.StringIO()
                    with patch.object(cli.sys,'argv',['cli','reconcile','--id',command['id']]),contextlib.redirect_stdout(again):self.assertEqual(cli.main(),1 if error else 0)
                    self.assertEqual(directions,['recv']);self.assertEqual(effects,[action]);row=json.loads(again.getvalue())
                    if not unconfirmed:self.assertEqual(row,rows[-1])
                else:row=rows[-1]
                self.assertFalse(row['lens_display_verified']);self.assertIn('query absence is not device confirmation',row['completion_scope']);self.assertIn('without resending',row['completion_scope'])
                for key in ('annotation_saved','recording_summary_view','playback_snapshot'):self.assertNotIn(key,row)
                self.assertIsNone(row['task_snapshot']);self.assertIsNone(row['recovery_snapshot'])
                return row,command

    def test_all_actions_transfer_only_short_intent_and_reconcile_never_repeats_effects(self):
        for action in cli.TODO_ACTIONS:
            row,command=self.run_todo(action);self.assertTrue(row['control_call_completed']);self.assertEqual(command['todo'],self.selections()[action])
        self.run_todo('todo-list',scope='deleted')

    def test_lost_send_receipt_reconcile_observes_prior_operation_and_closed_errors_do_not_leak(self):
        self.run_todo('todo-delete',unconfirmed=True)
        for raw in (*cli.TODO_ERRORS,'private title D:/users/full/context secret'):
            row,_=self.run_todo('todo-delete-status',error=raw)
            self.assertEqual(row['error'],raw if raw in cli.TODO_ERRORS else 'TODO_FAILED')
            if raw not in cli.TODO_ERRORS:self.assertNotIn(raw,json.dumps(row))

    def test_deletion_results_separate_local_send_receipt_and_query_observation_with_closed_metadata(self):
        cli.validate_todo_deletion(self.deletion());cli.validate_todo_deletion(self.deletion(phase='local_deleted',attempts=0,can_cancel=True,can_send=False))
        observed=self.deletion(receipt_observed=True,receipt_success_count=1,receipt_at=self.stamp,receipt_correlation='unattributed',query_observation='absent',query_at=self.stamp)
        row,_=self.run_todo('todo-delete-status',observed);self.assertEqual(row['todo_deletion']['receipt_correlation'],'unattributed');self.assertEqual(row['todo_deletion']['query_observation'],'absent')
        for phase in ('missing','blocked'):
            empty=self.item(reference={'id':0,'revision':0,'peer':'','content_sha256':''},title='',delivery='',created=0,modified=0)
            cli.validate_todo_deletion(self.deletion(phase=phase,state_sha256='',revision=0,todo=empty,attempts=0,can_send=False))
        for changes in [{'operation_id':'tdel-'+'e'*32},{'revision':True},{'state_sha256':'A'*64},{'attempts':4},{'phase':'device_confirmed'},
                        {'receipt_success_count':1},{'receipt_observed':True},{'receipt_failure_code':2147483648},{'query_observation':'absent'},
                        {'note':'\ud800'},{'note':'x'*513},{'todo':self.item(reference=self.reference(id=False))},{'private':'body'}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):cli.validate_todo_deletion({**self.deletion(),**changes},self.operation)
        command=cli.make_command('todo-delete','dbg-'+'f'*32,todo=self.selections()['todo-delete'])
        with self.assertRaises(ValueError):cli.validate_todo_result(command,{'state':'complete','todo_deletion':self.deletion(todo=self.item(reference=self.reference(revision=3)))})

    def test_list_pagination_scope_and_limit_are_closed_and_query_absence_never_claims_confirmation(self):
        command=cli.make_command('todo-list','dbg-'+'f'*32,todo=self.selections()['todo-list'])
        cli.validate_todo_result(command,{'state':'complete','todo_page':self.page(next_cursor='tcur-'+self.digest+'-1',has_more=True)})
        for changes in [{'todos':[self.item()]*11,'scanned':11},{'scope':'deleted'},{'deletions':[self.deletion()]},{'next_cursor':'tcur-'+'e'*64+'-1','has_more':True},
                        {'todos':[],'scanned':0,'has_more':True,'next_cursor':'tcur-'+self.digest+'-1'},{'scanned':False},{'incomplete_reason':'private path'}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):cli.validate_todo_result(command,{'state':'complete','todo_page':self.page(**changes)})
        cli.validate_todo_query(self.query());cli.validate_todo_query(self.query(phase='idle',query_id='',peer='',started_at='',deadline_at='',completed_at='',batches=0,received=0,todo_total=-1,schedule_total=-1))
        for changes in [{'absence_is_confirmation':True},{'absence_is_confirmation':0},{'phase':'confirmed'},{'query_id':'not-query'},{'peer':'AA:BB:CC:DD:EE:FF'},
                        {'completed_at':''},{'batches':65},{'received':401},{'todo_total':201},{'started_at':'today'},{'raw_wire':'private'}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):cli.validate_todo_query(self.query(**changes))

    def test_mixed_result_slots_and_invalid_reference_files_never_become_arbitrary_device_payload(self):
        command=cli.make_command('todo-delete-status','dbg-'+'f'*32,todo=self.selections()['todo-delete-status'])
        for result in [{'state':'complete'},{'state':'complete','todo_deletion':self.deletion(),'todo_query':self.query()},{'state':'error','todo_deletion':self.deletion()}]:
            with self.assertRaises(ValueError):cli.validate_todo_result(command,result)
        with tempfile.TemporaryDirectory(prefix='todo095-invalid-reference-') as folder:
            path=Path(folder)/'reference.json'
            for raw in ['x'*4097,json.dumps(self.reference(path='arbitrary')),'{broken']:
                path.write_text(raw,encoding='utf-8')
                argv=['cli','todo-delete','--todo-operation-id',self.operation,'--todo-reference',str(path),'--confirm']
                with patch.object(cli.sys,'argv',argv),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):cli.main()
                    transfer.assert_not_called()


class LocalScanCommandTests(unittest.TestCase):
    catalog='a'*64
    filter_sha='b'*64
    snapshot='c'*64

    @classmethod
    def cursor(cls,start=0):return 'lscan1:'+cls.catalog+':'+cls.filter_sha+':'+str(start)

    @classmethod
    def selection(cls,**changes):
        return {'from':0,'to':0,'keyword':'运费','speaker':'','limit':10,'scan_cursor':'','hit_cursor':'',**changes}

    @staticmethod
    def hit():
        return {'reference':{'material_id':'mat-lifelog-'+'d'*32,'revision':3,'text_revision':2,'utterance_id':'original-part','content_sha256':'e'*64},
                'kind':'lifelog','name':'seg-'+'d'*32,'source_started':1000,'source_ended':3000,'start_ms':100,'end_ms':200,'excerpt':'运费保持上次条件😀',
                'speaker_id':'speaker-0','speaker_label':'发言人A','speaker_basis':'segment_cluster','label_basis':'anonymous','is_self':False,'overlap':False,
                'transcription_state':'partial','audio_available':True}

    @classmethod
    def page(cls,**changes):
        return {'schema':1,'scope':'local_canonical_window','hits':[cls.hit()],'next_cursor':'','has_more':False,'snapshot_sha256':cls.snapshot,
                'scanned':512,'unreadable':0,'incomplete':True,'incomplete_reason':'window_only','legacy_not_indexed':True,'catalog_sha256':cls.catalog,
                'catalog_total':600,'window_start':0,'window_end':512,'content_units':2097152,'oversized':0,'scan_cursor':cls.cursor(),
                'next_scan_cursor':cls.cursor(512),'scan_has_more':True,'stop_reason':'scan_limit',**changes}

    def test_schema11_exact_filter_two_cursor_types_and_no_cross_schema_arguments(self):
        value=self.selection(scan_cursor=self.cursor(),hit_cursor=self.snapshot+':1');command=cli.make_command('scan-local','dbg-'+'f'*32,local_scan=value)
        self.assertEqual(command['schema'],11);self.assertEqual(set(command),{'schema','id','action','created_at','expires_at','expected_uid','local_scan'});self.assertEqual(command['local_scan'],value)
        value['keyword']='new';self.assertEqual(command['local_scan']['keyword'],'运费');self.assertLessEqual(len(json.dumps(command).encode()),2048)
        for extra in [{'uid':'p10-x'},{'binding_sha256':'a'*64},{'local_query':LocalQueryCommandTests.query()},{'todo':{}},{'playback':{}},{'annotation':{}},{'recording_summary':{}}]:
            with self.subTest(extra=extra),self.assertRaises(ValueError):cli.make_command('scan-local','dbg-'+'f'*32,local_scan=self.selection(),**extra)
        for action in ['status',cli.LOCAL_ACTION,*cli.TODO_ACTIONS,*cli.RECORDING_ACTIONS]:
            with self.assertRaises(ValueError):cli.make_command(action,'dbg-'+'f'*32,local_scan=self.selection())
        for changes in [{'cursor':''},{'scan_cursor':self.cursor().replace(':0',':01')},{'scan_cursor':self.cursor(9007199254740992)},
                        {'hit_cursor':self.snapshot+':1'},{'scan_cursor':self.cursor(),'hit_cursor':self.snapshot+':01'},{'scan_cursor':'../path'},
                        {'limit':True},{'limit':11},{'to':8640000000000001},{'keyword':'\ud800'},{'speaker':'\nname'},{'keyword':'','speaker':''}]:
            with self.subTest(changes=repr(changes)),self.assertRaises(ValueError):cli.validate_local_scan(self.selection(**changes))

    def test_scan_flags_are_mutually_exclusive_even_when_old_defaults_are_explicit_empty(self):
        invalid=[['scan-local','--keyword','运费',*args] for args in [['--cursor',''],['--uid',''],['--confirm'],['--todo-cursor',''],['--summary-cursor',''],['--recording-offset','0'],['--recovery-source','']]]
        invalid += [[action,'--scan-cursor',''] for action in ('search-local','status','reconcile','todo-list')]
        invalid += [[action,'--hit-cursor',''] for action in ('search-local','status','reconcile','todo-list')]
        for argv in invalid:
            with self.subTest(argv=argv),patch.object(cli.sys,'argv',['cli',*argv]),patch.object(cli,'transfer') as transfer,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):cli.main()
                transfer.assert_not_called()

    def run_scan(self,page=None,*,selection=None,error='',unconfirmed=False,extra_result=None,oversize=False):
        selection=self.selection() if selection is None else selection;page=self.page() if page is None else page;command,directions,effects={},[],[]
        def transfer(_hdc,_device,direction,source,target):
            directions.append(direction)
            if direction=='send':
                self.assertEqual(target,cli.REMOTE+'/command.json');self.assertLessEqual(Path(source).stat().st_size,2048);command.update(json.loads(Path(source).read_text(encoding='utf-8')));effects.append('scan');return not unconfirmed
            result={'schema':1,'id':command['id'],'request_json':json.dumps(command),'state':'error' if error else 'complete','error':error,
                    'started_at':command['created_at'],'finished_at':command['created_at'],'snapshot':{},'control_call_completed':not bool(error)}
            if not error:result['local_scan']=page
            if extra_result:result.update(extra_result)
            Path(target).write_bytes(b' '*65537 if oversize else json.dumps(result,ensure_ascii=False).encode());return True
        with tempfile.TemporaryDirectory(prefix='turboio-scan096-cli-') as folder:
            base=Path(folder);self.assertEqual(base.drive.lower(),'d:');argv=['cli','scan-local','--keyword',selection['keyword'],'--speaker',selection['speaker'],'--limit',str(selection['limit']),
                '--from-ms',str(selection['from']),'--to-ms',str(selection['to']),'--scan-cursor',selection['scan_cursor'],'--hit-cursor',selection['hit_cursor']]
            with patch.object(cli,'PRIVATE',base/'private'),patch.object(cli,'transfer',side_effect=transfer),patch.object(cli.subprocess,'run',side_effect=AssertionError('no actual HDC/model/network')):
                output=io.StringIO()
                with patch.object(cli.sys,'argv',argv),contextlib.redirect_stdout(output):code=cli.main()
                rows=[json.loads(line) for line in output.getvalue().splitlines()];self.assertEqual(code,2 if unconfirmed else 1 if error else 0);self.assertEqual(command['schema'],11)
                self.assertFalse(rows[0]['opens_microphone']);self.assertFalse(rows[0]['submits_answer']);self.assertTrue(rows[0]['local_scan_window_only']);self.assertFalse(rows[0]['automatic_continuation'])
                self.assertEqual(directions,['send'] if unconfirmed else ['send','recv']);directions.clear();again=io.StringIO()
                with patch.object(cli.sys,'argv',['cli','reconcile','--id',command['id']]),contextlib.redirect_stdout(again):self.assertEqual(cli.main(),1 if error else 0)
                self.assertEqual(directions,['recv']);self.assertEqual(effects,['scan']);row=json.loads(again.getvalue())
                if not unconfirmed:self.assertEqual(row,rows[-1])
                self.assertFalse(row['automatic_continuation']);self.assertFalse(row['lens_display_verified']);self.assertIsNone(row['local_query']);self.assertIn('zero window hits is not proof',row['completion_scope'])
                return row,command

    def test_scan_progress_hit_pagination_and_last_window_end_remain_separate_explicit_commands(self):
        first=self.page(has_more=True,next_cursor=self.snapshot+':1');row,_=self.run_scan(first);self.assertTrue(row['local_scan']['scan_has_more']);self.assertTrue(row['local_scan']['has_more'])
        self.run_scan(selection=self.selection(scan_cursor=self.cursor(),hit_cursor=self.snapshot+':1'))
        last=self.page(window_start=512,window_end=600,scanned=88,scan_cursor=self.cursor(512),next_scan_cursor='',scan_has_more=False,stop_reason='end')
        row,_=self.run_scan(last,selection=self.selection(scan_cursor=self.cursor(512)));self.assertTrue(row['local_scan']['incomplete']);self.assertEqual(row['local_scan']['incomplete_reason'],'window_only')
        empty=self.page(hits=[]);row,_=self.run_scan(empty);self.assertEqual(row['local_scan']['hits'],[]);self.assertTrue(row['local_scan']['scan_has_more'])

    def test_closed_window_metadata_rejects_forged_coverage_cursors_counts_and_cross_schema_payloads(self):
        command=cli.make_command('scan-local','dbg-'+'f'*32,local_scan=self.selection())
        for changes in [{'scope':'local_canonical_only'},{'catalog_sha256':'e'*64},{'window_end':601},{'window_start':1},{'scanned':513},{'content_units':2097153},
                        {'oversized':513},{'unreadable':True},{'legacy_not_indexed':False},{'incomplete':False,'incomplete_reason':''},{'scan_has_more':False,'next_scan_cursor':''},
                        {'next_scan_cursor':self.cursor(511)},{'next_scan_cursor':self.cursor(0)},{'stop_reason':'complete'},{'next_cursor':self.snapshot+':2','has_more':True},
                        {'hits':[self.hit()]*11},{'path':'private'},{'scan_cursor':None}]:
            with self.subTest(changes=repr(changes)),self.assertRaises(ValueError):cli.validate_local_scan_result(command,self.page(**changes),'complete')
        for field in ['task_snapshot','local_query','todo_page','playback_snapshot']:
            with self.subTest(field=field),self.assertRaises(ValueError):self.run_scan(extra_result={field:{}})
        with self.assertRaises(ValueError):self.run_scan(oversize=True)
        with self.assertRaises(ValueError):cli.validate_local_scan_result(command,None,'complete')
        with self.assertRaises(ValueError):cli.validate_local_scan_result(command,self.page(),'error')

    def test_real_reference_shapes_partial_text_and_unknown_timing_are_preserved_without_guessing_identity(self):
        good=self.hit();cli.validate_local_scan_hit(good)
        split=self.hit();split['start_ms']=split['end_ms']=None;split['reference']['source_range']={'parent_utterance_id':'original-part','parent_revision':1,'start_ms':100,'end_ms':200,'text_start':0,'text_end':4};cli.validate_local_scan_hit(split)
        body=self.hit();body['reference']['utterance_id']='';body['start_ms']=body['end_ms']=None;cli.validate_local_scan_hit(body)
        for changes in [{'is_self':True},{'audio_available':1},{'overlap':False,'raw_audio':'bytes'},{'excerpt':'x'*161},{'excerpt':'\ud800'},{'start_ms':None},
                        {'start_ms':-1},{'end_ms':2001},{'transcription_state':'verified'},{'reference':{**good['reference'],'material_id':'mat-recording-'+'d'*32}},
                        {'reference':{**good['reference'],'revision':False}},{'reference':{**good['reference'],'path':'private'}},{'speaker_label':'x'*81}]:
            with self.subTest(changes=repr(changes)),self.assertRaises(ValueError):cli.validate_local_scan_hit({**self.hit(),**changes})
        row,_=self.run_scan(self.page(hits=[split]));self.assertEqual(row['local_scan']['hits'][0]['reference']['source_range'],split['reference']['source_range']);self.assertTrue(row['contains_sensitive_local_excerpts'])

    def test_lost_transfer_and_closed_errors_do_not_rescan_or_leak_private_exception_messages(self):
        self.run_scan(unconfirmed=True)
        for raw in ['LOCAL_QUERY_INVALID','LOCAL_QUERY_STALE','LOCAL_SCAN_UNAVAILABLE','D:/private/full utterance token']:
            row,_=self.run_scan(error=raw);self.assertEqual(row['error'],raw if raw.startswith('LOCAL_') else 'DEBUG_OPERATION_FAILED');self.assertIsNone(row['local_scan'])
            if not raw.startswith('LOCAL_'):self.assertNotIn(raw,json.dumps(row))


if __name__ == '__main__':
    unittest.main()
