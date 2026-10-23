"""Hermes ACP transport edge, using the installed official Python ACP SDK.

This is NOT an executable bridge adapter yet: no runtime outbox, original tool
waitpoint recovery or terminal task evidence is implied by an ACP turn ending.
"""
import asyncio
from pathlib import Path
import sqlite3
import json
import os
import subprocess
from contextlib import closing


class ACPTransportError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def canonical_path(value):
    return os.path.normcase(str(Path(value).resolve(strict=True)))


class HermesACPTransport:
    def __init__(self, *, command, environment, home, sessions, on_update=None, timeout=15, process_job=None):
        if (not isinstance(command, list) or not command or any(not isinstance(v, str) or not v for v in command)
                or not isinstance(environment, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in environment.items())
                or not isinstance(sessions, dict) or isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 60):
            raise ACPTransportError('ACP_CONFIG_INVALID')
        if process_job is not None and (not callable(getattr(process_job, 'attach', None)) or not callable(getattr(process_job, 'shutdown', None))):
            raise ACPTransportError('ACP_CONFIG_INVALID')
        self.process_job = process_job
        self.command = command
        self.environment = dict(environment)
        try:
            self.home = Path(home).resolve(strict=True)
            if not self.home.is_dir():
                raise ValueError()
        except Exception:
            raise ACPTransportError('ACP_CONFIG_INVALID') from None
        if self.environment.get('HERMES_HOME') != str(self.home):
            raise ACPTransportError('ACP_HOME_MISMATCH')
        self.sessions = {}
        for sid, binding in sessions.items():
            if (not isinstance(sid, str) or not sid or len(sid) > 128 or not isinstance(binding, dict)
                    or not isinstance(binding.get('project_id'), str) or not binding['project_id']):
                raise ACPTransportError('ACP_CONFIG_INVALID')
            try:
                self.sessions[sid] = {'project_id': binding['project_id'], 'cwd': canonical_path(binding['cwd'])}
            except Exception:
                raise ACPTransportError('ACP_CONFIG_INVALID') from None
        self.on_update = on_update
        self.timeout = timeout
        self._context = self._connection = self.process = None
        self._loaded = set()
        self._active = set()

    async def session_update(self, session_id, update, **_kwargs):
        if session_id not in self.sessions:
            raise ACPTransportError('ACP_ROUTE_MISMATCH')
        if self.on_update is not None:
            await self.on_update(session_id, update)

    async def request_permission(self, **_kwargs):
        # Permission UI must be wired explicitly, never silently auto-approved.
        from acp.schema import RequestPermissionResponse
        return RequestPermissionResponse(outcome={'outcome': 'cancelled'})

    async def start(self):
        if self._context is not None:
            raise ACPTransportError('ACP_ALREADY_STARTED')
        from acp import PROTOCOL_VERSION
        from acp.schema import ClientCapabilities, Implementation
        from acp.stdio import spawn_agent_process
        self._context = spawn_agent_process(self, *self.command, env=self.environment,
            transport_kwargs={'stderr': subprocess.DEVNULL, 'limit': 1048576, 'shutdown_timeout': 2})
        try:
            self._connection, self.process = await self._context.__aenter__()
            if self.process_job is not None:
                # Attach before initialize/load/prompt can cause MCP/tool child
                # creation. The job is exclusively owned by this transport.
                self.process_job.attach(self.process)
            initialized = await asyncio.wait_for(self._connection.initialize(
                protocol_version=PROTOCOL_VERSION, client_capabilities=ClientCapabilities(),
                client_info=Implementation(name='turboio-acp-transport', version='0.1')), self.timeout)
            if initialized.protocol_version != PROTOCOL_VERSION or initialized.agent_capabilities.load_session is not True:
                raise ACPTransportError('ACP_CAPABILITY_MISSING')
            return {'protocol_version': initialized.protocol_version, 'strict_load': True,
                    'task_completion_evidence': False, 'original_waitpoint_recovery': False}
        except Exception:
            await self.close()
            raise ACPTransportError('ACP_START_FAILED') from None

    def preflight(self, session_id, project_id):
        binding = self.sessions.get(session_id)
        if binding is None:
            raise ACPTransportError('ACP_SESSION_UNREGISTERED')
        if binding['project_id'] != project_id:
            raise ACPTransportError('ACP_PROJECT_MISMATCH')
        try:
            with closing(sqlite3.connect((self.home / 'state.db').as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
                row = db.execute('SELECT source,cwd,model_config FROM sessions WHERE id=?', (session_id,)).fetchone()
            if row is None:
                raise ACPTransportError('ACP_SESSION_NOT_FOUND')
            if row[0] != 'acp':
                raise ACPTransportError('ACP_SESSION_SOURCE_UNSUPPORTED')
            metadata = json.loads(row[2]) if row[2] else {}
            paths = [value for value in (row[1], metadata.get('cwd')) if value]
            if not paths or any(canonical_path(value) != binding['cwd'] for value in paths):
                raise ACPTransportError('ACP_PROJECT_MISMATCH')
        except ACPTransportError:
            raise
        except Exception:
            raise ACPTransportError('ACP_STATE_UNREADABLE') from None
        return binding

    async def strict_load(self, session_id, project_id, mcp_servers=None):
        if self._connection is None:
            raise ACPTransportError('ACP_NOT_STARTED')
        binding = self.preflight(session_id, project_id)
        if session_id in self._active:
            raise ACPTransportError('ACP_SESSION_BUSY')
        try:
            await asyncio.wait_for(self._connection.load_session(session_id=session_id,
                cwd=binding['cwd'], mcp_servers=mcp_servers or []), self.timeout)
        except Exception:
            raise ACPTransportError('ACP_LOAD_FAILED') from None
        self._loaded.add(session_id)

    async def set_mode(self, session_id, mode_id):
        # Hermes normalizes unknown ids to its ask-first default, so a missing
        # response is the only failure signal worth checking here.
        if session_id not in self._loaded:
            raise ACPTransportError('ACP_SESSION_NOT_LOADED')
        try:
            response = await asyncio.wait_for(self._connection.set_session_mode(
                mode_id=mode_id, session_id=session_id), self.timeout)
        except Exception:
            raise ACPTransportError('ACP_MODE_FAILED') from None
        if response is None:
            raise ACPTransportError('ACP_MODE_FAILED')

    async def prompt(self, session_id, project_id, text):
        self.preflight(session_id, project_id)
        if self._connection is None or session_id not in self._loaded:
            raise ACPTransportError('ACP_SESSION_NOT_LOADED')
        if session_id in self._active:
            raise ACPTransportError('ACP_SESSION_BUSY')
        if not isinstance(text, str) or not text.strip() or text.lstrip().startswith('/'):
            raise ACPTransportError('ACP_PROMPT_INVALID')
        from acp.schema import TextContentBlock
        self._active.add(session_id)
        request = exited = None
        try:
            # A model/tool wait is deliberately not a transport timeout: the
            # adapter keeps intake alive and persists this operation. The pinned
            # SDK's receive loop ends on EOF without rejecting pending requests.
            # Observe the actual owned process separately, so a dead child does
            # not leave a task looking "running" indefinitely. Never re-prompt.
            if self.process is None:
                raise ACPTransportError('ACP_NOT_STARTED')
            process = self.process
            async def process_exited():
                # asyncio Process.wait can itself await inherited pipe closure;
                # returncode is set by the OS process-exit observer independently.
                while process.returncode is None:
                    await asyncio.sleep(0.05)
            request = asyncio.create_task(self._connection.prompt(session_id=session_id,
                prompt=[TextContentBlock(type='text', text=text)]))
            exited = asyncio.create_task(process_exited())
            done, _ = await asyncio.wait({request, exited}, return_when=asyncio.FIRST_COMPLETED)
            if request not in done:
                raise ACPTransportError('ACP_PROMPT_OUTCOME_UNKNOWN')
            response = await request
            return {'stop_reason': response.stop_reason, 'task_completed': False,
                    'completion_verified': False, 'cancellation_observed': response.stop_reason == 'cancelled'}
        except Exception:
            raise ACPTransportError('ACP_PROMPT_OUTCOME_UNKNOWN') from None
        finally:
            tasks = [task for task in [request, exited] if task is not None]
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            self._active.discard(session_id)

    async def cancel(self, session_id):
        if self._connection is None or session_id not in self._loaded:
            raise ACPTransportError('ACP_SESSION_NOT_LOADED')
        await self._connection.cancel(session_id=session_id)
        return {'cancel_requested': True, 'cancelled': False}

    async def close(self):
        context = self._context
        if context is None:
            if self.process_job is not None:
                try:
                    await asyncio.to_thread(self.process_job.shutdown)
                except Exception:
                    raise ACPTransportError('ACP_STOP_FAILED') from None
            return
        failed = False
        try:
            await context.__aexit__(None, None, None)
            if self.process is not None and self.process.returncode is None:
                failed = True
        except Exception:
            failed = True
        # Confirm all descendants, not only the ACP leader. The job also
        # remains OS-owned if this Python process itself is hard-killed.
        if self.process_job is not None:
            try:
                await asyncio.to_thread(self.process_job.shutdown)
                if self.process is not None and self.process.returncode is None:
                    await asyncio.wait_for(self.process.wait(), 2)
            except Exception:
                failed = True
        if failed:
            raise ACPTransportError('ACP_STOP_FAILED') from None
        self._context = self._connection = None
        self._loaded.clear()
