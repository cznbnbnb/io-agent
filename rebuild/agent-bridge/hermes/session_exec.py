"""POSIX launcher: become a session leader, then exec the given command unchanged.

PosixProcessJob adopts the resulting PID as its session id."""
import os
import sys

if __name__ == '__main__':
    os.setsid()
    os.execv(sys.argv[1], sys.argv[1:])
