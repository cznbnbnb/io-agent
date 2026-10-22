"""Operation-scoped MCP stdio tools. No model, answer injection or execution API."""
import asyncio
import json
import math
import os
from pathlib import Path
import stat
import time

from runtime_journal import RuntimeJournal, RuntimeJournalError, encode


class QuestionTools:
    def __init__(self, journal, operation_id):
        self.journal = journal
        self.operation_id = operation_id
        operation = journal.operation(operation_id)
        if operation is None or operation['state'] != 'claimed':
            raise RuntimeJournalError('RUNTIME_OPERATION_NOT_ACTIVE')

    async def call(self, name, arguments):
        if not isinstance(arguments, dict):
            raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
        if name == 'ask_user':
            required = {'question_key', 'question', 'mode', 'options', 'expires_at'}
            if set(arguments) != required:
                raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
            return self.journal.ask(self.operation_id, **arguments)
        if name == 'wait_answer':
            if set(arguments) - {'request_id', 'wait_seconds'} or 'request_id' not in arguments:
                raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
            seconds = arguments.get('wait_seconds', 30)
            if type(seconds) not in {int, float} or not math.isfinite(seconds) or not 0 <= seconds <= 30:
                raise RuntimeJournalError('RUNTIME_TOOL_ARGUMENT_INVALID')
            until = time.monotonic() + seconds
            while True:
                reply = self.journal.reply(self.operation_id, arguments['request_id'])
                if reply['state'] == 'answered':
                    return self.journal.consume_answer(self.operation_id, arguments['request_id'])
                if reply['state'] != 'pending' or reply['deadline_elapsed'] or time.monotonic() >= until:
                    return reply
                # Cancellation only releases this wait call; it does not erase
                # the persisted question or pretend the original task stopped.
                await asyncio.sleep(min(0.1, max(0, until - time.monotonic())))
        raise RuntimeJournalError('RUNTIME_TOOL_UNKNOWN')


def load_tools(config_file):
    path = Path(config_file)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 8192:
        raise RuntimeJournalError('RUNTIME_TOOL_CONFIG_INVALID')
    config = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(config, dict) or set(config) != {'journal', 'binding', 'operation_id'} or not Path(config['journal']).is_absolute() or not Path(config['journal']).is_file():
        raise RuntimeJournalError('RUNTIME_TOOL_CONFIG_INVALID')
    journal = RuntimeJournal(config['journal'], config['binding'])
    try:
        return QuestionTools(journal, config['operation_id'])
    except BaseException:
        journal.close()
        raise


async def serve(tools):
    import mcp_types as types
    from mcp.server.lowlevel import Server
    from mcp.server.stdio import stdio_server

    async def list_tools(ctx, params):
        return types.ListToolsResult(tools=[
            types.Tool(name='ask_user', description='Persist a question for this operation only. Use a stable question_key and unchanged expires_at when retrying. Pending is not an answer or cloud-storage acknowledgement.',
                       input_schema={'type': 'object', 'additionalProperties': False,
                                    'required': ['question_key', 'question', 'mode', 'options', 'expires_at'],
                                    'properties': {'question_key': {'type': 'string', 'maxLength': 128},
                                                   'question': {'type': 'string', 'maxLength': 4096},
                                                   'mode': {'enum': ['choice', 'free_text']},
                                                   'options': {'type': 'array', 'maxItems': 4, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['option_id', 'label'], 'properties': {'option_id': {'type': 'string'}, 'label': {'type': 'string'}}}},
                                                   'expires_at': {'type': 'string', 'description': 'UTC ISO timestamp ending Z, within the next hour.'}}}),
            types.Tool(name='wait_answer', description='Wait up to 30 seconds for a persisted answer to this operation. Repeat with the same request_id while pending. deadline_elapsed requires adapter reconciliation; do not infer user rejection or repeat execution. operation_closed forbids continuing execution.',
                       input_schema={'type': 'object', 'additionalProperties': False, 'required': ['request_id'],
                                    'properties': {'request_id': {'type': 'string'}, 'wait_seconds': {'type': 'number', 'minimum': 0, 'maximum': 30}}})])

    async def call_tool(ctx, params):
        try:
            result = await tools.call(params.name, params.arguments or {})
            return types.CallToolResult(content=[types.TextContent(type='text', text=encode(result))])
        except RuntimeJournalError as error:
            return types.CallToolResult(content=[types.TextContent(type='text', text=encode({'error': error.code}))], is_error=True)
        except Exception:
            # Do not return DB paths, configuration, provider errors or traces.
            return types.CallToolResult(content=[types.TextContent(type='text', text='{"error":"RUNTIME_TOOL_FAILED"}')], is_error=True)

    server = Server('turboio-questions', on_list_tools=list_tools, on_call_tool=call_tool)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


def main():
    tools = None
    try:
        tools = load_tools(os.environ['TURBOIO_QUESTION_CONFIG'])
        asyncio.run(serve(tools))
        return 0
    except Exception:
        # Protocol stdout and incidental stderr carry no private config.
        return 2
    finally:
        if tools is not None:
            tools.journal.close()


if __name__ == '__main__':
    raise SystemExit(main())
