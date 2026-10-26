"""Independent expiry unit setup, used only by the reviewed audio publisher.

The timer and hashed module live outside the switched HTTP code directory.
They deliberately remain enabled after an HTTP code rollback.
"""
import hashlib
from pathlib import Path
import re
import sqlite3
import stat
import zipfile

UNIT_ROOT = Path('/etc/systemd/system')
SERVICE = 'turboio-audio-expiry.service'
TIMER = 'turboio-audio-expiry.timer'
MODULE = 'rebuild/material-server/audio-expiry.mjs'


def units(node, module, db, server_id):
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', server_id) or any(
            not str(v).startswith('/') or re.search(r'[^A-Za-z0-9_./-]', str(v)) for v in (node, module, db)):
        raise ValueError('EXPIRY_UNIT_ARGUMENT')
    service = f'''[Unit]
Description=Expire original audio independently of the HTTP release
After=local-fs.target

[Service]
Type=oneshot
User=turboio-material
Group=turboio-material
ExecStart={node} {module} --db {db}.audio.sqlite --server-id {server_id}
TimeoutStartSec=300
NoNewPrivileges=true
PrivateTmp=true
PrivateNetwork=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={Path(db).parent}
RestrictAddressFamilies=AF_UNIX
UMask=0077
'''
    timer = f'''[Unit]
Description=Check original-audio expiry every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=1s
Unit={SERVICE}

[Install]
WantedBy=timers.target
'''
    return {SERVICE: service.encode(), TIMER: timer.encode()}


def publish_exact(file, data, controller):
    # Never replace an unknown existing unit, module or interrupted file.
    if file.exists() or file.is_symlink():
        if controller['regular_bytes'](file) != data:
            raise ValueError('EXPIRY_EXISTING_ASSET_DIFFERS')
        return False
    import os
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fchmod(stream.fileno(), 0o644)
        os.fsync(stream.fileno())
    controller['sync_dir'](file.parent)
    if controller['regular_bytes'](file) != data:
        raise ValueError('EXPIRY_ASSET_READBACK_FAILED')
    return True


def server_id(controller, metadata):
    with sqlite3.connect('file:' + controller['DB'] + '?mode=ro', uri=True) as db:
        value = db.execute("SELECT value FROM meta WHERE key='server_id'").fetchone()[0]
    if hashlib.sha256(value.encode()).hexdigest() != metadata['server_id_sha256']:
        raise ValueError('EXPIRY_SERVER_BINDING_CHANGED')
    return value


def prepare(controller, metadata, manifest):
    expected = manifest['files'][MODULE]['sha256']
    sid = server_id(controller, metadata)
    # First audio activation only: an existing unknown side database requires
    # review, not a backup that would keep original bytes beyond their TTL.
    if Path(controller['DB'] + '.audio.sqlite').exists() or Path(controller['DB'] + '.audio.sqlite').is_symlink():
        raise ValueError('EXISTING_AUDIO_DATABASE_REVIEW_REQUIRED')
    root = controller['BASE'] / 'audio-expiry-v1'
    target = root / expected
    for p in (UNIT_ROOT, controller['BASE'], root, target):
        if p.is_symlink() or p.exists() and not p.is_dir():
            raise ValueError('EXPIRY_DIRECTORY_TYPE')
    if not root.exists():
        root.mkdir(mode=0o755)
        controller['sync_dir'](root.parent)
    if not target.exists():
        target.mkdir(mode=0o755)
        controller['sync_dir'](root)
    module = target / 'audio-expiry.mjs'
    if set(p.name for p in target.iterdir()) - {'audio-expiry.mjs'}:
        raise ValueError('EXPIRY_DIRECTORY_UNKNOWN_FILES')
    paths = controller['locations'](metadata['release_id'])
    with zipfile.ZipFile(paths['archive']) as z:
        data = z.read(MODULE)
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('EXPIRY_MODULE_HASH')
    content = units(controller['NODE'], module, controller['DB'], sid)
    # Refuse a conflicting installed unit before publishing any new asset.
    for name, value in content.items():
        p = UNIT_ROOT / name
        if p.exists() or p.is_symlink():
            if controller['regular_bytes'](p) != value:
                raise ValueError('EXPIRY_EXISTING_ASSET_DIFFERS')
    publish_exact(module, data, controller)
    for name, value in content.items():
        publish_exact(UNIT_ROOT / name, value, controller)
    run = controller['run']
    run([controller['NODE'], '--check', str(module)])
    run(['systemd-analyze', 'verify', '--man=no', str(UNIT_ROOT / SERVICE), str(UNIT_ROOT / TIMER)])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', TIMER])
    run(['systemctl', 'start', SERVICE], timeout=35)
    verify_timer(controller)
    return {'module_sha256': expected, 'module_path': str(module),
            'unit_sha256': {n: hashlib.sha256(v).hexdigest() for n, v in content.items()},
            'timer_active': True, 'survives_http_rollback': True,
            'audio_bytes_backed_up': False}


def verify_timer(controller):
    run = controller['run']
    if run(['systemctl', 'is-active', TIMER]) != 'active' or run(['systemctl', 'is-enabled', TIMER]) != 'enabled' or \
            run(['systemctl', 'show', SERVICE, '--property=Result', '--value']) != 'success' or \
            run(['systemctl', 'show', SERVICE, '--property=ExecMainStatus', '--value']) != '0':
        raise ValueError('EXPIRY_TIMER_NOT_HEALTHY')


def health(controller, metadata):
    sid = server_id(controller, metadata)
    p = Path(controller['DB'] + '.audio.sqlite')
    if p.is_symlink() or not p.is_file() or not stat.S_ISREG(p.lstat().st_mode):
        raise ValueError('AUDIO_DATABASE_NOT_READY')
    with sqlite3.connect('file:' + str(p) + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA application_id').fetchone()[0] != 0x694f4175 or \
                db.execute('PRAGMA user_version').fetchone()[0] != 1 or \
                db.execute('SELECT server_id FROM binding').fetchall() != [(sid,)]:
            raise ValueError('AUDIO_DATABASE_BINDING')
    controller['run'](['systemctl', 'start', SERVICE], timeout=35)
    verify_timer(controller)
