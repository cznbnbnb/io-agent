"""Fixed-scope production publisher plus a testable code-directory switch.

Loaded over SSH, not an HTTP endpoint. It never mints credentials, restores a
database, edits nginx/systemd/site files, or removes production directories.
"""
import hashlib
import contextlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import time
import zipfile

BASE = Path('/opt/turboio')
SERVICE = 'turboio-material.service'
NODE = '/opt/turboio/node22/bin/node'
DB = '/var/lib/turboio-material/materials.sqlite'
RUNTIME_PREFIX = 'rebuild/material-server/'
EXPECTED_START = NODE + ' /opt/turboio/rebuild/material-server/cli.mjs serve --db ' + DB + ' --port 3401'


class CodeSwitch:
    """Both callbacks must prove service state, not merely issue a request."""
    def __init__(self, current, stage, backup, rejected, matches, stop, start, health, record, sync):
        self.current, self.stage, self.backup, self.rejected = map(Path, (current, stage, backup, rejected))
        self.matches, self.stop, self.start = matches, stop, start
        self.health, self.record, self.sync = health, record, sync
        self.stop_requested = False
        self.old_moved = False
        self.new_installed = False

    def activate(self):
        if not self.matches(self.current, 'old') or not self.matches(self.stage, 'new'):
            raise ValueError('SOURCE_CONFLICT_BEFORE_STOP')
        if self.backup.exists() or self.backup.is_symlink() or self.rejected.exists() or self.rejected.is_symlink():
            raise ValueError('BACKUP_ALREADY_EXISTS')
        self.stop_requested = True
        self.record('stop_requested')
        self.stop()
        self.record('service_stopped')
        if not self.matches(self.current, 'old') or not self.matches(self.stage, 'new'):
            raise ValueError('SOURCE_CONFLICT_AFTER_STOP')
        self.current.rename(self.backup)
        self.old_moved = True
        self.sync(self.current.parent)
        self.record('old_moved')
        self.stage.rename(self.current)
        self.new_installed = True
        self.sync(self.current.parent)
        self.record('new_installed')
        self.start()
        self.health('new')
        if not self.matches(self.current, 'new'):
            raise ValueError('SOURCE_CONFLICT_AFTER_START')
        self.record('deployed')

    def rollback(self):
        # Inspect actual paths: a failed/uncertain rename acknowledgement must
        # not be interpreted as proof that the filesystem did not change.
        old_at_backup = self.matches(self.backup, 'old')
        old_at_current = self.matches(self.current, 'old')
        new_at_current = self.matches(self.current, 'new')
        if old_at_backup:
            if not new_at_current and self.current.exists():
                raise ValueError('ROLLBACK_SOURCE_CONFLICT')
            self.stop()
            if new_at_current:
                if not self.matches(self.current, 'new') or self.rejected.exists():
                    raise ValueError('ROLLBACK_SOURCE_CONFLICT')
                self.current.rename(self.rejected)
            if self.current.exists() or not self.matches(self.backup, 'old'):
                raise ValueError('ROLLBACK_SOURCE_CONFLICT')
            self.backup.rename(self.current)
            self.sync(self.current.parent)
            self.record('old_restored')
        elif not old_at_current:
            raise ValueError('ROLLBACK_SOURCE_CONFLICT')
        elif self.stop_requested:
            # A timed-out stop request does not prove the old process exited.
            # Confirm it before restarting; never infer exit from an exception.
            self.stop()
        if self.stop_requested or old_at_backup:
            self.start()
            self.health('old')
        if not self.matches(self.current, 'old'):
            raise ValueError('ROLLBACK_SOURCE_CONFLICT')
        self.record('rolled_back' if self.stop_requested or old_at_backup else 'failed_no_swap')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run(args, timeout=20, cwd=None, allowed=(0,)):
    value = subprocess.run(args, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, check=False)
    if value.returncode not in allowed or len(value.stdout) > 65536:
        raise ValueError('REMOTE_COMMAND_FAILED')
    return value.stdout.decode('utf-8', 'strict').strip()


