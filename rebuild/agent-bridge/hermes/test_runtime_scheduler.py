import asyncio
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from managed_home import ManagedHomeLease
from native_observer import observe_result, classify, wrap_agent
from question_tools import QuestionTools
from runtime_journal import RuntimeJournal, RuntimeJournalError
from runtime_scheduler import RuntimeScheduler, stable
from test_runtime_journal import BINDING, SOURCE


def full_result(text='Synthetic result', interrupted=False):
    return {'completed': not interrupted, 'failed': False, 'partial': False, 'interrupted': interrupted,
            'user_intervened': False, 'final_response': text}


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='io-runtime-scheduler-')
        self.home = Path(self.temp.name)
        workspace = self.home/'workspace'
        workspace.mkdir()
        self.sessions = {'session-a': {'project_id': 'project-a', 'cwd': str(workspace.resolve())}}
        (self.home/'.turboio-managed.json').write_text(json.dumps({'schema': 1, 'binding': BINDING, 'sessions': self.sessions}))
        self.lease = ManagedHomeLease(self.home, BINDING, self.sessions)
        self.journal = RuntimeJournal(self.home/'journal.sqlite', BINDING)
        self.runners = []
        self.scheduler = RuntimeScheduler(self.journal, self.sessions, self.factory, self.lease, clock=lambda: 1000)

    async def asyncTearDown(self):
        await self.scheduler.close()
        self.journal.close()
        self.lease.close()
        self.temp.cleanup()

    def source(self, task='task-a', text='hold', deadline='2030-01-01T00:00:00Z'):
        source = copy.deepcopy(SOURCE)
        source.update(object_id=task, command_expires_at=deadline, expires_at=deadline)
        source['body'].update(task_id=task, command=text, allow_create_session=False)
        return source

    async def wait(self, predicate):
        async with asyncio.timeout(3):
            while not predicate():
                await asyncio.sleep(0.01)

    def factory(self, operation):
        test = self
        class Runner:
            cancelled = False
            closed = False
            def __init__(self):
                self.operation = operation
                self.release = asyncio.Event()
                self.started = False
            async def prepare(self):
                pass
            async def prompt(self, text):
                self.started = True
                test.journal.native_started(operation['operation_id'])
                if text == 'ask':
                    tools = QuestionTools(test.journal, operation['operation_id'])
                    deadline = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp()+600, timezone.utc).isoformat().replace('+00:00','Z')
                    asked = await tools.call('ask_user', {'question_key': 'one', 'question': 'Synthetic?', 'mode': 'free_text', 'options': [], 'expires_at': deadline})
                    await tools.call('wait_answer', {'request_id': asked['request_id'], 'wait_seconds': 2})
                elif text == 'hold':
                    await self.release.wait()
                raw = full_result(None if self.cancelled else 'Synthetic result', interrupted=self.cancelled)
                if self.cancelled:
                    raw['user_intervened'] = True
                test.journal.native_returned(operation['operation_id'], observe_result(raw))
                return {'stop_reason': 'cancelled' if self.cancelled else 'end_turn', 'cancellation_observed': self.cancelled}
            async def cancel(self):
                self.cancelled = True
                self.release.set()
            async def close(self):
                self.closed = True
                self.release.set()
        runner = Runner()
        self.runners.append(runner)
        return runner

    async def submit(self, source):
        return await self.scheduler.on_item(source, 'item:task:'+source['object_id']+':'+str(source['revision']))

    async def test_busy_fifo_and_feedback_revision_do_not_execute_twice(self):
        await self.scheduler.start()
        first, second = self.source(), self.source('task-b', 'finish')
        await self.submit(first)
        await self.wait(lambda: self.runners and self.runners[0].started)
        await self.submit(second)
        feedback = copy.deepcopy(first)
        feedback['revision'] = feedback['body']['revision'] = 2
        feedback['body']['state'] = 'running'
        await self.submit(feedback)
        self.assertEqual(len(self.runners), 1)
        self.assertEqual(self.journal.operation_for_task('task-b')['state'], 'admitted')
        self.runners[0].release.set()
        await self.wait(lambda: self.journal.operation_for_task('task-b')['state'] == 'completed')
        self.assertEqual(len(self.runners), 2)
        self.assertTrue(all(r.closed for r in self.runners))
        messages = [a for e in self.journal.events() for a in e['actions'] if a['action'] == 'message']
        self.assertEqual(len(messages), 2)

    async def test_answer_routes_to_wait_and_resume_precedes_completion(self):
        await self.scheduler.start()
        await self.submit(self.source(text='ask'))
        await self.wait(lambda: any(a['action'] == 'request' for e in self.journal.events() for a in e['actions']))
        action = next(a for e in self.journal.events() for a in e['actions'] if a['action'] == 'request')
        request = {'kind': 'request', 'object_id': action['request_id'], 'revision': 1, 'state': 'answered',
            'body': {'request_id': action['request_id'], 'revision': 1, 'task_id': 'task-a', 'route': SOURCE['body']['route'],
                     **{key: action[key] for key in ['question','mode','options','runtime_request_id']}}}
        answer = {'kind': 'answer', 'object_id': 'answer-a', 'revision': 1, 'stored_at': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
            'body': {'answer_id': 'answer-a', 'request_id': action['request_id'], 'request_revision': 1, 'task_id': 'task-a',
                     'route': SOURCE['body']['route'], 'option_id': None, 'text': 'Synthetic answer'}}
        intake = await self.scheduler.on_answer(request, answer)
        self.assertEqual(intake[0]['subject_kind'], 'answer')
        self.assertFalse(any(a.get('stage') == 'task_resumed' for e in self.journal.events() for a in e['actions']))
        await self.wait(lambda: self.journal.operation_for_task('task-a')['state'] == 'completed')
        stages = [a.get('stage') for e in self.journal.events() for a in e['actions']]
        self.assertLess(stages.index('task_resumed'), stages.index('task_completed'))
        self.assertEqual(len(self.runners), 1)

    async def test_native_end_turn_with_unanswered_question_never_emits_task_completed(self):
        await self.scheduler.start()
        await self.submit(self.source(text='ask'))
        await self.wait(lambda:self.journal.operation_for_task('task-a')['state']=='unknown')
        actions=[a for e in self.journal.events() for a in e['actions']]
        self.assertFalse(any(a.get('stage')=='task_completed' or a.get('channel')=='result' for a in actions))
        self.assertTrue(any(a.get('state')=='execution_unknown' for a in actions))
        operation=self.journal.operation_for_task('task-a')
        self.assertTrue(self.journal.has_unsettled_questions(operation['operation_id']))

    async def test_queued_cancel_does_not_start_second_task(self):
        await self.scheduler.start()
        await self.submit(self.source())
        await self.wait(lambda: self.runners and self.runners[0].started)
        second = self.source('task-b')
        await self.submit(second)
        second['revision'] = second['body']['revision'] = 2
        second['body']['state'] = 'cancel_requested'
        await self.submit(second)
        self.assertEqual(self.journal.operation_for_task('task-b')['state'], 'cancelled')
        self.assertEqual(len(self.runners), 1)

    async def test_active_cancel_requires_native_interrupt_and_closed_runner(self):
        await self.scheduler.start()
        source = self.source()
        await self.submit(source)
        await self.wait(lambda: self.runners and self.runners[0].started)
        source['revision'] = source['body']['revision'] = 2
        source['body']['state'] = 'cancel_requested'
        await self.submit(source)
        await self.wait(lambda: self.journal.operation_for_task('task-a')['state'] == 'cancelled')
        self.assertTrue(self.runners[0].closed)
        self.assertTrue(self.journal.cancellation_requested(self.runners[0].operation['operation_id']))

    async def test_restart_claim_without_exit_proof_becomes_unknown_and_blocks_queue(self):
        source = self.source()
        self.journal.admit('old-operation', 'old-delivery', source, {'text': 'hold'})
        self.journal.claim('old-operation')
        self.journal.native_started('old-operation')
        self.journal.native_returned('old-operation', observe_result(full_result()))
        await self.scheduler.start()
        await self.submit(self.source('task-b'))
        await asyncio.sleep(0.12)
        self.assertEqual(self.journal.operation('old-operation')['state'], 'unknown')
        self.assertEqual(self.runners, [])
        self.assertEqual(self.journal.operation_for_task('task-b')['state'], 'admitted')

    async def test_expired_and_missing_original_deadline_never_prompt(self):
        await self.scheduler.start()
        await self.submit(self.source(deadline='1970-01-01T00:00:01Z'))
        missing = self.source('task-b')
        del missing['command_expires_at']
        await self.submit(missing)
        await self.wait(lambda: self.journal.operation_for_task('task-b')['state'] == 'failed')
        self.assertEqual(self.journal.operation_for_task('task-a')['state'], 'expired')
        self.assertEqual(self.runners, [])

    async def test_unregistered_or_rewritten_existing_session_is_refused(self):
        source = self.source()
        source['body']['route']['session_id'] = 'missing'
        with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_SESSION_UNREGISTERED'):
            await self.submit(source)
        self.assertEqual(self.journal.operations_in_state('admitted'), [])
        await self.submit(self.source())
        source = self.source(text='changed')
        with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_OPERATION_CONFLICT'):
            await self.submit(source)


