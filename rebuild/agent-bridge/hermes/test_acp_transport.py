"""Transport negative cases using private real SQLite, no Hermes or SDK imports."""
import asyncio
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from acp_transport import HermesACPTransport, ACPTransportError


class TransportFixture:
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='io-acp-transport-')
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name).resolve()
        self.workspace = self.home / 'workspace'
        self.workspace.mkdir()
        self.database = self.home / 'state.db'
        db = sqlite3.connect(self.database)
        db.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, cwd TEXT, model_config TEXT)')
        for sid, source in [('registered', 'acp'), ('foreign-cli', 'cli')]:
            db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (sid, source, str(self.workspace), json.dumps({'cwd': str(self.workspace)})))
        db.commit()
        db.close()
        self.transport = HermesACPTransport(command=['unused-test-command'], environment={'HERMES_HOME': str(self.home)},
            home=self.home, sessions={sid: {'project_id': 'project-a', 'cwd': str(self.workspace)}
                                      for sid in ['registered', 'foreign-cli', 'missing']})

class TransportPreflightTests(TransportFixture, unittest.TestCase):
    def test_missing_and_unregistered_sessions_do_not_create_database_rows(self):
        before = self.database.read_bytes()
        for sid, code in [('missing', 'ACP_SESSION_NOT_FOUND'), ('unknown', 'ACP_SESSION_UNREGISTERED')]:
            with self.assertRaises(ACPTransportError) as caught:
                self.transport.preflight(sid, 'project-a')
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.database.read_bytes(), before)

    def test_cli_origin_cannot_be_loaded_as_acp(self):
        with self.assertRaisesRegex(ACPTransportError, '^ACP_SESSION_SOURCE_UNSUPPORTED$'):
            self.transport.preflight('foreign-cli', 'project-a')

    def test_wrong_project_is_refused_without_modifying_state(self):
        before = self.database.read_bytes()
        with self.assertRaisesRegex(ACPTransportError, '^ACP_PROJECT_MISMATCH$'):
            self.transport.preflight('registered', 'other-project')
        self.assertEqual(self.database.read_bytes(), before)

    def test_conflicting_persisted_cwd_is_not_silently_rebound(self):
        other = self.home / 'other'
        other.mkdir()
        db = sqlite3.connect(self.database)
        db.execute('UPDATE sessions SET model_config=? WHERE id=?', (json.dumps({'cwd': str(other)}), 'registered'))
        db.commit()
        db.close()
        before = self.database.read_bytes()
        with self.assertRaisesRegex(ACPTransportError, '^ACP_PROJECT_MISMATCH$'):
            self.transport.preflight('registered', 'project-a')
        self.assertEqual(self.database.read_bytes(), before)

    def test_missing_database_is_never_created_by_preflight(self):
        self.database.unlink()
        with self.assertRaisesRegex(ACPTransportError, '^ACP_STATE_UNREADABLE$'):
            self.transport.preflight('registered', 'project-a')
        self.assertFalse(self.database.exists())

    def test_readonly_database_handle_is_closed_after_success(self):
        self.transport.preflight('registered', 'project-a')
        target = self.home / 'moved.sqlite'
        self.database.rename(target)
        target.unlink()  # Windows refuses this if a SQLite connection was leaked.
        self.assertFalse(target.exists())


