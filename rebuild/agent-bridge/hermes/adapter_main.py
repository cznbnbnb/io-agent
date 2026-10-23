"""Executable P42 adapter: bounded JSON frames, durable intake, one native owner."""
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from managed_home import ManagedHomeLease, private_json
from pinned_runtime import verify_source
from runtime_journal import RuntimeJournal, RuntimeJournalError, encode
from runtime_scheduler import RuntimeScheduler
from runtime_environment import managed_environment, require_enrollment_ready


class NativeRunner:
    def __init__(self, config, operation, child_entry=None):
        from acp_transport import HermesACPTransport
        from process_job import contained_command, host_process_job
        self.operation = operation
        source = json.loads(operation['source'])
        self.route = source['body']['route']
        self.config = config
        self.directory = Path(config['home'])/'.turboio-operations'
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.runtime_file = self.directory/(operation['operation_id']+'.runtime.json')
        self.question_file = self.directory/(operation['operation_id']+'.questions.json')
        child_config = {**config, 'operation_id': operation['operation_id'], 'session_id': self.route['session_id']}
        tools_config = {'journal': config['journal'], 'binding': config['binding'], 'operation_id': operation['operation_id']}
        for file, value in [(self.runtime_file, child_config), (self.question_file, tools_config)]:
            fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                output.write(encode(value))
                output.flush()
                os.fsync(output.fileno())
        self.transport = HermesACPTransport(command=contained_command([sys.executable, '-I', '-S', '-B', str(child_entry or Path(__file__).with_name('native_entry.py'))]),
            environment=managed_environment(os.environ, config['home'], self.runtime_file),
            home=config['home'], sessions=config['sessions'], process_job=host_process_job(), timeout=30)
        self.loaded = False
        self.close_task = None

    async def prepare(self):
        from restricted_profile import read_policy, CLI_POLICIES, WORKSPACE_POLICY
        policy=read_policy(self.config['home'])
        if policy in CLI_POLICIES:
            await self.transport.start()
            await self.transport.strict_load(self.route['session_id'],self.route['project_id'])
            if policy==WORKSPACE_POLICY:
                await self.transport.set_mode(self.route['session_id'],'accept_edits')
            self.loaded=True
            return
        from acp.schema import McpServerStdio, EnvVariable
        await self.transport.start()
        server = McpServerStdio(name='turboio_questions', command=sys.executable,
            args=['-I', '-S', '-B', str(Path(__file__).with_name('question_stdio.py')), self.config['site_packages']],
            env=[EnvVariable(name='TURBOIO_QUESTION_CONFIG', value=str(self.question_file))])
        await self.transport.strict_load(self.route['session_id'], self.route['project_id'], mcp_servers=[server])
        self.loaded = True

    async def prompt(self, text):
        return await self.transport.prompt(self.route['session_id'], self.route['project_id'], text)

    async def cancel(self):
        if self.loaded:
            await self.transport.cancel(self.route['session_id'])

    async def close(self):
        if self.close_task is None:
            self.close_task = asyncio.create_task(self.transport.close())
        await self.close_task
        for file in [self.runtime_file, self.question_file]:
            file.unlink(missing_ok=True)


async def serve(config, runner_factory=None):
    required = {'home', 'journal', 'binding', 'sessions', 'source', 'site_packages'}
    if not isinstance(config, dict) or set(config) != required or not config['sessions']:
        raise RuntimeJournalError('RUNTIME_CONFIG_INVALID')
    for field in ['home', 'journal', 'source', 'site_packages']:
        if not isinstance(config[field], str) or not Path(config[field]).is_absolute():
            raise RuntimeJournalError('RUNTIME_CONFIG_INVALID')
    verify_source(config['source'])
    require_enrollment_ready(config['home'], config['sessions'])
    packages = Path(config['site_packages']).resolve(strict=True)
    sys.path[:0] = [str(packages), str(packages/'win32'), str(packages/'win32/lib')]
    dll = os.add_dll_directory(str(packages/'pywin32_system32')) if os.name == 'nt' else None
    lease = ManagedHomeLease(config['home'], config['binding'], config['sessions'])
    journal = RuntimeJournal(config['journal'], config['binding'])
    scheduler = RuntimeScheduler(journal, config['sessions'], runner_factory or (lambda operation: NativeRunner(config, operation)), lease)
    await scheduler.start()
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.buffer.readline, 1048577)
            if not line:
                break
            if len(line) > 1048576 or not line.endswith(b'\n'):
                raise RuntimeJournalError('RUNTIME_FRAME_TOO_LARGE')
            frame = json.loads(line.decode('utf-8'))
            if not isinstance(frame, dict) or type(frame.get('id')) is not int or not isinstance(frame.get('type'), str):
                raise RuntimeJournalError('RUNTIME_FRAME_INVALID')
            kind = frame['type']
            response = {'id': frame['id'], 'ok': True}
            if kind == 'hello' and frame.get('protocol') == 1:
                response['capabilities'] = {'can_execute': True, 'async_events': True, 'graceful_shutdown': True,
                    'managed_home': True, 'original_live_wait': True, 'restart_wait_stack_recovery': False,
                    'admission_probe_v1': True, 'answer_intake_probe_v1': True}
            elif kind == 'admission_probe':
                response['admission'] = journal.inspect_admission(frame['delivery_id'], frame['source'])
            elif kind == 'answer_intake_probe':
                response['answer_intake'] = journal.inspect_answer_intake(frame['delivery_id'], frame['request'], frame['answer'])
            elif kind == 'item':
                response['actions'] = await scheduler.on_item(frame['item'], frame['delivery_id'])
            elif kind == 'answer':
                response['actions'] = await scheduler.on_answer(frame['request'], frame['answer'])
            elif kind == 'closed':
                response['actions'] = await scheduler.on_closed(frame['request'])
            elif kind == 'events':
                response['events'] = journal.events(frame['limit'])
            elif kind == 'events_ack':
                journal.acknowledge(frame['event_ids'])
            elif kind == 'shutdown':
                await scheduler.close()
            else:
                raise RuntimeJournalError('RUNTIME_FRAME_INVALID')
            encoded = encode(response)
            if len(encoded.encode('utf-8')) > 1048575:
                raise RuntimeJournalError('RUNTIME_RESPONSE_TOO_LARGE')
            # JSON-lines is always UTF-8, independent of Windows console CP936
            # or an inherited PYTHONIOENCODING. Chinese routes/body text must
            # not be replaced before authenticated answer matching.
            sys.stdout.buffer.write((encoded+'\n').encode('utf-8'))
            sys.stdout.buffer.flush()
            if kind == 'shutdown':
                break
    finally:
        await scheduler.close()
        journal.close()
        lease.close()
        if dll:
            dll.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3 or sys.argv[1] != '--config':
            raise RuntimeJournalError('RUNTIME_CONFIG_REQUIRED')
        asyncio.run(serve(private_json(sys.argv[2])))
    except Exception:
        # Never log frame bodies, paths, tokens, provider errors or tracebacks.
        raise SystemExit(2)