class EvidenceTests(unittest.TestCase):
    def test_interrupted_null_text_needs_cancel_response_and_closed_process(self):
        raw = {**full_result(None, interrupted=True), 'user_intervened': True}
        observation = {'state': 'returned', 'process_closed': 1, 'payload': observe_result(raw)}
        self.assertTrue(observation['payload']['valid'])
        self.assertIsNone(observation['payload']['text'])
        self.assertEqual(classify(observation, True, True), 'cancelled')
        for requested, observed in [(False, False), (True, False), (False, True)]:
            self.assertEqual(classify(observation, requested, observed), 'unknown')
        self.assertEqual(classify({**observation, 'process_closed': 0}, True, True), 'unknown')
        for invalid in [full_result(None), {**raw, 'interrupted': False}, {**raw, 'completed': True},
                        {**raw, 'partial': None}, {**raw, 'final_response': {'text': 'invalid'}}]:
            self.assertFalse(observe_result(invalid)['valid'])

    def test_native_wrapper_refuses_a_different_prompt_before_engine_side_effects(self):
        with tempfile.TemporaryDirectory() as temporary:
            journal = RuntimeJournal(Path(temporary)/'journal.sqlite', BINDING)
            try:
                journal.admit('op-one','delivery-one',SOURCE,{'text':'expected'})
                journal.claim('op-one')
                class Agent:
                    called = False
                    def run_conversation(self, user_message):
                        self.called = True
                        return full_result()
                agent = wrap_agent(Agent(),journal,'op-one')
                with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_PROMPT_MISMATCH'):
                    agent.run_conversation('different')
                self.assertFalse(agent.called)
                self.assertIsNone(journal.native_observation('op-one'))
            finally:
                journal.close()

    def test_real_process_home_owner_crash_releases_lock_without_deleting_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            (home/'.turboio-managed.json').write_text(json.dumps({'schema':1,'binding':BINDING,'sessions':{}}))
            code = "import sys,json; sys.path.insert(0,sys.argv[1]); from managed_home import ManagedHomeLease; lease=ManagedHomeLease(sys.argv[2],json.loads(sys.argv[3]),{}); print('ready',flush=True); sys.stdin.read()"
            child = subprocess.Popen([sys.executable,'-I','-S','-B','-c',code,str(Path(__file__).parent),str(home),json.dumps(BINDING)],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform=='win32' else 0)
            try:
                self.assertEqual(child.stdout.readline().strip(),'ready')
                with self.assertRaisesRegex(RuntimeJournalError,'RUNTIME_HOME_IN_USE'):
                    ManagedHomeLease(home,BINDING,{})
                lock=home/'.turboio-owner.sqlite'
                before=lock.stat().st_ino
                child.kill();child.wait(timeout=5)
                successor=ManagedHomeLease(home,BINDING,{})
                try:
                    self.assertEqual(lock.stat().st_ino,before)
                finally:
                    successor.close()
            finally:
                if child.poll() is None:
                    child.kill();child.wait(timeout=5)
                child.stdin.close();child.stdout.close()

    def test_acp_end_turn_or_incomplete_engine_flags_never_prove_completion(self):
        for raw in [{'final_response': 'looks successful'}, {**full_result(), 'partial': True},
                    {**full_result(), 'cleanup_errors': ['private error']}, {**full_result(), 'user_intervened': True}]:
            self.assertEqual(classify({'state': 'returned', 'process_closed': 1, 'payload': observe_result(raw)}), 'unknown')
        good = {'state': 'returned', 'process_closed': 0, 'payload': observe_result(full_result())}
        self.assertEqual(classify(good), 'unknown')
        good['process_closed'] = 1
        self.assertEqual(classify(good), 'completed')

    def test_managed_home_needs_enrollment_and_excludes_other_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                ManagedHomeLease(home, BINDING, {})
            marker = {'schema': 1, 'binding': BINDING, 'sessions': {}}
            (home/'.turboio-managed.json').write_text(json.dumps(marker))
            first = ManagedHomeLease(home, BINDING, {})
            try:
                with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_HOME_IN_USE'):
                    ManagedHomeLease(home, BINDING, {})
                with self.assertRaisesRegex(RuntimeJournalError, 'RUNTIME_HOME_BINDING_MISMATCH'):
                    ManagedHomeLease(home, {**BINDING, 'agent_id': 'other'}, {})
            finally:
                first.close()
            successor = ManagedHomeLease(home, BINDING, {})
            successor.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
