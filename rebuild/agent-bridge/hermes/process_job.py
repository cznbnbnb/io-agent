"""Windows-owned child process tree; closing/crashing owner kills descendants.

This is containment, not a session lease or proof of task completion. Only attach
children created by this runtime, before loading tools or submitting a prompt.
"""
import ctypes
import asyncio
from ctypes import wintypes
import os
from pathlib import Path
import signal
import time
import subprocess


class ProcessJobError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class WindowsProcessJob:
    def __init__(self):
        self.handle = None
        if os.name != 'nt':
            raise ProcessJobError('RUNTIME_JOB_UNSUPPORTED')
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p]
        self.kernel.QueryInformationJobObject.restype = wintypes.BOOL
        self.kernel.GetCurrentProcess.restype = wintypes.HANDLE
        self.kernel.DuplicateHandle.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
                                               ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.DuplicateHandle.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.TerminateJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL

        class BasicLimit(ctypes.Structure):
            _fields_ = [('per_process_time', ctypes.c_longlong), ('per_job_time', ctypes.c_longlong),
                        ('flags', wintypes.DWORD), ('minimum_working_set', ctypes.c_size_t),
                        ('maximum_working_set', ctypes.c_size_t), ('active_process_limit', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority_class', wintypes.DWORD), ('scheduling_class', wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ['reads', 'writes', 'others', 'read_bytes', 'write_bytes', 'other_bytes']]
        class ExtendedLimit(ctypes.Structure):
            _fields_ = [('basic', BasicLimit), ('io', IO), ('process_memory', ctypes.c_size_t),
                        ('job_memory', ctypes.c_size_t), ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ProcessJobError('RUNTIME_JOB_CREATE_FAILED')
        limit = ExtendedLimit()
        limit.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no BREAKAWAY_OK.
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limit), ctypes.sizeof(limit)):
            self.kernel.CloseHandle(self.handle)
            self.handle = None
            raise ProcessJobError('RUNTIME_JOB_CONFIG_FAILED')

    def attach(self, process):
        """Accept a subprocess handle, never an arbitrary PID from model input."""
        if self.handle is None:
            raise ProcessJobError('RUNTIME_JOB_CLOSED')
        # Use the handle belonging to our Popen instance, not OpenProcess(pid):
        # a child can exit and its PID can be reused by an unrelated process.
        child = process
        if isinstance(process, asyncio.subprocess.Process):
            child = process._transport.get_extra_info('subprocess')
        if not isinstance(child, subprocess.Popen) or child.pid == os.getpid():
            raise ProcessJobError('RUNTIME_JOB_PROCESS_INVALID')
        if child.poll() is not None or not getattr(child, '_handle', None):
            raise ProcessJobError('RUNTIME_JOB_PROCESS_UNAVAILABLE')
        handle = wintypes.HANDLE()
        current = self.kernel.GetCurrentProcess()
        if not self.kernel.DuplicateHandle(current, int(child._handle), current, ctypes.byref(handle), 0, False, 2):
            raise ProcessJobError('RUNTIME_JOB_PROCESS_UNAVAILABLE')
        try:
            if not self.kernel.AssignProcessToJobObject(self.handle, handle):
                raise ProcessJobError('RUNTIME_JOB_ASSIGN_FAILED')
        finally:
            self.kernel.CloseHandle(handle)

    def active_count(self):
        if self.handle is None:
            raise ProcessJobError('RUNTIME_JOB_CLOSED')
        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_longlong) for name in ['user', 'kernel', 'period_user', 'period_kernel']] + [
                (name, wintypes.DWORD) for name in ['page_faults', 'total_processes', 'active_processes', 'terminated_processes']]
        accounting = Accounting()
        if not self.kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
            raise ProcessJobError('RUNTIME_JOB_QUERY_FAILED')
        return accounting.active_processes

    def shutdown(self, timeout=5):
        """Do not release ownership based on a kill request alone."""
        if self.handle is None:
            return
        if type(timeout) not in {int, float} or not 0 < timeout <= 30:
            raise ProcessJobError('RUNTIME_JOB_TIMEOUT_INVALID')
        if not self.kernel.TerminateJobObject(self.handle, 74):
            raise ProcessJobError('RUNTIME_JOB_TERMINATE_FAILED')
        until = time.monotonic() + timeout
        while self.active_count():
            if time.monotonic() >= until:
                # Keep handle owned; do not pretend children exited.
                raise ProcessJobError('RUNTIME_JOB_DESCENDANTS_ALIVE')
            time.sleep(0.02)
        self.kernel.CloseHandle(self.handle)
        self.handle = None


