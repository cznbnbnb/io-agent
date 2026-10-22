import copy
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from runtime_journal import RuntimeJournal, RuntimeJournalError
from runtime_scheduler import stable

BINDING = {'server_id': 'server-a', 'owner_id': 'owner-a', 'producer_id': 'producer-a', 'computer_id': 'pc-a', 'agent_id': 'agent-a'}
SOURCE = {'kind': 'task', 'object_id': 'task-a', 'revision': 1,
          'body': {'task_id': 'task-a', 'revision': 1, 'state': 'queued', 'command': 'synthetic only',
                   'route': {'computer_id': 'pc-a', 'agent_id': 'agent-a', 'project_id': 'project-a', 'session_id': 'session-a'}}}
EVENT = {'event_id': 'event-a', 'delivery_id': 'item:task:task-a:1', 'actions': [{'action': 'task_state', 'state': 'completed'}]}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='io-runtime-journal-')
        self.addCleanup(self.temporary.cleanup)
        self.file = Path(self.temporary.name) / 'journal.sqlite'
        self.handles = []
        self.addCleanup(self.close_handles)
        self.journal = self.open()

    def close_handles(self):
        for handle in self.handles:
            handle.close()

    def open(self, binding=None):
        journal = RuntimeJournal(self.file, binding or BINDING)
        self.handles.append(journal)
        return journal

    def admit(self):
        return self.journal.admit('operation-a', EVENT['delivery_id'], SOURCE, {'text': 'synthetic'})

    def admission(self, with_event=True):
        source = copy.deepcopy(SOURCE)
        source['body']['allow_create_session'] = False
        operation = stable('op-', source['body']['task_id'])
        event = {'event_id': stable('rt-', [operation, 'admitted']), 'delivery_id': EVENT['delivery_id'],
                 'actions': [{'action': 'task_state', 'state': 'agent_received'},
                             {'action': 'receipt', 'stage': 'agent_received', 'subject_kind': 'task',
                              'subject_id': source['body']['task_id'], 'subject_revision': 1}]}
        self.journal.admit(operation, EVENT['delivery_id'], source, {'text': source['body']['command']}, event if with_event else None)
        return source, operation, event

    def test_admission_probe_reads_atomic_intake_after_ack_and_restart_without_claiming_again(self):
        source, operation, event = self.admission()
        self.journal.acknowledge([event['event_id']])
        self.assertTrue(self.journal.claim(operation))
        restarted = self.open()
        before = restarted.db.total_changes
        proof = restarted.inspect_admission(EVENT['delivery_id'], source)
        self.assertEqual(proof['status'], 'admitted')
        self.assertEqual(proof['source'], source)
        self.assertEqual(proof['operation_id'], operation)
        self.assertEqual(proof['admitted_event_id'], event['event_id'])
        self.assertEqual(restarted.db.total_changes, before)
        self.assertEqual(restarted.operation(operation)['state'], 'claimed')
        self.assertFalse(restarted.claim(operation))

    def test_admission_probe_requires_atomic_admission_event_not_just_operation_row(self):
        source, _, _ = self.admission(with_event=False)
        self.assertEqual(self.journal.inspect_admission(EVENT['delivery_id'], source), {'status': 'not_proven'})

    def test_admission_probe_refuses_changed_source_and_other_dispatch_kinds(self):
        source, _, _ = self.admission()
        changed = copy.deepcopy(source)
        changed['body']['command'] = 'another synthetic command'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ADMISSION_CONFLICT$'):
            self.journal.inspect_admission(EVENT['delivery_id'], changed)
        for delivery in ['answer:request:1:answer', 'closed:request:1', 'item:task:task-b:1']:
            with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ADMISSION_SOURCE_INVALID$'):
                self.journal.inspect_admission(delivery, source)

    def test_admission_probe_without_existing_operation_returns_no_proof_and_writes_nothing(self):
        source = copy.deepcopy(SOURCE)
        source['body']['allow_create_session'] = False
        before = self.journal.db.total_changes
        self.assertEqual(self.journal.inspect_admission(EVENT['delivery_id'], source), {'status': 'not_proven'})
        self.assertEqual(self.journal.db.total_changes, before)

    def test_admission_is_durable_and_same_delivery_cannot_get_another_operation(self):
        admitted = self.admit()
        self.assertEqual(admitted['state'], 'admitted')
        self.assertEqual(self.open().admit('operation-a', EVENT['delivery_id'], SOURCE, {'text': 'synthetic'}), admitted)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_DELIVERY_CONFLICT$'):
            self.journal.admit('operation-b', EVENT['delivery_id'], SOURCE, {'text': 'synthetic'})

    def test_reusing_operation_with_changed_payload_or_project_is_refused(self):
        self.admit()
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OPERATION_CONFLICT$'):
            self.journal.admit('operation-a', EVENT['delivery_id'], SOURCE, {'text': 'changed'})
        changed = copy.deepcopy(SOURCE)
        changed['body']['route']['project_id'] = 'other-project'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OPERATION_CONFLICT$'):
            self.journal.admit('operation-a', EVENT['delivery_id'], changed, {'text': 'synthetic'})

    def test_other_owner_cannot_open_the_same_journal(self):
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_BINDING_MISMATCH$'):
            self.open({**BINDING, 'owner_id': 'owner-b'})
        self.assertEqual(self.journal.events(), [])

    def test_other_runtime_route_cannot_be_admitted(self):
        changed = copy.deepcopy(SOURCE)
        changed['body']['route']['agent_id'] = 'other-agent'
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ROUTE_MISMATCH$'):
            self.journal.admit('operation-a', EVENT['delivery_id'], changed, {})
        self.assertIsNone(self.journal.operation('operation-a'))

    def child(self, exit_after_claim=False):
        module = str(Path(__file__).resolve().parent)
        code = "import json,os,sys; sys.path.insert(0,sys.argv[1]); from runtime_journal import RuntimeJournal; j=RuntimeJournal(sys.argv[2],json.loads(sys.argv[3])); claimed=j.claim('operation-a'); "
        code += "os._exit(73 if claimed else 74)" if exit_after_claim else "j.close(); sys.exit(0 if claimed else 2)"
        return subprocess.Popen([sys.executable, '-I', '-S', '-B', '-c', code, module, str(self.file), json.dumps(BINDING)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def test_two_actual_processes_compete_for_exactly_one_claim(self):
        self.admit()
        children = [self.child(), self.child()]
        results = [child.wait(timeout=15) for child in children]
        self.assertEqual(sorted(results), [0, 2])
        self.assertEqual(self.journal.operation('operation-a')['state'], 'claimed')

    def test_actual_process_exit_after_claim_does_not_allow_execution_again(self):
        self.admit()
        child = self.child(exit_after_claim=True)
        self.assertEqual(child.wait(timeout=15), 73)
        restarted = self.open()
        self.assertFalse(restarted.claim('operation-a'))
        self.assertEqual(restarted.operation('operation-a')['state'], 'claimed')

    def test_events_and_ack_tombstones_survive_reopen_and_conflicting_replay_is_rejected(self):
        self.admit()
        self.assertTrue(self.journal.append_event(EVENT))
        reopened = self.open()
        self.assertEqual(reopened.events(), [EVENT])
        self.assertFalse(reopened.append_event(EVENT))
        reopened.acknowledge(['event-a'])
        again = self.open()
        self.assertEqual(again.events(), [])
        self.assertFalse(again.append_event(EVENT))
        self.assertEqual(again.events(), [])
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_CONFLICT$'):
            again.append_event({**EVENT, 'actions': []})

    def test_ack_with_unknown_member_is_atomic_and_keeps_known_event_pending(self):
        self.admit()
        self.journal.append_event(EVENT)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_ACK_UNKNOWN$'):
            self.journal.acknowledge(['event-a', 'unknown'])
        self.assertEqual(self.journal.events(), [EVENT])
        self.journal.acknowledge(['event-a'])
        self.journal.acknowledge(['event-a'])
        self.assertEqual(self.journal.events(), [])

    def test_terminal_outcome_and_event_commit_together_and_are_immutable(self):
        self.admit()
        self.assertTrue(self.journal.claim('operation-a'))
        self.journal.settle('operation-a', 'completed', {'evidence': 'synthetic-only'}, EVENT)
        reopened = self.open()
        self.assertEqual(reopened.operation('operation-a')['state'], 'completed')
        self.assertEqual(reopened.events(), [EVENT])
        reopened.settle('operation-a', 'completed', {'evidence': 'synthetic-only'}, EVENT)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OUTCOME_CONFLICT$'):
            reopened.settle('operation-a', 'failed', {}, {**EVENT, 'actions': []})

    def test_event_conflict_cannot_partially_settle_operation(self):
        self.admit()
        self.journal.claim('operation-a')
        self.journal.append_event(EVENT)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_CONFLICT$'):
            self.journal.settle('operation-a', 'failed', {}, {**EVENT, 'actions': []})
        self.assertEqual(self.journal.operation('operation-a')['state'], 'claimed')
        self.assertIsNone(self.journal.operation('operation-a')['outcome'])

    def test_foreign_database_is_preserved_and_never_initialized_as_runtime(self):
        self.close_handles()
        self.file.unlink()
        db = sqlite3.connect(self.file)
        db.execute('CREATE TABLE foreign_data (value TEXT)')
        db.execute("INSERT INTO foreign_data VALUES ('synthetic preserve')")
        db.commit()
        db.close()
        before = self.file.read_bytes()
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_FOREIGN_DATABASE$'):
            self.open()
        self.assertEqual(self.file.read_bytes(), before)

    def test_unknown_delivery_and_malformed_event_never_enter_outbox(self):
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_DELIVERY_UNKNOWN$'):
            self.journal.append_event(EVENT)
        self.admit()
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_INVALID$'):
            self.journal.append_event({**EVENT, 'event_id': 'invalid event id'})
        self.assertEqual(self.journal.events(), [])

    def test_original_command_deadline_survives_reopen_and_conflicting_replay(self):
        source = {**SOURCE, 'expires_at': '2026-10-12T03:00:00Z', 'command_expires_at': '2026-10-12T02:01:00Z'}
        self.journal.admit('operation-a', EVENT['delivery_id'], source, {})
        reopened = self.open()
        self.assertEqual(json.loads(reopened.operation('operation-a')['source']), source)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OPERATION_CONFLICT$'):
            reopened.admit('operation-a', EVENT['delivery_id'], {**source, 'command_expires_at': source['expires_at']}, {})
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_TIME_INVALID$'):
            reopened.admit('operation-b', 'item:b', {**source, 'expires_at': 'invalid'}, {})
        self.assertIsNone(reopened.operation('operation-b'))

    def test_admission_event_is_atomic_and_acknowledged_replay_stays_acknowledged(self):
        received = {**EVENT, 'actions': [{'action': 'task_state', 'state': 'agent_received'}]}
        self.journal.admit('operation-a', EVENT['delivery_id'], SOURCE, {}, received)
        self.assertEqual(self.open().events(), [received])
        self.journal.acknowledge([received['event_id']])
        self.open().admit('operation-a', EVENT['delivery_id'], SOURCE, {}, received)
        self.assertEqual(self.journal.events(), [])
        # A conflicting event rolls back a newly inserted operation too.
        conflicting = {**received, 'delivery_id': 'item:b'}
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_CONFLICT$'):
            self.journal.admit('operation-b', 'item:b', SOURCE, {}, conflicting)
        self.assertIsNone(self.journal.operation('operation-b'))

    def test_waiting_work_is_fifo_across_restart_and_claimed_work_is_excluded(self):
        for suffix in ['z', 'a', 'm']:
            self.journal.admit('operation-' + suffix, 'item:' + suffix, SOURCE, {})
        reopened = self.open()
        self.assertEqual([row['operation_id'] for row in reopened.operations_in_state('admitted', 2)], ['operation-z', 'operation-a'])
        reopened.claim('operation-z')
        self.assertEqual([row['operation_id'] for row in self.journal.operations_in_state('admitted')], ['operation-a', 'operation-m'])
        self.assertEqual([row['operation_id'] for row in self.journal.operations_in_state('claimed')], ['operation-z'])
        for limit in [True, 0, 1001]:
            with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_LIMIT_INVALID$'):
                reopened.operations_in_state('admitted', limit)

    def test_only_unclaimed_work_can_expire_and_terminal_event_commits_atomically(self):
        self.admit()
        expired = {**EVENT, 'actions': [{'action': 'task_state', 'state': 'expired'}]}
        self.journal.append_event(EVENT)
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_EVENT_CONFLICT$'):
            self.journal.settle_unstarted('operation-a', 'expired', {}, expired)
        self.assertEqual(self.journal.operation('operation-a')['state'], 'admitted')
        expired['event_id'] = 'event-expired'
        self.journal.settle_unstarted('operation-a', 'expired', {'reason': 'deadline'}, expired)
        reopened = self.open()
        self.assertEqual(reopened.operation('operation-a')['state'], 'expired')
        self.assertFalse(reopened.claim('operation-a'))
        reopened.acknowledge(['event-expired'])
        reopened.settle_unstarted('operation-a', 'expired', {'reason': 'deadline'}, expired)
        self.assertEqual(reopened.events(), [EVENT])
        self.journal.admit('operation-b', 'item:b', SOURCE, {})
        self.journal.claim('operation-b')
        with self.assertRaisesRegex(RuntimeJournalError, '^RUNTIME_OPERATION_NOT_QUEUED$'):
            self.journal.settle_unstarted('operation-b', 'cancelled', {}, {**expired, 'event_id': 'event-b', 'delivery_id': 'item:b'})
        self.assertEqual(self.journal.operation('operation-b')['state'], 'claimed')


if __name__ == '__main__':
    unittest.main(verbosity=2)
