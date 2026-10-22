"""Fixed synthetic long-reading probe. No task answers, microphone or todo writes.

start prepares paused timed prompter text. Only a matching device local-back
candidate can advance to the isolated card; remote stop ACK is insufficient.
Interactive start remains suspended. Debug 125+ permits check only: a fixed,
paused text fixture, no card or microphone. An independent 225-second guard is
armed before sending check and targets its exact prompter owner. Status is not
lens acceptance; the phone's 120-second reading interval starts after pause ACK.
Unknown delivery is reconciled by original ID; never retry a start automatically.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('reading_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
guard_spec = importlib.util.spec_from_file_location('reading_guard', Path(__file__).with_name('io-reading-guard.py'))
reading_guard = importlib.util.module_from_spec(guard_spec)
guard_spec.loader.exec_module(reading_guard)
arm_guard = reading_guard.arm
ID = re.compile(r'read-[a-f0-9]{32}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'start', 'check', 'stop', 'reconcile'])
    parser.add_argument('--device', required=True)
    parser.add_argument('--hdc', default='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe')
    parser.add_argument('--source-id')
    parser.add_argument('--id')
    args = parser.parse_args()
    if (args.action == 'stop') != bool(args.source_id) or args.source_id and not ID.fullmatch(args.source_id):
        parser.error('stop requires the original start --source-id')
    if (args.action == 'reconcile') != bool(args.id) or args.id and not ID.fullmatch(args.id):
        parser.error('reconcile requires the original --id')
    if args.action == 'start':
        # Do not replay the unproven physical-gesture experiment. This host
        # gate takes effect without installing another HAP or touching BLE.
        print(json.dumps(dict(state='blocked', error='READING_PROBE_SUSPENDED',
                              next='Interactive handoff still gated; use check only after a debug125+ installation')))
        return 2
    root = transport.PRIVATE.parent / 'long-reading-cli'
    root.mkdir(exist_ok=True)
    if args.action == 'reconcile':
        folder = root / args.id
        command = json.loads((folder / 'command.json').read_text(encoding='utf8'))
        if command['id'] != args.id:
            raise ValueError('saved command changed')
    else:
        command = dict(schema=1, id='read-'+uuid.uuid4().hex, action=args.action, expires_at=int(time.time()*1000)+30000)
        if args.action == 'stop':
            command['source_id'] = args.source_id
        folder = root / command['id']
        folder.mkdir()
        (folder / 'command.json').write_text(json.dumps(command, separators=(',', ':')), encoding='utf8')
        guard_process = arm_guard(folder, command, args.hdc, args.device) if args.action == 'check' else None
        if guard_process is not None and guard_process.poll() is not None:
            raise ValueError('guard exited; check not sent')
        try:
            sent = transport.transfer(args.hdc, args.device, 'send', folder / 'command.json', transport.REMOTE+'/reading-command.json')
        except subprocess.TimeoutExpired:
            sent = False
        if not sent:
            print(json.dumps(dict(id=command['id'], state='unknown', next='reconcile original ID; no replay')))
            return 2
    deadline = time.monotonic()+35
    while time.monotonic() < deadline:
        target = folder / 'result.json'
        try:
            received = transport.transfer(args.hdc, args.device, 'recv', transport.REMOTE+'/'+command['id']+'.json', target)
        except subprocess.TimeoutExpired:
            break
        if received:
            if not 0 < target.stat().st_size <= 16384:
                raise ValueError('receipt size')
            result = json.loads(target.read_text(encoding='utf-8-sig'))
            if result.get('schema') != 1 or result.get('id') != command['id'] or json.loads(result.get('request_json', '{}')) != command or result.get('lens_verified') is not False:
                raise ValueError('receipt mismatch')
            if result['state'] in ('complete', 'error', 'uncertain'):
                # Full owner fields stay in the ignored local receipt.
                record = result['record']
                safe = {key: record[key] for key in ('operation','phase','outcome','choice','deadline','readStarted','readEnded','exitConfirmed','error')}
                safe['exitOrigin'] = record.get('exitOrigin', 'legacy_unspecified')
                print(json.dumps(dict(id=command['id'], state=result['state'], error=result['error'], record=safe, lens_verified=False)))
                return 0 if result['state'] == 'complete' else 2
        time.sleep(.4)
    print(json.dumps(dict(id=command['id'], state='unknown', next='reconcile original ID; no replay')))
    return 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps(dict(state='error', error='READING_CLI_FAILED', next='inspect saved intent; no replay')))
        raise SystemExit(2)
