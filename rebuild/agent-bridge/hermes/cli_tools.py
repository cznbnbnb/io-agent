"""Pinned Hermes native tools calling fixed CLI commands, without MCP/terminal.

The model chooses only tool arguments. Host owns executable, config, route and
session. This registry adapter is version-pinned, not a generic Hermes API claim.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from runtime_journal import encode, identifier, timestamp, RuntimeJournalError

TOOLSET = 'turboio-questions-cli'
SCHEMAS = {
 'io_ask_user': {'name':'io_ask_user','description':'Ask the user for this original task. Keep question_key and expires_at stable on retries. Then wait for its actual answer.',
  'parameters':{'type':'object','additionalProperties':False,'required':['question_key','question','mode','options','expires_at'],
   'properties':{'question_key':{'type':'string','maxLength':128},'question':{'type':'string','maxLength':4096},
    'mode':{'enum':['choice','free_text']},'options':{'type':'array','maxItems':4,'items':{'type':'object','additionalProperties':False,'required':['option_id','label'],
      'properties':{'option_id':{'type':'string'},'label':{'type':'string'}}}},'expires_at':{'type':'string','description':'UTC ISO timestamp ending Z within the next hour.'}}}},
 'io_wait_answer': {'name':'io_wait_answer','description':'Remain waiting for the actual persisted answer in this original task. The host repeats bounded CLI polls internally; wait_seconds is a poll interval, not a question deadline. operation_closed forbids continuing; expiry is not a rejection.',
  'parameters':{'type':'object','additionalProperties':False,'required':['request_id'],
   'properties':{'request_id':{'type':'string'},'wait_seconds':{'type':'number','minimum':0,'maximum':30}}}},
 'io_question_status': {'name':'io_question_status','description':'Read a question status without consuming its answer or claiming the task has resumed.',
  'parameters':{'type':'object','additionalProperties':False,'required':['request_id'],'properties':{'request_id':{'type':'string'}}}}
}
ACTIONS = {'io_ask_user':'ask','io_wait_answer':'wait','io_question_status':'status'}


def invoke(action, arguments, config, *, python=None):
    if action not in {'ask','wait','status'} or not isinstance(arguments,dict):
        raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
    payload=encode(arguments)
    if len(payload.encode('utf-8'))>32768:
        raise RuntimeJournalError('RUNTIME_CLI_FRAME_TOO_LARGE')
    command=[python or sys.executable,'-I','-S','-B',str(Path(__file__).with_name('question_cli.py')),action]
    try:
        pinned=None
        while True:
            proc=subprocess.run(command,input=payload.encode('utf-8'),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                env={**os.environ,'TURBOIO_QUESTION_CONFIG':str(config)},timeout=40,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if len(proc.stdout)>262144:
                raise ValueError()
            result=json.loads(proc.stdout.decode('utf-8'))
            if not isinstance(result,dict) or proc.returncode not in {0,2}:
                raise ValueError()
            if proc.returncode==2 and (set(result)!={'error'} or not isinstance(result['error'],str)):
                raise ValueError()
            if proc.returncode==0 and 'error' in result:
                raise ValueError()
            if action!='wait' or proc.returncode!=0:
                return encode(result)
            if set(result)!={'request_id','runtime_request_id','state','expires_at','deadline_elapsed','answer'} or result['request_id']!=arguments.get('request_id') or type(result['deadline_elapsed']) is not bool:
                raise ValueError()
            identifier(result['runtime_request_id'])
            expiry=timestamp(result['expires_at'])
            if result['state'] not in {'pending','answered','withdrawn','expired','operation_closed'}:
                raise ValueError()
            identity=(result['request_id'],result['runtime_request_id'],result['expires_at'])
            if pinned is not None and identity!=pinned:
                raise ValueError()
            pinned=identity
            if result['state']!='pending' or result['deadline_elapsed']:
                return encode(result)
            if result['answer'] is not None:
                raise ValueError()
            if time.time()>=expiry:
                raise ValueError()  # Never manufacture an expiry/answer on clock disagreement.
            # A 30-second observation timeout is not a model-visible answer or
            # expiry. Only repeat this idempotent wait, never ask/execute again.
            time.sleep(0.1)
    except Exception:
        # A timed-out ask might already be persisted. Never auto-retry here;
        # caller can retry the identical question key/spec against the ledger.
        raise RuntimeJournalError('RUNTIME_CLI_OUTCOME_UNKNOWN') from None


def register(config, session_id):
    from tools.registry import registry
    from toolsets import create_custom_toolset
    for name,schema in SCHEMAS.items():
        action=ACTIONS[name]
        def handler(arguments,session_id=None,_action=action,**kwargs):
            if session_id!=expected_session:
                return encode({'error':'RUNTIME_CLI_SESSION_MISMATCH'})
            try:return invoke(_action,arguments,config)
            except RuntimeJournalError as error:return encode({'error':error.code})
        expected_session=session_id
        registry.register(name,TOOLSET,schema,handler,max_result_size_chars=262144)
    create_custom_toolset(TOOLSET,'iO original-task ask/wait/status via fixed CLI',tools=list(SCHEMAS))