class TransportRPCGuards(TransportFixture, unittest.IsolatedAsyncioTestCase):
    async def test_child_exit_releases_stuck_sdk_prompt_as_unknown_without_retry(self):
        entered=asyncio.Event();stopped=asyncio.Event();calls=[]
        class Connection:
            async def prompt(self,**kwargs):
                calls.append(kwargs);entered.set()
                try:await asyncio.Event().wait()
                finally:stopped.set()
        self.transport._connection=Connection()
        self.transport._loaded.add('registered')
        self.transport.process=SimpleNamespace(returncode=None)
        modules={'acp.schema':SimpleNamespace(TextContentBlock=lambda **kwargs:kwargs)}
        with patch.dict('sys.modules',modules):
            request=asyncio.create_task(self.transport.prompt('registered','project-a','synthetic only'))
            await entered.wait()
            self.transport.process.returncode=73
            async with asyncio.timeout(1):
                with self.assertRaisesRegex(ACPTransportError,'^ACP_PROMPT_OUTCOME_UNKNOWN$'):await request
        self.assertTrue(stopped.is_set());self.assertEqual(len(calls),1)
        self.assertEqual(self.transport._active,set())

    async def test_live_model_wait_has_no_transport_timeout_and_normal_return_still_is_not_completion(self):
        entered=asyncio.Event();release=asyncio.Event()
        class Connection:
            async def prompt(self,**kwargs):
                entered.set();await release.wait()
                return SimpleNamespace(stop_reason='end_turn')
        self.transport._connection=Connection()
        self.transport._loaded.add('registered')
        self.transport.process=SimpleNamespace(returncode=None)
        self.transport.timeout=0.001
        with patch.dict('sys.modules',{'acp.schema':SimpleNamespace(TextContentBlock=lambda **kwargs:kwargs)}):
            request=asyncio.create_task(self.transport.prompt('registered','project-a','synthetic only'))
            await entered.wait();await asyncio.sleep(0.06)
            self.assertFalse(request.done());release.set();result=await request
        self.assertFalse(result['task_completed']);self.assertFalse(result['completion_verified'])
        self.assertEqual(self.transport._active,set())

    def sdk(self, job):
        calls = []
        process = SimpleNamespace(pid=12345, returncode=None)
        class Connection:
            async def initialize(self, **kwargs):
                calls.append('initialize')
                return SimpleNamespace(protocol_version=1, agent_capabilities=SimpleNamespace(load_session=True))
        class Context:
            async def __aenter__(self):
                return Connection(), process
            async def __aexit__(self, *_args):
                calls.append('sdk-close')
                process.returncode = 0
        modules = {'acp': SimpleNamespace(PROTOCOL_VERSION=1),
                   'acp.schema': SimpleNamespace(ClientCapabilities=lambda: object(), Implementation=lambda **_: object()),
                   'acp.stdio': SimpleNamespace(spawn_agent_process=lambda *_, **__: Context())}
        self.transport.process_job = job
        return calls, modules

    async def test_owned_job_is_attached_before_first_initialize_rpc_and_closed_after_sdk(self):
        calls = []
        class Job:
            def attach(self, process):
                assert rpc == [], 'initialize ran before containment'
                calls.append('attach')
            def shutdown(self):
                assert rpc[-1] == 'sdk-close', 'job closed before SDK cleanup'
                calls.append('job-close')
        rpc, modules = self.sdk(Job())
        with patch.dict('sys.modules', modules):
            await self.transport.start()
            self.assertEqual(calls, ['attach'])
            self.assertEqual(rpc, ['initialize'])
            await self.transport.close()
        self.assertEqual(calls, ['attach', 'job-close'])
        self.assertEqual(rpc, ['initialize', 'sdk-close'])

    async def test_job_assignment_failure_prevents_initialize_and_still_cleans_up(self):
        stopped = []
        class Job:
            def attach(self, process):
                raise RuntimeError('synthetic assignment refused')
            def shutdown(self):
                stopped.append(True)
        calls, modules = self.sdk(Job())
        with patch.dict('sys.modules', modules):
            with self.assertRaisesRegex(ACPTransportError, '^ACP_START_FAILED$'):
                await self.transport.start()
        self.assertEqual(calls, ['sdk-close'])
        self.assertEqual(stopped, [True])
        self.assertIsNone(self.transport._context)

    async def test_unconfirmed_descendant_shutdown_does_not_clear_transport_ownership(self):
        class Job:
            def attach(self, process):
                pass
            def shutdown(self):
                raise RuntimeError('synthetic children still alive')
        calls, modules = self.sdk(Job())
        with patch.dict('sys.modules', modules):
            await self.transport.start()
            with self.assertRaisesRegex(ACPTransportError, '^ACP_STOP_FAILED$'):
                await self.transport.close()
        self.assertIsNotNone(self.transport._context)

    async def test_close_before_start_disposes_exclusively_owned_job(self):
        stopped = []
        class Job:
            def attach(self, process):
                raise AssertionError('nothing was started')
            def shutdown(self):
                stopped.append(True)
        self.transport.process_job = Job()
        await self.transport.close()
        self.assertEqual(stopped, [True])

    async def test_prompt_requires_strict_load_before_any_rpc(self):
        with self.assertRaisesRegex(ACPTransportError, '^ACP_SESSION_NOT_LOADED$'):
            await self.transport.prompt('registered', 'project-a', 'synthetic input')

    async def test_failed_load_is_safe_and_never_marks_session_loaded(self):
        class FailingConnection:
            async def load_session(self, **_kwargs):
                raise RuntimeError('private provider details must not escape')
        self.transport._connection = FailingConnection()
        with self.assertRaisesRegex(ACPTransportError, '^ACP_LOAD_FAILED$'):
            await self.transport.strict_load('registered', 'project-a')
        self.assertEqual(self.transport._loaded, set())

    async def test_concurrent_turn_is_rejected_before_sdk_and_slash_commands_are_refused(self):
        self.transport._connection = object()
        self.transport._loaded.add('registered')
        self.transport._active.add('registered')
        with self.assertRaisesRegex(ACPTransportError, '^ACP_SESSION_BUSY$'):
            await self.transport.prompt('registered', 'project-a', 'synthetic')
        self.transport._active.clear()
        with self.assertRaisesRegex(ACPTransportError, '^ACP_PROMPT_INVALID$'):
            await self.transport.prompt('registered', 'project-a', '/reset')

    async def test_cancel_request_is_not_reported_as_cancelled(self):
        class Connection:
            async def cancel(self, session_id):
                self.cancelled_id = session_id
        self.transport._connection = Connection()
        self.transport._loaded.add('registered')
        outcome = await self.transport.cancel('registered')
        self.assertEqual(self.transport._connection.cancelled_id, 'registered')
        self.assertEqual(outcome, {'cancel_requested': True, 'cancelled': False})


if __name__ == '__main__':
    unittest.main(verbosity=2)
