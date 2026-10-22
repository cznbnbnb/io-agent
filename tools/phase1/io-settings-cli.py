"""Debug App settings CLI. Uses its private HDC inbox; never taps a screen.

read -> set with the observed group binding -> read -> restore the original
operation with a fresh binding. Interrupted writes are reconciled, never resent.
No action starts a microphone, creates a task, or modifies pairing.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('io_card_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
GROUPS = ('brightness', 'sleep', 'display', 'wakeup', 'crown', 'head', 'privacy', 'focus')
ID = re.compile(r'dev-[a-f0-9]{32}')


def valid_values(group, values):
    ranges = {
        'brightness': {'value': (1, 17)}, 'display': {'height': (1, 6), 'distance': (1, 3)},
        'wakeup': {'headup_on': (0, 1), 'degree': (0, 70), 'crown_switch': (0, 255)},
        'crown': {'direction': (0, 1), 'double_action': (0, 9), 'long_press': (0, 9)},
        'head': {'enabled': (0, 1), 'mode': (0, 1)},
        'privacy': {'mic_on': (0, 1), 'led_level': (0, 6), 'led_auto': (0, 1), 'log_on': (0, 1)},
        'focus': {'enabled': (0, 1), 'glass_close': (0, 1)},
    }
    if not isinstance(values, dict):
        return False
    if group == 'sleep':
        return set(values) == {'seconds'} and type(values['seconds']) is int and values['seconds'] in (5, 10, 15, 25, 40, 60, 120)
    fields = ranges.get(group)
    return fields is not None and set(fields) == set(values) and all(type(values[k]) is int and lo <= values[k] <= hi for k, (lo, hi) in fields.items())


def validate_receipt(value, command):
    if not isinstance(value, dict) or value.get('schema') != 1 or value.get('id') != command['id'] or \
            json.loads(value.get('request_json', '{}')) != command or value.get('state') not in ('running', 'complete', 'error', 'uncertain') or value.get('effect_verified') is not False:
        raise ValueError('unexpected device settings receipt')
    for name in ('before', 'after'):
        snapshot = value.get(name)
        if snapshot is None:
            continue
        if not isinstance(snapshot, dict) or set(snapshot) != {'peer', 'connection', 'observed_at', 'groups', 'bindings'} or \
                not re.fullmatch(r'[a-f0-9]{64}', snapshot.get('peer', '')) or type(snapshot.get('connection')) is not int or \
                type(snapshot.get('observed_at')) is not int or not isinstance(snapshot.get('groups'), dict) or not isinstance(snapshot.get('bindings'), dict) or \
                set(snapshot['groups']) != set(snapshot['bindings']) or any(not valid_values(k, v) or not re.fullmatch(r'[a-f0-9]{64}', snapshot['bindings'][k]) for k, v in snapshot['groups'].items()):
            raise ValueError('unexpected settings snapshot')
    if value['state'] == 'complete':
        if value.get('before') is None or value.get('after') is None:
            raise ValueError('missing fresh readback')
        if command['action'] != 'read':
            group = value.get('group')
            if not valid_values(group, value.get('target')) or value['after']['groups'].get(group) != value['target'] or \
                    any(value['after'][k] != value['before'][k] for k in ('peer', 'connection')):
                raise ValueError('device write is not confirmed')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('read', 'set', 'restore', 'reconcile'))
    parser.add_argument('--device', default='6HQ0226407055391')
    parser.add_argument('--hdc', default='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe')
    parser.add_argument('--group', choices=GROUPS)
    parser.add_argument('--values', help='full numeric group JSON, preserving unmodified fields')
    parser.add_argument('--binding', help='exact observed group binding')
    parser.add_argument('--source-id', help='original set operation for explicit restore')
    parser.add_argument('--id', help='reconcile only; never resend a write')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.device):
        parser.error('invalid device')
    root = transport.PRIVATE / args.device / 'settings'
    # Reuse the existing per-device local file/transport lock and path checks.
    with transport.note_local_lock(args.device):
        transport.note_local_chain(root)
        root.mkdir(exist_ok=True)
        if args.action == 'reconcile':
            if not args.id or not ID.fullmatch(args.id) or any((args.group, args.values, args.binding, args.source_id)):
                parser.error('reconcile requires only --id')
            folder = root / args.id
            command = json.loads((folder / 'command.json').read_text(encoding='utf-8'))
        else:
            if args.id:
                parser.error('--id is reconcile only')
            command = {'schema': 1, 'id': 'dev-' + uuid.uuid4().hex, 'action': args.action, 'expires_at': int(time.time() * 1000) + 30000}
            if args.action == 'read':
                if any((args.group, args.values, args.binding, args.source_id)):
                    parser.error('read takes no setting arguments')
            else:
                if not args.binding or not re.fullmatch(r'[a-f0-9]{64}', args.binding):
                    parser.error('a fresh --binding is required')
                command['expected_binding'] = args.binding
                if args.action == 'set':
                    values = json.loads(args.values or 'null')
                    if args.source_id or not valid_values(args.group, values):
                        parser.error('set requires --group and exact full --values')
                    command.update(group=args.group, values=values)
                elif not args.source_id or not ID.fullmatch(args.source_id) or args.group or args.values:
                    parser.error('restore requires --source-id and --binding')
                else:
                    command['source_id'] = args.source_id
            folder = root / command['id']
            folder.mkdir()
            (folder / 'command.json').write_text(json.dumps(command, separators=(',', ':')), encoding='utf-8')
            if not transport.transfer(args.hdc, args.device, 'send', folder / 'command.json', transport.REMOTE + '/device-command.json'):
                print(json.dumps({'id': command['id'], 'state': 'unknown', 'next': 'reconcile only; do not resend'}))
                return 2
        end = time.monotonic() + 35
        while time.monotonic() < end:
            receipt = folder / 'result.json'
            if transport.transfer(args.hdc, args.device, 'recv', transport.REMOTE + '/' + command['id'] + '.json', receipt):
                if not 0 < receipt.stat().st_size <= 65536:
                    raise ValueError('receipt size exceeded')
                result = validate_receipt(json.loads(receipt.read_text(encoding='utf-8-sig')), command)
                if result['state'] != 'running':
                    result.pop('request_json')
                    print(json.dumps(result, ensure_ascii=False))
                    return 0 if result['state'] == 'complete' else 2
            time.sleep(.25)
        print(json.dumps({'id': command['id'], 'state': 'unknown', 'next': 'reconcile only; no replay; inspect original values before explicit restore'}))
        return 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'state': 'error', 'error': 'DEVICE_CLI_FAILED', 'next': 'inspect saved intent; never resend an uncertain write'}))
        raise SystemExit(2)
