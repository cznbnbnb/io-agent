"""Host wait survives bounded polls; provider never sees a pending poll timeout."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from unittest.mock import patch
import unittest
import time

import cli_tools
from runtime_journal import RuntimeJournalError
import test_question_cli as fixtures


class HostWaitTests(unittest.TestCase):
    setUp=fixtures.CLITests.setUp
    call=fixtures.CLITests.call
    def test_real_cli_wait_remains_blocked_across_poll_and_consumes_original_answer_once(self):
        _,asked=self.call('ask',self.spec)
        with ThreadPoolExecutor(max_workers=1) as pool:
            waiting=pool.submit(cli_tools.invoke,'wait',{'request_id':asked['request_id'],'wait_seconds':0.05},self.config)
            time.sleep(0.7)
            self.assertFalse(waiting.done(),'elapsed bounded poll must not return pending to the model')
            request={'kind':'request','object_id':asked['request_id'],'revision':1,'body':{
                'request_id':asked['request_id'],'revision':1,'task_id':'task-a','route':cli_route(),
                'runtime_request_id':asked['runtime_request_id'],'question':self.spec['question'],
                'mode':'free_text','options':[],'state':'answered'}}
            answer={'kind':'answer','object_id':'answer-host-wait','revision':1,
                'stored_at':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
                'body':{'answer_id':'answer-host-wait','request_id':asked['request_id'],'request_revision':1,'task_id':'task-a',
                        'route':cli_route(),'option_id':None,'text':'用新价格，但运费沿用上次','input_source':'voice','raw_action':None}}
            self.journal.record_answer('operation-a',request,answer)
            result=json.loads(waiting.result(timeout=8))
        self.assertEqual(result['state'],'answered');self.assertEqual(result['answer']['body']['text'],answer['body']['text'])
        stages=[a.get('stage') for e in self.journal.events() for a in e['actions']]
        self.assertEqual(stages.count('task_resumed'),1)

    def test_wait_repeats_same_frame_and_refuses_changed_request_or_deadline(self):
        future=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat().replace('+00:00','Z')
        pending={'request_id':'original','runtime_request_id':'native-original','state':'pending','expires_at':future,'deadline_elapsed':False,'answer':None}
        changed={**pending,'request_id':'other'}
        output=lambda value:SimpleNamespace(returncode=0,stdout=json.dumps(value).encode())
        with patch.object(cli_tools.subprocess,'run',side_effect=[output(pending),output(changed)]) as run,patch.object(cli_tools.time,'sleep'):
            with self.assertRaises(RuntimeJournalError):cli_tools.invoke('wait',{'request_id':'original'},self.config)
            self.assertEqual(run.call_count,2);self.assertEqual(run.call_args_list[0],run.call_args_list[1])

    def test_closed_and_expired_waits_return_without_a_new_question_or_answer(self):
        _,asked=self.call('ask',self.spec);self.journal.close_question('operation-a',asked['request_id'],'withdrawn')
        result=json.loads(cli_tools.invoke('wait',{'request_id':asked['request_id'],'wait_seconds':0},self.config))
        self.assertEqual(result['state'],'withdrawn');self.assertIsNone(result['answer']);self.assertEqual(self.journal.db.execute('SELECT count(*) FROM questions').fetchone()[0],1)


def cli_route():
    from test_runtime_journal import SOURCE
    return SOURCE['body']['route']


if __name__=='__main__':unittest.main()
