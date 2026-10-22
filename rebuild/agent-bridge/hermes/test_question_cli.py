"""Actual CLI subprocesses sharing a durable ledger, no model or network."""
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from runtime_journal import RuntimeJournal
from test_runtime_journal import BINDING,SOURCE,EVENT


class CLITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='io-question-cli-')
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)
        self.journal=RuntimeJournal(self.home/'journal.sqlite',BINDING)
        self.addCleanup(self.journal.close)
        self.journal.admit('operation-a',EVENT['delivery_id'],SOURCE,{'text':'synthetic'})
        self.journal.claim('operation-a')
        self.config=self.home/'config.json'
        self.config.write_text(json.dumps({'journal':str(self.home/'journal.sqlite'),
            'binding':BINDING,'operation_id':'operation-a'}),encoding='utf-8')
        self.spec={'question_key':'cli-test','question':'中文问题与表情🙂，请保留附加条件。','mode':'free_text','options':[],
            'expires_at':(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat().replace('+00:00','Z')}

    def call(self,action,arguments,config=None,raw=None):
        proc=subprocess.run([sys.executable,'-I','-S','-B','-X','utf8=0',str(Path(__file__).with_name('question_cli.py')),action],
            input=raw if raw is not None else json.dumps(arguments).encode('utf-8'),
            capture_output=True,timeout=10,env={**os.environ,'TURBOIO_QUESTION_CONFIG':str(config or self.config),
                                            'PYTHONIOENCODING':'cp936'},
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.assertEqual(proc.stderr,b'')
        return proc.returncode,json.loads(proc.stdout)

    def test_ask_replay_survives_process_exit_without_duplicate_question(self):
        code,first=self.call('ask',self.spec);self.assertEqual(code,0)
        code,second=self.call('ask',self.spec);self.assertEqual(code,0)
        self.assertEqual(first,second)
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM questions').fetchone()[0],1)
        self.assertEqual(len(self.journal.events()),1)

    def test_status_does_not_resume_wait_consumes_once(self):
        _,asked=self.call('ask',self.spec);request_id=asked['request_id']
        _,pending=self.call('wait',{'request_id':request_id,'wait_seconds':0})
        self.assertEqual(pending['state'],'pending')
        route=SOURCE['body']['route']
        request={'kind':'request','object_id':request_id,'revision':1,'body':{
            'request_id':request_id,'revision':1,'task_id':'task-a','route':route,
            'runtime_request_id':asked['runtime_request_id'],'question':self.spec['question'],
            'mode':'free_text','options':[],'state':'answered'}}
        answer={'kind':'answer','object_id':'synthetic-answer','revision':1,
            'stored_at':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
            'body':{'answer_id':'synthetic-answer','request_id':request_id,'request_revision':1,
                    'task_id':'task-a','route':route,'option_id':None,'text':'中文附加条件🙂：只允许测试。',
                    'input_source':'phone','raw_action':None}}
        self.journal.record_answer('operation-a',request,answer)
        before=len(self.journal.events())
        code,status=self.call('status',{'request_id':request_id});self.assertEqual(code,0)
        self.assertEqual(status['state'],'answered');self.assertEqual(len(self.journal.events()),before)
        code,reply=self.call('wait',{'request_id':request_id,'wait_seconds':0});self.assertEqual(code,0)
        self.assertEqual(reply['answer']['body']['text'],'中文附加条件🙂：只允许测试。')
        self.assertEqual(len(self.journal.events()),before+1)
        self.call('wait',{'request_id':request_id,'wait_seconds':0})
        self.assertEqual(len(self.journal.events()),before+1)

    def test_other_operation_cannot_read_or_consume_question(self):
        _,asked=self.call('ask',self.spec)
        self.journal.admit('operation-b','item:task:task-a:2',SOURCE,{'text':'other synthetic'})
        self.journal.claim('operation-b')
        other=self.home/'other.json';other.write_text(json.dumps({'journal':str(self.home/'journal.sqlite'),
            'binding':BINDING,'operation_id':'operation-b'}),encoding='utf-8')
        for action in ['wait','status']:
            code,reply=self.call(action,{'request_id':asked['request_id']},config=other)
            self.assertEqual(code,2);self.assertEqual(reply,{'error':'RUNTIME_QUESTION_UNKNOWN'})

    def test_model_cannot_choose_journal_route_or_inject_answer(self):
        for field in ['journal','route','operation_id','answer']:
            code,reply=self.call('ask',{**self.spec,field:'synthetic-private-data'})
            self.assertEqual(code,2);self.assertEqual(reply,{'error':'RUNTIME_TOOL_ARGUMENT_INVALID'})
        self.assertEqual(self.journal.events(),[])

    def test_malformed_or_oversized_input_and_action_return_codes_only(self):
        for action,raw in [('ask',b'private-non-json'),('ask',b'x'*32769),('execute',b'{}')]:
            code,reply=self.call(action,None,raw=raw)
            self.assertEqual(code,2);self.assertEqual(set(reply),{'error'})
            self.assertNotIn('private',json.dumps(reply))
        self.assertEqual(self.journal.events(),[])


if __name__=='__main__':unittest.main()
