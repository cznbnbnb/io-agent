"""Synthetic administrative attestations only; no human decision is fabricated."""
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from managed_home import ManagedHomeLease
from native_observer import observe_result
from reconciliation import apply, inspect, digest, CONFIRMATION
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode
from test_runtime_journal import BINDING, SOURCE
from test_runtime_scheduler import full_result


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='io-review-')
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.workspace=self.home/'workspace';self.workspace.mkdir()
        self.sessions={'session-a':{'project_id':'project-a','cwd':str(self.workspace.resolve())}}
        (self.home/'.turboio-managed.json').write_text(encode({'schema':1,'binding':BINDING,'sessions':self.sessions}),encoding='utf-8')
        self.config={'home':str(self.home),'journal':str(self.home/'journal.sqlite'),
                     'binding':BINDING,'sessions':self.sessions,
                     'source':str(self.home),'site_packages':str(self.home)}
        self.journal=RuntimeJournal(self.config['journal'],BINDING)
        self.addCleanup(self.journal.close)
        self.journal.admit('operation-a','delivery-a',SOURCE,{'text':'private synthetic prompt'})
        self.journal.claim('operation-a')
        self.journal.native_started('operation-a')
        self.journal.settle('operation-a','unknown',{'reason':'original_unknown'},
            {'event_id':'original-unknown','delivery_id':'delivery-a',
             'actions':[{'action':'task_state','state':'execution_unknown'}]})
        self.evidence=self.home/'synthetic-evidence.txt'
        self.evidence.write_text('SYNTHETIC TEST: no business execution or human decision',encoding='utf-8')

    def decision(self,state='failed'):
        return {'schema':1,'operation_id':'operation-a',
                'review_digest':inspect(self.config,'operation-a')['review_digest'],
                'resolution_id':'synthetic-resolution','method':'operator_attestation',
                'actor':'SYNTHETIC TEST ACTOR','decision':state,
                'reason':'Synthetic adjudication, not a real user decision',
                'evidence_file':str(self.evidence),
                'evidence_sha256':hashlib.sha256(self.evidence.read_bytes()).hexdigest(),
                'result_text':'Synthetic verified result' if state=='completed' else None,
                'confirmation':CONFIRMATION,'owned_processes_stopped':True,'external_effects_reviewed':True}

    def apply(self,decision):
        with patch('reconciliation.verify_source',return_value=self.home):
            return apply(self.config,decision)

    def test_readonly_inspection_discloses_no_prompt_result_or_answer_and_creates_no_files(self):
        self.journal.native_returned('operation-a',observe_result(full_result('private synthetic result')))
        before={p.name for p in self.home.iterdir()}
        content=(self.home/'journal.sqlite').read_bytes()
        actual=inspect(self.config,'operation-a')
        self.assertNotIn('private synthetic',encode(actual))
        self.assertEqual(actual['state'],'unknown')
        self.assertFalse(actual['replay_permitted'])
        self.assertEqual({p.name for p in self.home.iterdir()},before)
        self.assertEqual((self.home/'journal.sqlite').read_bytes(),content)
        self.assertFalse((self.home/'.turboio-owner.sqlite').exists())
        readonly=RuntimeJournal.open_readonly(self.config['journal'],BINDING)
        try:
            with self.assertRaises(sqlite3.OperationalError):readonly.claim('operation-a')
        finally:readonly.close()

    def test_missing_database_never_created_by_inspect_or_apply(self):
        config={**self.config,'journal':str(self.home/'absent.sqlite')}
        for action in [lambda:inspect(config,'operation-a'),lambda:apply(config,self.decision())]:
            with self.assertRaises(RuntimeJournalError):action()
        self.assertFalse((self.home/'absent.sqlite').exists())

    def test_live_runtime_owner_excludes_administrator_without_changing_unknown(self):
        decision=self.decision();lease=ManagedHomeLease(self.home,BINDING,self.sessions)
        try:
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_HOME_IN_USE'):self.apply(decision)
            self.assertEqual(self.journal.operation('operation-a')['state'],'unknown')
        finally:lease.close()

    def test_failed_attestation_is_durable_idempotent_preserves_unknown_event_and_never_claims(self):
        decision=self.decision()
        self.assertEqual(self.apply(decision)['status'],'reconciled')
        self.assertEqual(self.apply(decision)['status'],'already_reconciled')
        current=self.journal.operation('operation-a')
        self.assertEqual(current['state'],'failed')
        outcome=json.loads(current['outcome'])
        self.assertEqual(outcome['prior_outcome'],{'reason':'original_unknown'})
        self.assertEqual(outcome['reconciliation']['method'],'operator_attestation')
        self.assertFalse(outcome['reconciliation']['native_completion_proven'])
        events=self.journal.events()
        self.assertEqual(len(events),2)
        self.assertEqual(events[0]['event_id'],'original-unknown')
        self.assertFalse(any(a['action']=='message' for e in events for a in e['actions']))
        self.assertFalse(self.journal.claim('operation-a'))
        reopened=RuntimeJournal(self.config['journal'],BINDING)
        try:self.assertEqual(reopened.operation('operation-a'),current)
        finally:reopened.close()
        changed={**decision,'reason':'changed later'}
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_RECONCILIATION_CONFLICT'):self.apply(changed)

    def test_completed_attestation_labels_manual_result_separately_from_native_evidence(self):
        self.apply(self.decision('completed'))
        actions=self.journal.events()[-1]['actions']
        self.assertEqual([a.get('channel') for a in actions if a['action']=='message'],['progress','result'])
        self.assertIn('人工',next(a['text'] for a in actions if a.get('channel')=='progress'))
        self.assertEqual(inspect(self.config,'operation-a')['outcome_method'],'operator_attestation')

    def test_cancelled_attestation_cannot_be_inferred_from_only_a_cancel_request(self):
        decision=self.decision('cancelled')
        self.journal.request_cancel('operation-a')
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_REVIEW_STALE'):self.apply(decision)
        self.assertEqual(self.journal.operation('operation-a')['state'],'unknown')
        decision=self.decision('cancelled')
        self.apply(decision)
        self.assertEqual(self.journal.operation('operation-a')['state'],'cancelled')
        self.assertIsNone(self.journal.native_observation('operation-a')['payload'])

    def test_evidence_changes_or_unconfirmed_side_effect_review_cannot_release_queue(self):
        decision=self.decision()
        self.evidence.write_text('changed evidence',encoding='utf-8')
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_REVIEW_EVIDENCE_CHANGED'):self.apply(decision)
        for key,value in [('confirmation',''),('owned_processes_stopped',False),('external_effects_reviewed',False)]:
            decision=self.decision();decision[key]=value
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_RECONCILIATION_INVALID'):self.apply(decision)
        self.assertEqual(self.journal.operation('operation-a')['state'],'unknown')

    def test_native_reconciliation_requires_returned_valid_result_and_confirmed_exit(self):
        self.journal.native_returned('operation-a',observe_result(full_result()))
        decision={key:value for key,value in self.decision().items() if key in
                  {'schema','operation_id','review_digest','resolution_id'}} | {'method':'native_evidence'}
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_NATIVE_EVIDENCE_INSUFFICIENT'):self.apply(decision)
        self.journal.native_process_closed('operation-a')
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_REVIEW_STALE'):self.apply(decision)
        decision['review_digest']=inspect(self.config,'operation-a')['review_digest']
        self.assertEqual(self.apply(decision)['state'],'completed')
        self.assertEqual(self.apply(decision)['status'],'already_reconciled')
        self.assertEqual(inspect(self.config,'operation-a')['outcome_method'],'native_evidence')

    def test_foreign_binding_route_or_terminal_operation_cannot_be_reinterpreted(self):
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_BINDING_MISMATCH'):
            inspect({**self.config,'binding':{**BINDING,'owner_id':'other'}},'operation-a')
        decision=self.decision()
        config={**self.config,'sessions':{'session-a':{'project_id':'other','cwd':str(self.workspace.resolve())}}}
        with patch('reconciliation.verify_source',return_value=self.home):
            with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_HOME_BINDING_MISMATCH'):apply(config,decision)
        self.apply(decision)
        decision=self.decision('completed')
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_RECONCILIATION_CONFLICT'):self.apply(decision)

    def test_event_conflict_rolls_back_resolution_and_ack_changes_do_not_stale_review(self):
        decision=self.decision()
        self.journal.acknowledge(['original-unknown'])
        self.assertEqual(inspect(self.config,'operation-a')['review_digest'],decision['review_digest'])
        suffix=digest(['operation-a','synthetic-resolution'])
        self.journal.append_event({'event_id':'reconcile-'+suffix,'delivery_id':'delivery-a',
                                  'actions':[{'action':'task_state','state':'completed'}]})
        with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_EVENT_CONFLICT'):self.apply(decision)
        self.assertEqual(self.journal.operation('operation-a')['state'],'unknown')

    def test_actual_cli_inspection_and_malformed_decision_emit_only_utf8_codes(self):
        config=self.home/'runtime.json';config.write_text(encode(self.config),encoding='utf-8')
        command=[sys.executable,'-I','-S','-B',str(Path(__file__).with_name('reconcile_cli.py'))]
        actual=subprocess.run(command+['inspect','--config',str(config),'--operation','operation-a'],
                              capture_output=True,timeout=10)
        self.assertEqual(actual.returncode,0)
        self.assertEqual(actual.stderr,b'')
        self.assertEqual(json.loads(actual.stdout)['state'],'unknown')
        decision=self.home/'invalid.json';decision.write_text('{"private":"not printed"}')
        actual=subprocess.run(command+['apply','--config',str(config),'--decision',str(decision)],
                              capture_output=True,timeout=10)
        self.assertEqual(actual.returncode,2)
        self.assertEqual(actual.stderr,b'')
        self.assertEqual(json.loads(actual.stdout),{'error':'RUNTIME_RECONCILIATION_INVALID'})


if __name__=='__main__':unittest.main(verbosity=2)
