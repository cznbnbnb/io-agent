"""Windows-owned child process tree; closing/crashing owner kills descendants.

This is containment, not a session lease or proof of task completion. Only attach
children created by this runtime, before loading tools or submitting a prompt.
"""
import ctypes
import asyncio
from ctypes import wintypes
import os
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
