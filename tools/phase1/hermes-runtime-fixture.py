"""Test-only managed runtime. Real ACP/MCP; synthetic model, no provider calls."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import threading
import time

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'rebuild/agent-bridge/hermes'))
from managed_home import private_json


class SyntheticAgent:
    model = 'synthetic-no-provider'
    enabled_toolsets = []
    disabled_toolsets = []

    def __init__(self):
        self._interrupt = threading.Event()

    def interrupt(self, *_args, **_kwargs):
        self._interrupt.set()

    def run_conversation(self, user_message, conversation_history=None, **_kwargs):
        config = private_json(os.environ['TURBOIO_RUNTIME_CONFIG'])
        home, session_id = Path(config['home']), config['session_id']
        assert (home/'.turboio-runtime-synthetic').read_text() == 'synthetic-only'
        assert user_message in {'SYNTHETIC_ASK_THEN_WAIT', 'SYNTHETIC_WAIT_FOR_EXPIRY', 'SYNTHETIC_FINISH_AFTER_BUSY', 'SYNTHETIC_WAIT_FOR_CANCEL', 'SYNTHETIC_CRASH_WITHOUT_RESULT'}
        with (home/'synthetic-prompts.ndjson').open('a', encoding='utf-8') as output:
            output.write(json.dumps({'session_id': session_id, 'text': user_message})+'\n')
        if user_message == 'SYNTHETIC_CRASH_WITHOUT_RESULT':
            # Actual owned ACP child exits after native_started, without a
            # returned engine envelope. Only synthetic isolated test homes.
            os._exit(73)
        text = 'Synthetic second queued task completed'
        if user_message in {'SYNTHETIC_ASK_THEN_WAIT', 'SYNTHETIC_WAIT_FOR_EXPIRY'}:
            from model_tools import get_tool_definitions, handle_function_call
            catalog = {item['function']['name'] for item in get_tool_definitions(enabled_toolsets=self.enabled_toolsets,
                disabled_toolsets=self.disabled_toolsets, quiet_mode=True, skip_tool_search_assembly=True)}
            selected = {suffix: [name for name in catalog if name.endswith('_'+suffix)] for suffix in ['ask_user','wait_answer']}
            assert all(len(names) == 1 for names in selected.values()), 'ACTUAL_MCP_TOOLS_MISSING'
            direct = all(names[0] in self.valid_tool_names for names in selected.values())
            assert direct or 'tool_call' in self.valid_tool_names, 'NO_GRANTED_DISPATCH'
            def call(suffix, arguments):
                name = selected[suffix][0]
                raw = handle_function_call(name if direct else 'tool_call', arguments if direct else {'name': name, 'arguments': arguments},
                    session_id=session_id, enabled_toolsets=self.enabled_toolsets, disabled_toolsets=self.disabled_toolsets)
                result = json.loads(raw) if isinstance(raw, str) else raw
                assert 'error' not in result, 'REGISTERED_TOOL_FAILED'
                value = result.get('result')
                return json.loads(value) if isinstance(value, str) else value
            expiring = user_message == 'SYNTHETIC_WAIT_FOR_EXPIRY'
            asked = call('ask_user', {'question_key':'synthetic-expiring' if expiring else 'synthetic-one', 'question':'合成问题🙂：是否保留中文附加条件？',
                'mode':'free_text', 'options':[], 'expires_at':(datetime.now(timezone.utc)+(timedelta(seconds=3) if expiring else timedelta(minutes=5))).isoformat().replace('+00:00','Z')})
            received = call('wait_answer', {'request_id':asked['request_id'], 'wait_seconds':30})
            if expiring:
                # Local deadline_elapsed is not proof of rejection. Keep the
                # same question until the authenticated adapter closes it.
                limit = time.monotonic()+10
                while received['state'] == 'pending' and time.monotonic() < limit:
                    time.sleep(0.05)
                    received = call('wait_answer', {'request_id':asked['request_id'], 'wait_seconds':1})
                assert received['state'] == 'expired' and received['answer'] is None
                text = 'Synthetic question expired without an answer'
                (home/'synthetic-expiry.json').write_text(json.dumps({'request_id':asked['request_id'], 'state':received['state'],
                    'answer_present':received['answer'] is not None}), encoding='utf-8')
                history = list(conversation_history or []) + [{'role':'user','content':user_message}, {'role':'assistant','content':text}]
                return {'completed':True, 'failed':False, 'partial':False, 'interrupted':False,
                        'user_intervened':False, 'final_response':text, 'messages':history}
            assert received['state'] == 'answered'
            assert received['answer']['body']['text'] == 'Synthetic bridge response only'
            text = 'Synthetic original task continued after its answer，中文🙂'
            (home/'synthetic-continuation.json').write_text(json.dumps({'session_id':session_id, 'request_id':asked['request_id'],
                'runtime_request_id':asked['runtime_request_id'], 'answer_id':received['answer']['answer_id']}), encoding='utf-8')
        elif user_message == 'SYNTHETIC_WAIT_FOR_CANCEL':
            until = time.monotonic()+30
            while not self._interrupt.is_set() and time.monotonic() < until:
                time.sleep(0.02)
            assert self._interrupt.is_set(), 'CANCEL_NOT_OBSERVED'
            text = 'Synthetic cancellation observed'
        interrupted = self._interrupt.is_set()
        history = list(conversation_history or []) + [{'role':'user','content':user_message}, {'role':'assistant','content':text}]
        return {'completed':not interrupted, 'failed':False, 'partial':False, 'interrupted':interrupted,
                'user_intervened':False, 'final_response':text, 'messages':history}


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'native'
    if mode == 'native':
        config = private_json(os.environ['TURBOIO_RUNTIME_CONFIG'])
        assert (Path(config['home'])/'.turboio-runtime-synthetic').read_text() == 'synthetic-only'
        from native_entry import serve_native
        serve_native(config, agent_factory=SyntheticAgent, deny_network=True)
    else:
        config = private_json(sys.argv[2])
        home, packages = Path(config['home']), Path(config['site_packages'])
        assert (home/'.turboio-runtime-synthetic').read_text() == 'synthetic-only'
        if mode == 'prepare':
            os.environ['HERMES_HOME'] = str(home)
            sys.path[:0] = [config['source'], str(packages)]
            from hermes_state import SessionDB
            db = SessionDB(home/'state.db')
            try:
                for session_id, registration in config['sessions'].items():
                    db.create_session(session_id=session_id, source='acp', cwd=registration['cwd'], model_config={'cwd':registration['cwd']})
            finally:
                db.close()
        elif mode == 'adapter':
            from adapter_main import serve, NativeRunner
            asyncio.run(serve(config, runner_factory=lambda operation: NativeRunner(config, operation, child_entry=Path(__file__).resolve())))
        else:
            raise SystemExit('SYNTHETIC_MODE_INVALID')
