import asyncio
import copy
import hashlib
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from question_tools import QuestionTools, load_tools
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode
from test_runtime_journal import BINDING, SOURCE, EVENT

NOW = datetime(2026, 10, 12, tzinfo=timezone.utc).timestamp()
DEADLINE = '2026-10-12T00:30:00Z'


class QuestionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='io-question-tools-')
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'journal.sqlite'
        self.journal = RuntimeJournal(self.file, BINDING)
        self.addCleanup(self.journal.close)
        self.journal.admit('operation-a', EVENT['delivery_id'], SOURCE, {})
        self.journal.claim('operation-a')
        self.tools = QuestionTools(self.journal, 'operation-a')

    def ask(self, **changes):
        arguments = {'operation_id': 'operation-a', 'question_key': 'confirm-a', 'question': 'Synthetic choice?',
                     'mode': 'choice', 'options': [{'option_id': 'A', 'label': 'Synthetic A'}, {'option_id': 'B', 'label': 'Synthetic B'}],
                     'expires_at': DEADLINE, 'now': NOW}
        return self.journal.ask(**{**arguments, **changes})

    def objects(self, request_id):
        spec = self.journal.events()[0]['actions'][0]
        body = {'request_id': request_id, 'revision': 1, 'task_id': 'task-a', 'route': SOURCE['body']['route'], 'state': 'answered',
                **{key: spec[key] for key in ['question', 'mode', 'options', 'runtime_request_id']}}
        request = {'kind': 'request', 'object_id': request_id, 'revision': 1, 'body': body, 'state': 'answered'}
        answer = {'kind': 'answer', 'object_id': 'answer-a', 'revision': 1, 'stored_at': '2026-10-12T00:20:00Z',
                  'body': {'answer_id': 'answer-a', 'request_id': request_id, 'request_revision': 1, 'task_id': 'task-a',
                           'route': SOURCE['body']['route'], 'option_id': 'B', 'text': '', 'input_source': 'rotary', 'raw_action': None}}
        return request, answer

    async def test_ask_and_event_commit_together_reopen_and_same_key_replay(self):
        reply = self.ask()
        event = self.journal.events()[0]
        self.assertEqual(reply['state'], 'pending')
        self.assertEqual(event['delivery_id'], EVENT['delivery_id'])
        self.assertEqual(event['actions'][0]['expires_at'], DEADLINE)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_QUESTION_CONFLICT$'):
            self.ask(question='different')
        self.journal.close()
        self.journal = RuntimeJournal(self.file, BINDING)
        self.addCleanup(self.journal.close)
        self.assertEqual(self.ask(now=NOW + 99999)['request_id'], reply['request_id'])
        self.assertEqual(len(self.journal.events()), 1)

    async def test_answer_probe_is_readonly_after_consumption_settlement_and_reopen(self):
        asked = self.ask()
        request, answer = self.objects(asked['request_id'])
        key = 'answer:' + asked['request_id'] + ':1:answer-a'
        self.journal.record_answer('operation-a', request, answer)
        self.journal.consume_answer('operation-a', asked['request_id'])
        self.journal.settle('operation-a', 'completed', {}, EVENT)
        with closing(RuntimeJournal(self.file, BINDING)) as reopened:
            before = reopened.db.total_changes
            events = reopened.events()
            proof = reopened.inspect_answer_intake(key, request, answer)
            value = {'answer_id': answer['object_id'], 'stored_at': answer['stored_at'], 'body': answer['body']}
            self.assertEqual(proof['status'], 'received')
            self.assertEqual(proof['delivery_id'], key)
            self.assertEqual(proof['answer_digest'], hashlib.sha256(encode(value).encode('utf-8')).hexdigest())
            self.assertEqual(reopened.db.total_changes, before)
            self.assertEqual(reopened.events(), events)
            self.assertEqual(reopened.operation('operation-a')['state'], 'completed')
            self.assertFalse(reopened.claim('operation-a'))

    async def test_answer_probe_does_not_consume_received_answer_or_emit_resume(self):
        asked = self.ask()
        request, answer = self.objects(asked['request_id'])
        self.journal.record_answer('operation-a', request, answer)
        before = self.journal.db.total_changes
        self.assertEqual(self.journal.inspect_answer_intake('answer:' + asked['request_id'] + ':1:answer-a', request, answer)['status'], 'received')
        self.assertEqual(self.journal.db.total_changes, before)
        self.assertEqual(self.journal.db.execute('SELECT consumed FROM questions').fetchone()[0], 0)
        self.assertFalse(any(a.get('stage') == 'task_resumed' for e in self.journal.events() for a in e['actions']))

    async def test_answer_probe_matches_server_millisecond_deadline_without_extending_it(self):
        asked = self.ask(expires_at='2026-10-12T00:30:00.123456Z')
        request, answer = self.objects(asked['request_id'])
        request['expires_at'] = '2026-10-12T00:30:00.123Z'
        key = 'answer:' + asked['request_id'] + ':1:answer-a'
        self.journal.record_answer('operation-a', request, answer)
        self.assertEqual(self.journal.inspect_answer_intake(key, request, answer)['status'], 'received')
        request['expires_at'] = '2026-10-12T00:30:00.124Z'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_INTAKE_CONFLICT$'):
            self.journal.inspect_answer_intake(key, request, answer)

    async def test_answer_probe_on_unknown_operation_proves_only_received_and_never_reopens_it(self):
        asked = self.ask()
        request, answer = self.objects(asked['request_id'])
        self.journal.record_answer('operation-a', request, answer)
        event = {**EVENT, 'actions': [{'action': 'task_state', 'state': 'execution_unknown'}]}
        self.journal.settle('operation-a', 'unknown', {'reason': 'synthetic owner interruption'}, event)
        before = self.journal.db.total_changes
        proof = self.journal.inspect_answer_intake('answer:' + asked['request_id'] + ':1:answer-a', request, answer)
        self.assertEqual(proof['status'], 'received')
        self.assertEqual(self.journal.db.total_changes, before)
        self.assertEqual(self.journal.operation('operation-a')['state'], 'unknown')
        self.assertEqual(self.journal.reply('operation-a', asked['request_id'])['state'], 'operation_closed')
        self.assertEqual(self.journal.db.execute('SELECT consumed FROM questions').fetchone()[0], 0)
        self.assertFalse(any(a.get('stage') == 'task_resumed' for e in self.journal.events() for a in e['actions']))

    async def test_answer_probe_absence_is_no_proof_and_never_records_or_claims(self):
        asked = self.ask()
        request, answer = self.objects(asked['request_id'])
        key = 'answer:' + asked['request_id'] + ':1:answer-a'
        before = self.journal.db.total_changes
        self.assertEqual(self.journal.inspect_answer_intake(key, request, answer), {'status': 'not_proven'})
        self.journal.db.execute('DELETE FROM questions')
        after_delete = self.journal.db.total_changes
        self.assertEqual(self.journal.inspect_answer_intake(key, request, answer), {'status': 'not_proven'})
        self.assertEqual(self.journal.db.total_changes, after_delete)
        self.assertEqual(after_delete, before + 1)
        self.assertEqual(self.journal.operation('operation-a')['state'], 'claimed')

    async def test_answer_probe_rejects_changed_answer_question_route_deadline_and_delivery(self):
        asked = self.ask()
        request, answer = self.objects(asked['request_id'])
        key = 'answer:' + asked['request_id'] + ':1:answer-a'
        self.journal.record_answer('operation-a', request, answer)
        changes = []
        changed = copy.deepcopy(answer);changed['body']['text'] = 'Different synthetic answer';changes.append((key, request, changed))
        changed = copy.deepcopy(request);changed['body']['question'] = 'Different question';changes.append((key, changed, answer))
        changed = copy.deepcopy(request);changed['body']['route']['session_id'] = 'other';changes.append((key, changed, answer))
        changed = copy.deepcopy(request);changed['expires_at'] = '2026-10-12T00:31:00Z';changes.append((key, changed, answer))
        changes.append(('closed:' + asked['request_id'] + ':1', request, answer))
        before = self.journal.db.total_changes
        for delivery, req, value in changes:
            with self.assertRaises(RuntimeJournalError):
                self.journal.inspect_answer_intake(delivery, req, value)
        self.assertEqual(self.journal.db.total_changes, before)

    async def test_invalid_question_cannot_leave_event_or_wait(self):
        for changes in [{'options': []}, {'mode': 'free_text'}, {'expires_at': 'local-time'},
                        {'expires_at': '2026-10-12T02:00:00Z'}, {'question': '  '},
                        {'options': [{'option_id': 'A', 'label': 'A'}, {'option_id': 'A', 'label': 'B'}]}]:
            with self.assertRaises(RuntimeJournalError):
                self.ask(**changes)
        self.assertEqual(self.journal.events(), [])
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM questions').fetchone()[0], 0)

    async def test_event_conflict_rolls_back_question(self):
        reply = self.ask()
        event = self.journal.events()[0]
        self.journal.db.execute('DELETE FROM questions')
        self.journal.db.execute('UPDATE runtime_events SET event=?', (json.dumps({**event, 'actions': []}),))
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_CONFLICT$'):
            self.ask()
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_QUESTION_UNKNOWN$'):
            self.journal.reply('operation-a', reply['request_id'])

    async def test_record_answer_before_deadline_delivered_late_remains_valid_and_durable(self):
        reply = self.ask()
        self.assertTrue(self.journal.reply('operation-a', reply['request_id'], now=NOW + 7200)['deadline_elapsed'])
        request, answer = self.objects(reply['request_id'])
        self.assertTrue(self.journal.record_answer('operation-a', request, answer))
        self.assertFalse(self.journal.record_answer('operation-a', request, answer))
        self.journal.close()
        self.journal = RuntimeJournal(self.file, BINDING)
        self.addCleanup(self.journal.close)
        self.tools = QuestionTools(self.journal, 'operation-a')
        result = await self.tools.call('wait_answer', {'request_id': reply['request_id'], 'wait_seconds': 0})
        self.assertEqual(result['state'], 'answered')
        self.assertEqual(result['answer']['body']['option_id'], 'B')

    async def test_answer_route_version_runtime_and_question_content_must_match(self):
        reply = self.ask()
        for field, value in [('request_revision', 2), ('task_id', 'other-task'), ('route', {**SOURCE['body']['route'], 'session_id': 'other'})]:
            request, answer = self.objects(reply['request_id'])
            answer['body'][field] = value
            with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_ROUTE_MISMATCH$'):
                self.journal.record_answer('operation-a', request, answer)
        for field in ['runtime_request_id', 'question']:
            request, answer = self.objects(reply['request_id'])
            request['body'][field] = 'changed'
            with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_ROUTE_MISMATCH$'):
                self.journal.record_answer('operation-a', request, answer)
        self.assertEqual(self.journal.reply('operation-a', reply['request_id'])['state'], 'pending')

    async def test_invalid_or_late_answer_and_conflicting_second_answer_refused(self):
        reply = self.ask()
        request, answer = self.objects(reply['request_id'])
        late = {**answer, 'stored_at': DEADLINE}
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_EXPIRED$'):
            self.journal.record_answer('operation-a', request, late)
        invalid = copy.deepcopy(answer)
        invalid['body']['option_id'] = 'other'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_INVALID$'):
            self.journal.record_answer('operation-a', request, invalid)
        self.journal.record_answer('operation-a', request, answer)
        changed = copy.deepcopy(answer)
        changed['body']['option_id'] = 'A'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ANSWER_CONFLICT$'):
            self.journal.record_answer('operation-a', request, changed)

    async def test_wait_cancellation_does_not_delete_question_and_other_operation_cannot_read(self):
        from datetime import timedelta
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat().replace('+00:00', 'Z')
        reply = self.ask(expires_at=deadline, now=datetime.now(timezone.utc).timestamp())
        wait = asyncio.create_task(self.tools.call('wait_answer', {'request_id': reply['request_id']}))
        await asyncio.sleep(0.01)
        wait.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await wait
        self.assertEqual(self.journal.reply('operation-a', reply['request_id'])['state'], 'pending')
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_QUESTION_UNKNOWN$'):
            self.journal.reply('operation-other', reply['request_id'])

    async def test_closed_question_and_settled_operation_cannot_receive_new_answer(self):
        reply = self.ask()
        self.journal.close_question('operation-a', reply['request_id'], 'expired')
        self.journal.close_question('operation-a', reply['request_id'], 'expired')
        request, answer = self.objects(reply['request_id'])
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_QUESTION_CLOSED$'):
            self.journal.record_answer('operation-a', request, answer)
        self.journal.settle('operation-a', 'cancelled', {}, EVENT)
        self.assertEqual(self.journal.reply('operation-a', reply['request_id'])['state'], 'operation_closed')
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OPERATION_NOT_ACTIVE$'):
            self.ask(question_key='new-question')

    async def test_model_tools_cannot_choose_route_answer_claim_or_other_operation(self):
        for name, arguments in [('record_answer', {}), ('claim', {}), ('ask_user', {'operation_id': 'other'}),
                                ('wait_answer', {'request_id': 'req-unknown', 'operation_id': 'other'}),
                                ('wait_answer', {'request_id': 'req-unknown', 'wait_seconds': float('inf')})]:
            with self.assertRaises(RuntimeJournalError):
                await self.tools.call(name, arguments)

    async def test_only_actual_answer_consumption_emits_resume_and_ack_replay_is_stable(self):
        reply = self.ask()
        request, answer = self.objects(reply['request_id'])
        self.journal.record_answer('operation-a', request, answer)
        self.assertFalse(any(a.get('stage') == 'task_resumed' for e in self.journal.events() for a in e['actions']))
        consumed = self.journal.consume_answer('operation-a', reply['request_id'], now=NOW)
        self.assertEqual(consumed['answer']['answer_id'], answer['object_id'])
        resumed = self.journal.events()[-1]
        self.assertEqual(resumed['actions'][-1]['stage'], 'task_resumed')
        self.journal.acknowledge([resumed['event_id']])
        self.journal.consume_answer('operation-a', reply['request_id'], now=NOW)
        self.assertEqual(len(self.journal.events()), 1)

    async def test_v1_migration_preserves_claim_and_event_but_wrong_binding_cannot_migrate(self):
        self.journal.append_event(EVENT)
        self.journal.db.execute('DROP TABLE questions')
        self.journal.db.execute('DROP TABLE operation_controls')
        self.journal.db.execute('DROP TABLE native_turns')
        self.journal.db.execute('PRAGMA user_version=1')
        self.journal.close()
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_BINDING_MISMATCH$'):
            RuntimeJournal(self.file, {**BINDING, 'owner_id': 'other'})
        with closing(sqlite3.connect(self.file)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 1)
        self.journal = RuntimeJournal(self.file, BINDING)
        self.addCleanup(self.journal.close)
        self.assertFalse(self.journal.claim('operation-a'))
        self.assertEqual(self.journal.events(), [EVENT])
        self.assertEqual(self.journal.db.execute('PRAGMA user_version').fetchone()[0], 3)

    async def test_tool_config_uses_existing_claimed_operation_and_rejects_unknown_or_foreign(self):
        config = Path(self.temp.name) / 'config.json'
        data = {'journal': str(self.file), 'operation_id': 'operation-a', 'binding': BINDING}
        config.write_text(json.dumps(data), encoding='utf-8')
        scoped = load_tools(config)
        scoped.journal.close()
        for changes in [{'operation_id': 'unknown'}, {'binding': {**BINDING, 'owner_id': 'other'}}, {'journal': str(self.file) + '.missing'}]:
            config.write_text(json.dumps({**data, **changes}), encoding='utf-8')
            with self.assertRaises(RuntimeJournalError):
                load_tools(config)
        self.assertFalse(Path(str(self.file) + '.missing').exists())


if __name__ == '__main__':
    unittest.main()
