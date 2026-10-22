"""Observe or stop an existing prompter session. Never starts display or audio.

Use status to obtain a fresh binding, then stop --binding <binding> for that
exact owner. Reconcile an unknown result by its original ID; never replay stop.
The snapshot and exit receipt do not establish lens readability or navigation.
Requires a debug build containing the prompter probe (candidate 124 or later).
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

spec = importlib.util.spec_from_file_location('prompter_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
ID = re.compile(r'prm-[a-f0-9]{32}')


def new_command(action, binding=None):
    if action not in ('status', 'stop') or (action == 'stop') != bool(binding) or \
            binding and not re.fullmatch(r'[a-f0-9]{64}', binding):
        raise ValueError('invalid prompter command')
    command = dict(schema=1, id='prm-'+uuid.uuid4().hex, action=action,
                   expires_at=int(time.time()*1000)+10000)
    if binding:
        command['expected_binding'] = binding
    return command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'stop', 'reconcile'])
    parser.add_argument('--device', required=True)
    parser.add_argument('--hdc', default='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe')
    parser.add_argument('--binding')
    parser.add_argument('--id')
    args = parser.parse_args()
    if (args.action == 'stop') != bool(args.binding) or args.binding and not re.fullmatch(r'[a-f0-9]{64}', args.binding):
        parser.error('stop requires an exact status --binding')
    if (args.action == 'reconcile') != bool(args.id) or args.id and not ID.fullmatch(args.id):
        parser.error('reconcile requires the original --id')
    root = transport.PRIVATE.parent / 'prompter-cli'
    root.mkdir(exist_ok=True)
    if args.action == 'reconcile':
        folder = root / args.id
        raw = (folder / 'command.json').read_text(encoding='utf8')
        command = json.loads(raw)
        if command['id'] != args.id:
            raise ValueError('saved command changed')
    else:
        command = new_command(args.action, args.binding)
        raw = json.dumps(command, separators=(',', ':'))
        folder = root / command['id']
        folder.mkdir()
        (folder / 'command.json').write_text(raw, encoding='utf8')
        try:
            inbox = 'prompter-stop.json' if args.action == 'stop' else 'prompter-command.json'
            sent = transport.transfer(args.hdc, args.device, 'send', folder/'command.json', transport.REMOTE+'/'+inbox)
        except subprocess.TimeoutExpired:
            sent = False
        if not sent:
            print(json.dumps(dict(id=command['id'], state='unknown', next='reconcile original ID; no replay')))
            return 2
    deadline = time.monotonic()+25
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
            if result.get('schema') != 1 or result.get('id') != command['id'] or result.get('request_json') != raw or result.get('lens_verified') is not False:
                raise ValueError('receipt mismatch')
            if result['state'] in ('complete', 'error', 'uncertain'):
                result.pop('request_json', None)
                print(json.dumps(result))
                return 0 if result['state'] == 'complete' else 2
        time.sleep(.25)
    print(json.dumps(dict(id=command['id'], state='unknown', next='reconcile original ID; no replay')))
    return 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps(dict(state='error', error='PROMPTER_CLI_FAILED', next='inspect saved intent; no replay')))
        raise SystemExit(2)
