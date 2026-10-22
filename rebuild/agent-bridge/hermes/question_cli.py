"""Operation-bound ask/wait/status CLI. JSON stdin/stdout, never shell input.

TURBOIO_QUESTION_CONFIG is assigned by the runtime host. No route, journal,
operation, answer injection, executable or credential can be supplied in JSON.
"""
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from question_tools import load_tools
from runtime_journal import RuntimeJournalError, encode

MAX_FRAME = 32768


async def execute(action, arguments, config):
    tools = load_tools(config)
    try:
        if action == 'status':
            if not isinstance(arguments, dict) or set(arguments) != {'request_id'}:
                raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
            return tools.journal.reply(tools.operation_id, arguments['request_id'])
        name = {'ask':'ask_user', 'wait':'wait_answer'}.get(action)
        if name is None:
            raise RuntimeJournalError('RUNTIME_TOOL_UNKNOWN')
        return await tools.call(name, arguments)
    finally:
        tools.journal.close()


def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in {'ask','wait','status'}:
            raise RuntimeJournalError('RUNTIME_CLI_ACTION_INVALID')
        config = os.environ.get('TURBOIO_QUESTION_CONFIG')
        if not config:
            raise RuntimeJournalError('RUNTIME_TOOL_CONFIG_REQUIRED')
        frame = sys.stdin.buffer.read(MAX_FRAME + 1)
        if len(frame) > MAX_FRAME:
            raise RuntimeJournalError('RUNTIME_CLI_FRAME_TOO_LARGE')
        arguments = json.loads(frame.decode('utf-8'))
        result = asyncio.run(execute(sys.argv[1], arguments, config))
        output = encode(result)
        if len(output.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_CLI_RESULT_TOO_LARGE')
        sys.stdout.buffer.write((output + '\n').encode('utf-8'))
        sys.stdout.buffer.flush()
        return 0
    except Exception as error:
        code = error.code if isinstance(error,RuntimeJournalError) else 'RUNTIME_CLI_FAILED'
        sys.stdout.buffer.write((encode({'error':code})+'\n').encode('utf-8'))
        sys.stdout.buffer.flush()
        return 2


if __name__=='__main__':raise SystemExit(main())