class PosixProcessJob:
    """POSIX stand-in for the Windows job: the ACP leader runs as a session leader
    (see session_exec.py) and membership is its session plus every process still
    linked to it by parentage, so tools that call setsid stay tracked while their
    parent lives. Every member ever seen is remembered until confirmed gone.

    Weaker than a job object: nothing kills the tree if this owner is hard-killed,
    and a process orphaned outside the session before shutdown can escape."""
    def __init__(self):
        if os.name == 'nt':
            raise ProcessJobError('RUNTIME_JOB_UNSUPPORTED')
        self.leader = None
        self.known = set()
        self.closed = False

    @staticmethod
    def _table():
        try:
            out = subprocess.run(['ps', '-A', '-o', 'pid=,ppid=,stat='], capture_output=True, check=True,
                                 text=True, timeout=10).stdout
        except Exception:
            raise ProcessJobError('RUNTIME_JOB_QUERY_FAILED') from None
        live = {}
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit() and not parts[2].startswith('Z'):
                live[int(parts[0])] = int(parts[1])
        return live

    def _members(self):
        live = self._table()
        members = {pid for pid in self.known if pid in live}
        for pid in live:
            try:
                if os.getsid(pid) == self.leader:
                    members.add(pid)
            except OSError:
                pass
        grew = True
        while grew:
            grew = False
            for pid, parent in live.items():
                if parent in members and pid not in members:
                    members.add(pid)
                    grew = True
        members.discard(os.getpid())
        self.known |= members
        return members

    def attach(self, process):
        """Accept a subprocess handle, never an arbitrary PID from model input."""
        if self.closed or self.leader is not None:
            raise ProcessJobError('RUNTIME_JOB_CLOSED')
        child = process
        if isinstance(process, asyncio.subprocess.Process):
            child = process._transport.get_extra_info('subprocess')
        if not isinstance(child, subprocess.Popen) or child.pid == os.getpid():
            raise ProcessJobError('RUNTIME_JOB_PROCESS_INVALID')
        # session_exec.py calls setsid before exec; wait for it rather than adopt a
        # process that still shares this owner's session.
        until = time.monotonic() + 2
        while True:
            if child.poll() is not None:
                raise ProcessJobError('RUNTIME_JOB_PROCESS_UNAVAILABLE')
            try:
                if os.getsid(child.pid) == child.pid:
                    break
            except OSError:
                raise ProcessJobError('RUNTIME_JOB_PROCESS_UNAVAILABLE') from None
            if time.monotonic() >= until:
                raise ProcessJobError('RUNTIME_JOB_PROCESS_UNAVAILABLE')
            time.sleep(0.01)
        self.leader = child.pid
        self.known.add(child.pid)

    def active_count(self):
        if self.closed:
            raise ProcessJobError('RUNTIME_JOB_CLOSED')
        return len(self._members()) if self.leader is not None else 0

    def shutdown(self, timeout=5):
        """Do not release ownership based on a kill request alone."""
        if self.closed:
            return
        if type(timeout) not in {int, float} or not 0 < timeout <= 30:
            raise ProcessJobError('RUNTIME_JOB_TIMEOUT_INVALID')
        if self.leader is not None:
            # Freeze first so nothing forks or re-parents away during collection.
            for _ in range(3):
                for pid in self._members():
                    try:
                        os.kill(pid, signal.SIGSTOP)
                    except OSError:
                        pass
            for pid in self._members():
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
            until = time.monotonic() + timeout
            while self._members():
                if time.monotonic() >= until:
                    # Keep ownership; do not pretend children exited.
                    raise ProcessJobError('RUNTIME_JOB_DESCENDANTS_ALIVE')
                time.sleep(0.02)
        self.closed = True


def host_process_job():
    return WindowsProcessJob() if os.name == 'nt' else PosixProcessJob()


def contained_command(command):
    """Prefix needed so the POSIX job can adopt the child as a session leader."""
    if os.name == 'nt':
        return list(command)
    return [command[0], '-I', '-S', '-B', str(Path(__file__).with_name('session_exec.py'))] + list(command)