def process_identity(pid):
    try:
        text = Path('/proc/' + str(int(pid)) + '/stat').read_text()
        return text.rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


def regular_bytes(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1048576:
        raise ValueError('SOURCE_TYPE_INVALID')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        parts = []
        remaining = 1048577
        while remaining:
            chunk = os.read(fd, remaining)
            if not chunk:
                break
            parts.append(chunk)
            remaining -= len(chunk)
        data = b''.join(parts)
    finally:
        os.close(fd)
    if len(data) > 1048576:
        raise ValueError('SOURCE_TOO_LARGE')
    return data


def source_hashes(directory, names):
    if directory.is_symlink() or not directory.is_dir():
        return None
    result = {}
    for name in names:
        relative = name.removeprefix(RUNTIME_PREFIX)
        target = directory / relative
        if not target.exists():
            result[name] = None
        else:
            if not target.resolve().is_relative_to(directory.resolve()):
                raise ValueError('SOURCE_LINK_OUTSIDE_DIRECTORY')
            result[name] = sha(regular_bytes(target))
    return result


def verify_contracts(base, names, expected):
    result = {}
    for name in names:
        path = base / name
        result[name] = sha(regular_bytes(path)) if path.exists() else None
    if result != {name: expected[name] for name in names}:
        raise ValueError('SHARED_SCHEMA_CHANGED')
    return result


def publish_additive_contract(base, name, data, expected):
    # This single fixed new schema has no live references in r2. It must exist
    # and be readable before the new validator/code directory can be activated.
    if name != 'docs/contracts/event-v1.2.schema.json':
        raise ValueError('ADDITIVE_SCHEMA_SCOPE_INVALID')
    target = base / name
    if target.exists():
        if expected is None or sha(regular_bytes(target)) != expected or sha(data) != expected:
            raise ValueError('ADDITIVE_SCHEMA_CHANGED')
        return False
    if expected is not None:
        raise ValueError('ADDITIVE_SCHEMA_CHANGED')
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fchmod(stream.fileno(), 0o644)
        os.fsync(stream.fileno())
    sync_dir(target.parent)
    if sha(regular_bytes(target)) != sha(data):
        raise ValueError('ADDITIVE_SCHEMA_HASH_MISMATCH')
    return True


def locations(release_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', release_id):
        raise ValueError('RELEASE_ID_INVALID')
    parent = BASE / 'rebuild'
    return {'current': parent / 'material-server', 'stage': parent / ('.material-server-stage-' + release_id),
            'backup': parent / ('.material-server-backup-' + release_id),
            'rejected': parent / ('.material-server-rejected-' + release_id),
            'journal': parent / ('.material-server-release-' + release_id + '.json'),
            'archive': parent / ('.material-server-source-' + release_id + '.zip')}


def journal_write(path, value, exclusive=False):
    data = (json.dumps(value, sort_keys=True) + '\n').encode()
    temporary = path if exclusive else Path(str(path) + '.partial-' + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if not exclusive:
            os.replace(temporary, path)
        sync_dir(path.parent)
    except Exception:
        # Preserve failed partials for inspection. Never recursively remove a
        # directory merely to make a subsequent release appear successful.
        raise


def inspect_remote(metadata):
    paths = locations(metadata['release_id'])
    result = {'release_id': metadata['release_id'], 'mode': 'inspect', 'status': 'not_recorded'}
    journal = paths['journal']
    if journal.exists():
        state = json.loads(regular_bytes(journal))
        if state.get('release_id') != metadata['release_id'] or state.get('archive_sha256') != metadata['archive_sha256']:
            raise ValueError('JOURNAL_BINDING_MISMATCH')
        result['journal'] = state
        result['status'] = state['phase']
        result['owner_alive'] = process_identity(state['pid']) == state['process_start']
    names = [name for name in metadata['before_sha256'] if name.startswith(RUNTIME_PREFIX)]
    result['directory_sha256'] = {name: source_hashes(paths[name], names) for name in ('current', 'stage', 'backup', 'rejected')}
    contracts = [name for name in metadata['before_sha256'] if name.startswith('docs/contracts/')]
    result['contract_sha256'] = {name: sha(regular_bytes(BASE / name)) if (BASE / name).exists() else None for name in contracts}
    result['service_state'] = run(['systemctl', 'is-active', SERVICE], allowed=(0, 3))
    return result


def run_remote(metadata, archive_bytes, package):
    import fcntl  # Linux only. No installation or third-party remote dependency.
    paths = locations(metadata['release_id'])
    expected_hash = metadata['archive_sha256']
    if len(archive_bytes) > 8388608 or sha(archive_bytes) != expected_hash:
        raise ValueError('ARCHIVE_HASH_MISMATCH')
    names = list(package['FILES'])
    additive = tuple(package.get('ADDITIVE_CONTRACTS', ()))
    if additive and (additive != ('docs/contracts/event-v1.2.schema.json',) or package.get('RELEASE_PROFILE') != 'material-speakers-v1.2'):
        raise ValueError('ADDITIVE_SCHEMA_SCOPE_INVALID')
    if set(metadata['before_sha256']) != set(names):
        raise ValueError('BASELINE_SCOPE_INVALID')
    if any(p.is_symlink() for p in (BASE, BASE / 'rebuild', BASE / 'docs', BASE / 'docs/contracts', paths['current'])):
        raise ValueError('DEPLOY_ROOT_LINK_REFUSED')
    lock = os.open(BASE / 'rebuild/.turboio-release.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        os.close(lock)
        raise ValueError('ANOTHER_RELEASE_RUNNING')
    state = {'schema': 1, 'release_id': metadata['release_id'], 'archive_sha256': expected_hash,
             'phase': 'preparing', 'pid': os.getpid(), 'process_start': process_identity(os.getpid()),
             'at': time.time(), 'production_data_restored': False, 'credentials_minted': False}
    switch = None
    journal_created = False

    def record(phase):
        state['phase'] = phase
        state['updated_at'] = time.time()
        journal_write(paths['journal'], state)

    try:
        if paths['journal'].exists():
            raise ValueError('RELEASE_ALREADY_RECORDED_INSPECT_FIRST')
        if any(paths[name].exists() for name in ('stage', 'backup', 'rejected', 'archive')):
            raise ValueError('RELEASE_PATH_ALREADY_EXISTS')
        runtime = [name for name in names if name.startswith(RUNTIME_PREFIX)]
        before = {name: metadata['before_sha256'][name] for name in runtime}
        if source_hashes(paths['current'], runtime) != before:
            raise ValueError('REMOTE_BASELINE_CHANGED')
        verify_contracts(BASE, package['CONTRACTS'], metadata['before_sha256'])
        args_text = run(['systemctl', 'show', SERVICE, '--property=ExecStart', '--value'])
        match = re.search(r'argv\[\]=(.*?)\s*;', args_text)
        if not match or match[1].strip() != EXPECTED_START:
            raise ValueError('SERVICE_COMMAND_CHANGED')
        if run([NODE, '--version']) != 'v22.23.2' or run(['systemctl', 'is-active', SERVICE]) != 'active':
            raise ValueError('RUNTIME_NOT_EXPECTED')
        db_info = Path(DB).lstat()
        if not stat.S_ISREG(db_info.st_mode):
            raise ValueError('MAIN_DATABASE_TYPE_INVALID')
        with contextlib.closing(sqlite3.connect('file:' + DB + '?mode=ro', uri=True)) as db:
            if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                raise ValueError('MAIN_DATABASE_VERSION_UNEXPECTED')
        journal_write(paths['journal'], state, exclusive=True)
        journal_created = True
        fd = os.open(paths['archive'], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(archive_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        manifest = package['inspect'](paths['archive'])
        if manifest['release_id'] != metadata['release_id']:
            raise ValueError('ARCHIVE_RELEASE_MISMATCH')
        if additive:
            commit=manifest.get('source_git_commit')
            if not re.fullmatch(r'[a-f0-9]{40}',str(commit)) or metadata.get('source_git_commit')!=commit:
                raise ValueError('SOURCE_COMMIT_BINDING_MISMATCH')
            state['source_git_commit']=commit
        new = {name: manifest['files'][name]['sha256'] for name in runtime}
        for name in package['CONTRACTS']:
            if name not in additive and manifest['files'][name]['sha256'] != metadata['before_sha256'][name]:
                raise ValueError('SHARED_SCHEMA_CHANGED')
            if name in additive and metadata['before_sha256'][name] not in (None, manifest['files'][name]['sha256']):
                raise ValueError('ADDITIVE_SCHEMA_CHANGED')
        immutable = ('json.mjs', 'package.json', 'package-lock.json') if additive else ('json.mjs', 'validation.mjs', 'package.json', 'package-lock.json')
        for name in immutable:
            if new[RUNTIME_PREFIX + name] != before[RUNTIME_PREFIX + name]:
                raise ValueError('DEPENDENCY_OR_VALIDATOR_CHANGED')
        old_meta = paths['current'].stat()
        paths['stage'].mkdir(mode=0o755)
        with zipfile.ZipFile(paths['archive']) as z:
            for name in runtime:
                target = paths['stage'] / name.removeprefix(RUNTIME_PREFIX)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with target.open('xb') as stream:
                    stream.write(z.read(name))
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(target, 0o644)
                os.chown(target, old_meta.st_uid, old_meta.st_gid)
        dependencies = paths['current'] / 'node_modules'
        if dependencies.is_symlink() or not dependencies.is_dir():
            raise ValueError('DEPENDENCIES_NOT_REGULAR_DIRECTORY')
        for path in dependencies.rglob('*'):
            if path.is_symlink() and (path.readlink().is_absolute() or not path.resolve().is_relative_to(dependencies.resolve())):
                raise ValueError('DEPENDENCY_LINK_OUTSIDE_DIRECTORY')
        def durable_copy(source, destination):
            value = shutil.copy2(source, destination)
            with open(destination, 'rb') as stream:
                os.fsync(stream.fileno())
            return value

        shutil.copytree(dependencies, paths['stage'] / 'node_modules', symlinks=True, copy_function=durable_copy)
        os.chmod(paths['stage'], stat.S_IMODE(old_meta.st_mode))
        os.chown(paths['stage'], old_meta.st_uid, old_meta.st_gid)
        if additive:
            state['additive_schemas_created'] = []
            with zipfile.ZipFile(paths['archive']) as z:
                for name in additive:
                    if publish_additive_contract(BASE, name, z.read(name), metadata['before_sha256'][name]):
                        state['additive_schemas_created'].append(name)
            record('schema_prepared')
        expected_contracts = {name: manifest['files'][name]['sha256'] for name in package['CONTRACTS']}
        verify_contracts(BASE, package['CONTRACTS'], expected_contracts)
        for name in runtime:
            if name.endswith(('.mjs', '.js')):
                run([NODE, '--check', str(paths['stage'] / name.removeprefix(RUNTIME_PREFIX))])
        warmup = "await import('./http.mjs');await import('./store.mjs');const v=await import('./validation.mjs');v.createValidator();v.createQueueValidator()"
        run([NODE, '--input-type=module', '-e', warmup], cwd=paths['stage'])
        # Ensure source files are readable by the actual systemd service user.
        run(['runuser', '-u', 'turboio-material', '--', NODE, '--input-type=module', '-e', warmup], cwd=paths['stage'])
        for directory in sorted((path for path in paths['stage'].rglob('*') if path.is_dir() and not path.is_symlink()), key=lambda path: len(path.parts), reverse=True):
            sync_dir(directory)
        sync_dir(paths['stage'])
        sync_dir(paths['stage'].parent)
        record('staged_verified')

        # Audio has a separate lifetime obligation. Its reviewed profile must
        # establish expiry outside this switched directory before accepting any
        # bytes; the timer stays in place if new HTTP health triggers rollback.
        if package.get('RELEASE_PROFILE') == 'material-audio-v1':
            if not callable(package.get('prepare_expiry')) or not callable(package.get('audio_health')):
                raise ValueError('AUDIO_EXPIRY_HOOK_REQUIRED')
            state['independent_audio_expiry'] = package['prepare_expiry'](manifest)
            record('audio_expiry_ready')

        def matches(directory, version):
            if source_hashes(directory, runtime) != (before if version == 'old' else new):
                return False
            # r2 rollback safely leaves the new unused schema in place. Never
            # delete a schema after an uncertain apply or restore user data.
            return verify_contracts(BASE, package['CONTRACTS'], expected_contracts) == expected_contracts

        def stop():
            pid = int(run(['systemctl', 'show', SERVICE, '--property=MainPID', '--value']))
            identity = process_identity(pid) if pid else None
            run(['systemctl', 'stop', SERVICE], timeout=35)
            active = run(['systemctl', 'is-active', SERVICE], allowed=(0, 3))
            if active not in ('inactive', 'failed') or run(['systemctl', 'show', SERVICE, '--property=MainPID', '--value']) != '0' or \
               identity is not None and process_identity(pid) == identity:
                raise ValueError('SERVICE_EXIT_NOT_CONFIRMED')

        def start():
            run(['systemctl', 'start', SERVICE], timeout=35)

        def health(version):
            for attempt in range(10):
                try:
                    if run(['systemctl', 'is-active', SERVICE]) != 'active':
                        raise ValueError('SERVICE_NOT_ACTIVE')
                    value = json.loads(run(['curl', '--silent', '--fail', '--max-time', '4', 'http://127.0.0.1:3401/health']))
                    if value.get('service') != 'turboio-materials':
                        raise ValueError('HEALTH_FAILED')
                    status = run(['curl', '--silent', '--max-time', '4', '--resolve', 'cznbnb.cn:443:127.0.0.1', '-o', '/dev/null', '-w', '%{http_code}', 'https://cznbnb.cn/io-api/v1/identity'])
                    if status != '401':
                        raise ValueError('TLS_IDENTITY_FAILED')
                    if version == 'new':
                        headers = run(['curl', '--silent', '--fail', '--max-time', '4', '-D', '-', '-o', '/dev/null', 'http://127.0.0.1:3401/v1/admin']).lower()
                        if 'content-security-policy:' not in headers or 'cache-control: no-store' not in headers:
                            raise ValueError('ADMIN_HEADERS_FAILED')
                    if Path(DB).stat().st_ino != db_info.st_ino:
                        raise ValueError('DATABASE_FILE_REPLACED')
                    with contextlib.closing(sqlite3.connect('file:' + DB + '?mode=ro', uri=True)) as db:
                        if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                            raise ValueError('DATABASE_SCHEMA_CHANGED')
                    if version == 'new' and package.get('RELEASE_PROFILE') == 'material-audio-v1':
                        package['audio_health']()
                    return
                except Exception:
                    if attempt == 9:
                        raise
                    time.sleep(.3)

        switch = CodeSwitch(paths['current'], paths['stage'], paths['backup'], paths['rejected'], matches, stop, start, health, record, sync_dir)
        switch.activate()
        state['after_sha256'] = source_hashes(paths['current'], runtime)
        state['after_contract_sha256'] = verify_contracts(BASE, package['CONTRACTS'], expected_contracts)
        record('deployed')
    except Exception as error:
        code = str(error)
        state['error'] = code if re.fullmatch(r'[A-Z_]{3,90}', code) else type(error).__name__
        if journal_created:
            if switch is not None:
                try:
                    switch.rollback()
                except Exception as rollback_error:
                    value = str(rollback_error)
                    state['rollback_error'] = value if re.fullmatch(r'[A-Z_]{3,90}', value) else type(rollback_error).__name__
                    record('needs_inspection')
            else:
                record('failed_before_stop')
        else:
            state['phase'] = 'refused_before_mutation'
    finally:
        os.close(lock)
    return state
