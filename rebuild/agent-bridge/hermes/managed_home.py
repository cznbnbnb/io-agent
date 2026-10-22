"""Exclusive ownership of an explicitly enrolled iO Hermes home.

Enrollment is separate from task dispatch. This never adopts the user's normal
Hermes home and never creates/replaces a missing conversation during delivery.
"""
import json
import os
from pathlib import Path
import sqlite3
import stat
from runtime_journal import RuntimeJournalError, encode


def private_json(path, maximum=32768):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > maximum:
        raise RuntimeJournalError('RUNTIME_PRIVATE_FILE_UNSAFE')
    return json.loads(Path(path).read_text(encoding='utf-8'))


class ManagedHomeLease:
    def __init__(self, home, binding, sessions):
        self.db = None
        original = Path(home).absolute()
        if original.is_symlink() or not original.is_dir():
            raise RuntimeJournalError('RUNTIME_HOME_NOT_ENROLLED')
        self.home = original.resolve(strict=True)
        marker = private_json(self.home / '.turboio-managed.json')
        if marker != {'schema': 1, 'binding': binding, 'sessions': sessions}:
            raise RuntimeJournalError('RUNTIME_HOME_BINDING_MISMATCH')
        for session_id, registration in sessions.items():
            if not isinstance(session_id, str) or not session_id or set(registration) != {'project_id', 'cwd'}:
                raise RuntimeJournalError('RUNTIME_SESSION_REGISTRATION_INVALID')
            cwd = Path(registration['cwd'])
            if not cwd.is_absolute() or not cwd.is_dir() or str(cwd.resolve()) != registration['cwd']:
                raise RuntimeJournalError('RUNTIME_PROJECT_REGISTRATION_INVALID')
        file = self.home / '.turboio-owner.sqlite'
        if file.exists() or file.is_symlink():
            info = file.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise RuntimeJournalError('RUNTIME_HOME_LOCK_UNSAFE')
        else:
            try:
                fd = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
            except FileExistsError:
                raise RuntimeJournalError('RUNTIME_HOME_IN_USE') from None
        try:
            self.db = sqlite3.connect(file, timeout=0, isolation_level=None)
            if self.db.execute('PRAGMA journal_mode').fetchone()[0] != 'delete':
                raise RuntimeJournalError('RUNTIME_HOME_LOCK_INVALID')
            self.db.execute('BEGIN EXCLUSIVE')
            app_id = self.db.execute('PRAGMA application_id').fetchone()[0]
            if app_id == 0 and not self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                self.db.execute('PRAGMA application_id=1766803565')
                self.db.execute('CREATE TABLE owner (binding TEXT NOT NULL)')
                self.db.execute('INSERT INTO owner VALUES (?)', (encode(binding),))
                self.db.execute('COMMIT')
                self.db.execute('BEGIN EXCLUSIVE')
            elif app_id != 1766803565:
                raise RuntimeJournalError('RUNTIME_HOME_LOCK_INVALID')
            if self.db.execute('SELECT binding FROM owner').fetchall() != [(encode(binding),)]:
                raise RuntimeJournalError('RUNTIME_HOME_BINDING_MISMATCH')
            self.file, self.info = file, file.stat()
        except Exception as error:
            self.close()
            if isinstance(error, RuntimeJournalError):
                raise
            raise RuntimeJournalError('RUNTIME_HOME_IN_USE') from None

    def assert_held(self):
        if self.db is None:
            raise RuntimeJournalError('RUNTIME_HOME_LOCK_LOST')
        info = self.file.lstat()
        if not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino, info.st_nlink) != (self.info.st_dev, self.info.st_ino, 1):
            raise RuntimeJournalError('RUNTIME_HOME_LOCK_LOST')

    def close(self):
        if self.db is not None:
            self.db.close()
            self.db = None

