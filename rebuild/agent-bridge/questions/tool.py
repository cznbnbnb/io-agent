"""Runtime-neutral question operations, bound by the host's caller registration."""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from context import load_context, operation
from runtime_journal import RuntimeJournalError, encode
from question_tools import QuestionTools


async def execute(action, arguments, file):
    config, journal = load_context(file, readonly=action == 'status')
    try:
        operation(config, journal, allow_cancel_requested=action == 'status')
        if action == 'status':
            if not isinstance(arguments, dict) or set(arguments) != {'request_id'}:
                raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
            result = journal.reply(config['operation_id'], arguments['request_id'])
            if journal.cancellation_requested(config['operation_id']):
                result['state'] = 'cancel_requested'
            return {**result, 'network_checked': False, 'caller_verified': True}
        name = {'ask': 'ask_user', 'wait': 'wait_answer'}.get(action)
        if name is None:
            raise RuntimeJournalError('RUNTIME_TOOL_UNKNOWN')
        return await QuestionTools(journal, config['operation_id']).call(name, arguments)
    finally:
        journal.close()


def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in {'ask', 'wait', 'status'}:
            raise RuntimeJournalError('RUNTIME_CLI_ACTION_INVALID')
        file = os.environ.get('IO_AGENT_CONTEXT')
        if not file:
            raise RuntimeJournalError('CALLER_CONTEXT_REQUIRED')
        data = sys.stdin.buffer.read(32769)
        if len(data) > 32768:
            raise RuntimeJournalError('RUNTIME_CLI_FRAME_TOO_LARGE')
        def pairs(items):
            out = {}
            for key, value in items:
                if key in out:
                    raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
                out[key] = value
            return out
        arguments = json.loads(data.decode('utf-8'), object_pairs_hook=pairs)
        result = asyncio.run(execute(sys.argv[1], arguments, file))
        sys.stdout.buffer.write((encode(result) + '\n').encode('utf-8'))
        return 0
    except Exception as failure:
        code = failure.code if isinstance(failure, RuntimeJournalError) else 'RUNTIME_CLI_FAILED'
        sys.stdout.buffer.write((encode({'error': code}) + '\n').encode('utf-8'))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
