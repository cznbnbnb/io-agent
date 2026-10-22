"""Independent cutoff for a fixed text-only reading check. Never starts BLE.

Armed before the check is sent. At 225 seconds it can stop only that operation's
original peer/generation/DID, through the existing priority prompter stop lane.
Uncertain transfer is reconciled by its saved ID, never sent again. This needs
a live debug App; loss of the phone/App is reported, not called a hardware exit.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('reading_prompter_cli', Path(__file__).with_name('io-prompter-cli.py'))
prompter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prompter)
transport = prompter.transport
CUTOFF_SECONDS = 225
READ_ID = re.compile(r'read-[a-f0-9]{32}')
DID = re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')


def read_json(path, limit=16384):
    if not 0 < path.stat().st_size <= limit:
        raise ValueError('guard record size')
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, value):
    raw = json.dumps(value, separators=(',', ':')).encode('utf8')
    with path.open('xb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def validate_job(path):
    transport.note_local_chain(path.parent)
    value = read_json(path, 4096)
    if not isinstance(value, dict) or set(value) != {'schema', 'source_id', 'hdc', 'device', 'command_sha256'} or \
            type(value['schema']) is not int or value['schema'] != 1 or \
            not isinstance(value['source_id'], str) or not READ_ID.fullmatch(value['source_id']) or \
            path.parent.name != value['source_id'] or not isinstance(value['hdc'], str) or not value['hdc'] or \
            not isinstance(value['device'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value['device']):
        raise ValueError('invalid reading guard job')
    command_path = path.with_name('command.json')
    command = read_json(command_path, 1024)
    if set(command) != {'schema', 'id', 'action', 'expires_at'} or type(command['schema']) is not int or command['schema'] != 1 or \
            command['id'] != value['source_id'] or command['action'] != 'check' or type(command['expires_at']) is not int or \
            hashlib.sha256(command_path.read_bytes()).hexdigest() != value['command_sha256']:
        raise ValueError('reading guard command changed')
    return value


def arm(folder, command, hdc, device):
    job = folder / 'guard.json'
    value = dict(schema=1, source_id=command['id'], hdc=hdc, device=device,
                 command_sha256=hashlib.sha256((folder/'command.json').read_bytes()).hexdigest())
    save(job, value)
    validate_job(job)
    with (folder/'guard.log').open('xb') as output:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--job', str(job.resolve())],
                                 stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    end = time.monotonic()+5
    while time.monotonic() < end:
        ready_path = folder/'guard-ready.json'
        if ready_path.exists():
            ready = read_json(ready_path, 1024)
            if ready.get('pid') == child.pid and ready.get('source_id') == command['id'] and \
                    ready.get('job_sha256') == hashlib.sha256(job.read_bytes()).hexdigest() and child.poll() is None:
                return child
            raise ValueError('guard readiness mismatch; no check sent')
        if child.poll() is not None:
            break
        time.sleep(.05)
    raise ValueError('guard not live; no check sent')


def receive(job, remote, path):
    result = subprocess.run([job['hdc'], '-t', job['device'], 'file', 'recv', '-b', transport.BUNDLE,
                             transport.REMOTE+'/'+remote, str(path)], capture_output=True, timeout=3)
    if result.returncode or b'FileTransfer finish' not in result.stdout:
        raise ValueError('original reading state unavailable')
    return read_json(path)


def original_binding(record, snapshot, source_id):
    if not isinstance(record, dict) or type(record.get('schema')) is not int or record['schema'] != 1 or \
            record.get('operation') != source_id or record.get('checkOnly') is not True or \
            type(record.get('choice')) is not int or record['choice'] != 0 or record.get('uid') != '' or \
            not isinstance(record.get('peer'), str) or not record['peer'] or len(record['peer']) > 128 or \
            re.search(r'[\x00-\x20\x7f]', record['peer']) or type(record.get('connection')) is not int or record['connection'] < 1 or \
            not isinstance(record.get('did'), str) or not DID.fullmatch(record['did']):
        return None
    expected = hashlib.sha256((record['peer']+'\n'+str(record['connection'])+'\n'+record['did']).encode('utf8')).hexdigest()
    if not isinstance(snapshot, dict) or any(snapshot.get(k) is not True for k in ('active', 'connected', 'can_stop')) or \
            snapshot.get('binding') != expected:
        return None
    return expected


def reconcile(job, stop_id):
    # The original stop intent is stored in the standard prompter CLI directory.
    # main(reconcile) only receives its receipt; it cannot submit another stop.
    argv = sys.argv
    output = io.StringIO()
    try:
        sys.argv = ['io-prompter-cli', 'reconcile', '--device', job['device'], '--hdc', job['hdc'], '--id', stop_id]
        with contextlib.redirect_stdout(output):
            prompter.main()
    finally:
        sys.argv = argv
    value = json.loads(output.getvalue())
    if value.get('id') != stop_id:
        raise ValueError('guard receipt ID mismatch')
    return value


def stop_original(job, folder):
    intent_path = folder/'guard-stop-intent.json'
    if intent_path.exists():
        intent = read_json(intent_path, 2048)
        if intent.get('source_id') != job['source_id'] or not isinstance(intent.get('stop_id'), str) or \
                not prompter.ID.fullmatch(intent['stop_id']):
            raise ValueError('guard stop intent changed')
        return dict(source_id=job['source_id'], stop_id=intent['stop_id'], replayed=False,
                    observation=reconcile(job, intent['stop_id']))
    record = receive(job, 'reading-state.json', folder/'reading-at-cutoff.json')
    snapshot = receive(job, 'prompter-state.json', folder/'prompter-at-cutoff.json')
    binding = original_binding(record, snapshot, job['source_id'])
    if binding is None:
        return dict(source_id=job['source_id'], stop_submitted=False, exit_confirmed=False,
                    reason='NO_MATCHING_ACTIVE_ORIGINAL_OWNER', replayed=False)
    command = prompter.new_command('stop', binding)
    root = transport.PRIVATE.parent/'prompter-cli'
    transport.note_local_chain(root)
    root.mkdir(exist_ok=True)
    stopdir = root/command['id']
    stopdir.mkdir()
    raw = json.dumps(command, separators=(',', ':'))
    with (stopdir/'command.json').open('xb') as stream:
        stream.write(raw.encode('utf8'))
        stream.flush()
        os.fsync(stream.fileno())
    save(intent_path, dict(source_id=job['source_id'], stop_id=command['id'], at=time.time()))
    sent = False
    try:
        result = subprocess.run([job['hdc'], '-t', job['device'], 'file', 'send', '-b', transport.BUNDLE,
                                 str(stopdir/'command.json'), transport.REMOTE+'/prompter-stop.json'],
                                capture_output=True, timeout=3)
        sent = result.returncode == 0 and b'FileTransfer finish' in result.stdout
    except subprocess.TimeoutExpired:
        pass  # Delivery is uncertain. Reconcile the same saved ID; never resend.
    return dict(source_id=job['source_id'], stop_id=command['id'], stop_transfer_submitted=sent,
                replayed=False, observation=reconcile(job, command['id']))


def run(path):
    job = validate_job(path)
    folder = path.parent
    save(folder/'guard-claim.json', dict(pid=os.getpid(), source_id=job['source_id']))
    end = time.monotonic()+CUTOFF_SECONDS
    ready = folder/'guard-ready.partial'
    save(ready, dict(pid=os.getpid(), source_id=job['source_id'],
                     job_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                     deadline=time.time()+CUTOFF_SECONDS))
    ready.rename(folder/'guard-ready.json')
    while time.monotonic() < end:
        time.sleep(max(0, min(.25, end-time.monotonic())))
    try:
        result = stop_original(job, folder)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        result = dict(source_id=job['source_id'], reason='GUARD_UNCERTAIN_KEEP_ORIGINAL_INTENT', exit_confirmed=False)
    save(folder/'guard-result.json', result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', type=Path, required=True)
    args = parser.parse_args()
    run(args.job)
