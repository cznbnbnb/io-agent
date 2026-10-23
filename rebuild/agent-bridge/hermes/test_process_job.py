import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace

from process_job import WindowsProcessJob, PosixProcessJob, ProcessJobError, contained_command


@unittest.skipUnless(os.name == 'nt', 'Windows containment only')
class ProcessJobTests(unittest.TestCase):
    def child(self):
        child = subprocess.Popen([sys.executable, '-I', '-S', '-B', '-c', 'import time; time.sleep(60)'],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def cleanup():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=10)
        self.addCleanup(cleanup)
        return child

    def test_explicit_shutdown_confirms_zero_descendants_before_close(self):
        job = WindowsProcessJob()
        self.addCleanup(job.shutdown)
        child = self.child()
        job.attach(child)
        self.assertEqual(job.active_count(), 1)
        job.shutdown()
        self.assertEqual(child.wait(timeout=10), 74)
        self.assertIsNone(job.handle)
        job.shutdown()

    def test_closed_job_and_invalid_child_cannot_be_attached(self):
        job = WindowsProcessJob()
        self.addCleanup(job.shutdown)
        with self.assertRaisesRegex(ProcessJobError, '^RUNTIME_JOB_PROCESS_INVALID$'):
            job.attach(object())
        with self.assertRaisesRegex(ProcessJobError, '^RUNTIME_JOB_PROCESS_INVALID$'):
            job.attach(SimpleNamespace(pid=os.getpid()))
        job.shutdown()
        with self.assertRaisesRegex(ProcessJobError, '^RUNTIME_JOB_CLOSED$'):
            job.attach(self.child())

    def test_actual_owner_hard_exit_kills_assigned_child_and_inherited_grandchild(self):
        with tempfile.TemporaryDirectory(prefix='io-process-job-') as temporary:
            marker = Path(temporary)/'processes.json'
            module = str(Path(__file__).resolve().parent)
            # Child waits until assigned before spawning its own descendant.
            descendant_code = "import sys,subprocess,time,json,os; from pathlib import Path; sys.stdin.readline(); grandchild=subprocess.Popen([sys.executable,'-I','-S','-B','-c','import time; time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); Path(sys.argv[1]).write_text(json.dumps([os.getpid(),grandchild.pid])); time.sleep(60)"
            owner_code = "import sys,subprocess,os; sys.path.insert(0,sys.argv[1]); from process_job import WindowsProcessJob; job=WindowsProcessJob(); child=subprocess.Popen([sys.executable,'-I','-S','-B','-c',sys.argv[3],sys.argv[2]],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); job.attach(child); child.stdin.write(b'go\\n'); child.stdin.flush(); sys.stdin.readline(); os._exit(73)"
            owner = subprocess.Popen([sys.executable, '-I', '-S', '-B', '-c', owner_code, module, str(marker), descendant_code],
                                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel.WaitForSingleObject.restype = wintypes.DWORD
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            handles = []
            try:
                for _ in range(150):
                    if marker.exists():
                        break
                    if owner.poll() is not None:
                        self.fail('fixture owner exited before descendant marker')
                    time.sleep(0.02)
                self.assertTrue(marker.exists())
                for pid in json.loads(marker.read_text()):
                    handle = kernel.OpenProcess(0x100000, False, pid)  # SYNCHRONIZE; retain handles against PID reuse.
                    self.assertTrue(handle)
                    self.assertEqual(kernel.WaitForSingleObject(handle, 0), 258)  # STILL WAITING
                    handles.append(handle)
                owner.stdin.write(b'exit\n')
                owner.stdin.flush()
                self.assertEqual(owner.wait(timeout=10), 73)
                for handle in handles:
                    self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0)
            finally:
                if owner.poll() is None:
                    owner.kill()
                owner.wait(timeout=10)
                owner.stdin.close()
                for handle in handles:
                    kernel.CloseHandle(handle)



@unittest.skipIf(os.name == 'nt', 'POSIX containment only')
class PosixProcessJobTests(unittest.TestCase):
    SLEEP = "import time; time.sleep(60)"
    # Spawns a grandchild in its own session (as Hermes tools do), reports its PID, then waits.
    ESCAPE = ("import subprocess,sys,time; g=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],"
              "start_new_session=True); print(g.pid, flush=True); time.sleep(60)")

    def spawn(self, code, contained=True):
        command = [sys.executable, '-I', '-S', '-B', '-c', code]
        child = subprocess.Popen(contained_command(command) if contained else command, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        def cleanup():
            if child.poll() is None:
                child.kill()
            child.wait(timeout=10)
            child.stdout.close()
        self.addCleanup(cleanup)
        return child

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
        return bool(state) and not state.startswith('Z')

    def test_contained_command_wraps_with_session_launcher(self):
        command = contained_command([sys.executable, '-c', 'pass'])
        self.assertEqual(command[0], sys.executable)
        self.assertTrue(command[4].endswith('session_exec.py'))
        self.assertEqual(command[5:], [sys.executable, '-c', 'pass'])

    def test_shutdown_confirms_zero_members_and_closes(self):
        job = PosixProcessJob()
        child = self.spawn(self.SLEEP)
        job.attach(child)
        self.assertEqual(os.getsid(child.pid), child.pid)
        self.assertGreaterEqual(job.active_count(), 1)
        job.shutdown()
        self.assertEqual(child.wait(timeout=10), -9)
        self.assertTrue(job.closed)
        job.shutdown()
        with self.assertRaises(ProcessJobError) as error:
            job.attach(child)
        self.assertEqual(error.exception.code, 'RUNTIME_JOB_CLOSED')

    def test_descendant_that_calls_setsid_is_still_killed(self):
        job = PosixProcessJob()
        child = self.spawn(self.ESCAPE)
        job.attach(child)
        grandchild = int(child.stdout.readline())
        self.assertNotEqual(os.getsid(grandchild), child.pid)
        self.assertGreaterEqual(job.active_count(), 2)
        job.shutdown()
        child.wait(timeout=10)
        deadline = time.monotonic() + 5
        while self.alive(grandchild) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(self.alive(grandchild))

    def test_child_outside_its_own_session_is_refused(self):
        job = PosixProcessJob()
        child = self.spawn(self.SLEEP, contained=False)
        with self.assertRaises(ProcessJobError) as error:
            job.attach(child)
        self.assertEqual(error.exception.code, 'RUNTIME_JOB_PROCESS_UNAVAILABLE')
        job.shutdown()


if __name__ == '__main__':
    unittest.main(verbosity=2)
