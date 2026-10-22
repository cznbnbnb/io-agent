import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from adapter import ExistingCaller, stable
from context import load_context
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode
from tool import execute


class CallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='io-existing-caller-')
        self.root = Path(self.temp.name).resolve()
        self.env = patch.dict(os.environ, {'CODEX_THREAD_ID': 'test-existing-thread'})
        self.env.start()
        self.binding = dict(server_id='server-test', owner_id='owner-test', producer_id='pc-test', computer_id='pc-test', agent_id='codex-test')
        self.route = dict(computer_id='pc-test', agent_id='codex-test', project_id='project-test', session_id='test-existing-thread')
        self.deadline = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.task = 'test-original-task'
        self.op = stable('op-', self.task)
        self.config = dict(schema=1, runtime='codex', caller=dict(session_id='test-existing-thread', cwd=str(Path.cwd().resolve())),
            journal=str(self.root/'journal.sqlite'), binding=self.binding, route=self.route, task_id=self.task, operation_id=self.op)
        self.file = self.root/'context.json'
        self.file.write_text(encode(self.config), encoding='utf-8')
        self.journal = RuntimeJournal(self.config['journal'], self.binding)
        self.adapter = ExistingCaller(self.config, self.journal)
        self.source = dict(kind='task', object_id=self.task, revision=1, command_expires_at=self.deadline,
            body=dict(task_id=self.task, revision=1, route=self.route, state='queued', command='Continue the already-running registered Codex task.', allow_create_session=False))
        self.delivery = 'item:task:' + self.task + ':1'

    def tearDown(self):
        self.journal.close()
        self.env.stop()
        self.temp.cleanup()

    def admit(self):
        self.adapter.on_item(self.source, self.delivery)

    def ask(self):
        self.admit()
        args=dict(question_key='stable-key', question='Full original question?', mode='free_text', options=[], expires_at=self.deadline)
        return asyncio.run(execute('ask',args,self.file)), args

    def answer(self, reply):
        spec=json.loads(self.journal.db.execute('select spec from questions').fetchone()[0])
        request=dict(kind='request', object_id=reply['request_id'], revision=1, state='answered', expires_at=self.deadline,
            body=dict(spec, task_id=self.task, route=deepcopy(self.route), revision=1))
        request['body'].pop('expires_at')
        answer=dict(kind='answer', object_id='test-answer', revision=1, stored_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),
            body=dict(answer_id='test-answer', task_id=self.task, route=deepcopy(self.route), request_id=reply['request_id'], request_revision=1, option_id=None, text='Complete first line.\nAdditional condition: 第二行保持原样。'))
        return request,answer

    def test_admission_is_idempotent_and_does_not_dispatch_a_model(self):
        self.admit();self.admit()
        self.assertEqual(self.journal.operation(self.op)['state'],'claimed')
        self.assertEqual(self.journal.db.execute('select count(*) from operations').fetchone()[0],1)
        self.assertEqual(self.journal.inspect_admission(self.delivery,self.source)['status'],'admitted')
        self.assertIsNone(self.journal.native_observation(self.op))

    def test_unrelated_task_route_or_command_cannot_be_admitted(self):
        for key,value in [('object_id','another-task'),('revision',2)]:
            source=deepcopy(self.source);source[key]=value
            with self.assertRaises(RuntimeJournalError):self.adapter.on_item(source,self.delivery)
        source=deepcopy(self.source);source['body']['command']='run arbitrary command'
        with self.assertRaises(RuntimeJournalError):self.adapter.on_item(source,self.delivery)
        source=deepcopy(self.source);source['body']['route']['session_id']='other-thread'
        with self.assertRaises(RuntimeJournalError):self.adapter.on_item(source,self.delivery)
        self.assertEqual(self.journal.db.execute('select count(*) from operations').fetchone()[0],0)

    def test_same_key_retries_and_conflicting_question_rejected(self):
        reply,args=self.ask();again=asyncio.run(execute('ask',args,self.file));self.assertEqual(reply,again)
        args['question']='Changed text'
        with self.assertRaises(RuntimeJournalError):asyncio.run(execute('ask',args,self.file))
        self.assertEqual(self.journal.db.execute('select count(*) from questions').fetchone()[0],1)

    def test_status_is_readonly_and_only_wait_emits_resume_once(self):
        reply,_=self.ask();request,answer=self.answer(reply);self.adapter.on_answer(request,answer)
        before=(self.root/'journal.sqlite').read_bytes()
        status=asyncio.run(execute('status',{'request_id':reply['request_id']},self.file))
        self.assertEqual(status['answer']['body']['text'],answer['body']['text']);self.assertFalse(status['network_checked'])
        self.assertEqual((self.root/'journal.sqlite').read_bytes(),before)
        self.assertEqual(self.journal.db.execute('select consumed from questions').fetchone()[0],0)
        for _ in range(2):
            result=asyncio.run(execute('wait',{'request_id':reply['request_id'],'wait_seconds':0},self.file))
            self.assertEqual(result['answer']['body']['text'],answer['body']['text'])
        self.assertEqual(self.journal.db.execute('select consumed from questions').fetchone()[0],1)
        self.assertEqual(sum(e['event_id'].startswith('resume-') for e in self.journal.events()),1)

    def test_foreign_revision_route_and_answer_cannot_be_consumed(self):
        reply,_=self.ask();request,answer=self.answer(reply)
        for key,value in [('request_id','other-question'),('request_revision',2),('task_id','other-task')]:
            changed=deepcopy(answer);changed['body'][key]=value
            with self.assertRaises(RuntimeJournalError):self.adapter.on_answer(request,changed)
        changed=deepcopy(answer);changed['body']['route']['session_id']='other-thread'
        with self.assertRaises(RuntimeJournalError):self.adapter.on_answer(request,changed)
        self.assertIsNone(self.journal.reply(self.op,reply['request_id'])['answer'])

    def test_restart_preserves_original_pending_request_without_execution(self):
        reply,args=self.ask();self.journal.close();self.journal=RuntimeJournal(self.config['journal'],self.binding)
        self.adapter=ExistingCaller(self.config,self.journal);self.admit()
        self.assertEqual(asyncio.run(execute('ask',args,self.file))['request_id'],reply['request_id'])
        self.assertEqual(self.journal.operation(self.op)['state'],'claimed')
        self.assertIsNone(self.journal.native_observation(self.op))

    def test_current_thread_and_project_required_before_opening_a_journal(self):
        with patch.dict(os.environ,{'CODEX_THREAD_ID':'another-thread'}):
            with self.assertRaisesRegex(RuntimeJournalError,'CALLER_SESSION_MISMATCH'):load_context(self.file)
        changed=deepcopy(self.config);changed['caller']['cwd']=str(self.root);self.file.write_text(encode(changed),encoding='utf-8')
        with self.assertRaisesRegex(RuntimeJournalError,'CALLER_PROJECT_MISMATCH'):load_context(self.file)

    def test_cancel_request_is_not_silent_resumption_or_claimed_stop(self):
        reply,_=self.ask();self.journal.request_cancel(self.op)
        with self.assertRaisesRegex(RuntimeJournalError,'CALLER_CANCEL_REQUESTED'):asyncio.run(execute('wait',{'request_id':reply['request_id'],'wait_seconds':0},self.file))
        status=asyncio.run(execute('status',{'request_id':reply['request_id']},self.file))
        self.assertEqual(status['state'],'cancel_requested');self.assertEqual(self.journal.operation(self.op)['state'],'claimed')

    def test_cli_output_is_utf8_and_errors_do_not_disclose_input(self):
        self.ask()
        env={**os.environ,'IO_AGENT_CONTEXT':str(self.file)}
        proc=subprocess.run([sys.executable,'-I','-S','-B',str(Path(__file__).with_name('tool.py')),'ask'],input=b'{"private_secret":"DO_NOT_PRINT"}',capture_output=True,env=env,timeout=5)
        self.assertEqual(proc.returncode,2);self.assertNotIn(b'DO_NOT_PRINT',proc.stdout+proc.stderr)
        self.assertEqual(json.loads(proc.stdout)['error'],'RUNTIME_TOOL_ARGUMENT_INVALID')


if __name__=='__main__':unittest.main()
