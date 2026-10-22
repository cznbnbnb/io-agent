"""Bounded display protocol CLI. Receipts are not lens or exit acceptance.

The independent guard is armed before start, uses a separate stop inbox and
targets only this start ID. It never starts audio or clears cleanup evidence.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

spec = importlib.util.spec_from_file_location('channel_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
ID = re.compile(r'chn-[a-f0-9]{32}')
PROFILES = ('source-partial','source-final','classic-final','dual-final','subtitle-preview','subtitle-no-preview')
DEFAULT_HDC = 'D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe'
JOURNAL = 'data/storage/el2/base/haps/entry/files/display-cleanup.json'


def snapshot_valid(s):
    if not isinstance(s, dict):
        return False
    notice_keys = {'notice_can_configure','notice_binding','notice_target_seconds','notice_submission','notice_device_value_known'}
    if notice_keys.intersection(s) and (not notice_keys.issubset(s) or type(s['notice_can_configure']) is not bool or
            s['notice_device_value_known'] is not False or type(s['notice_target_seconds']) is not int or
            s['notice_target_seconds'] not in (-1,5,10,15,20,30,120) or
            s['notice_submission'] not in ('none','pending','submitted','uncertain') or not isinstance(s['notice_binding'], str) or
            s['notice_binding'] != '' and not re.fullmatch(r'[a-f0-9]{64}', s['notice_binding'])):
        return False
    flags = ('connected','foreground','active','closing','ready','blocked','can_cleanup','stop_submitted')
    numbers = ('connection','audio_packets','text_writes','started_at')
    return all(type(s.get(k)) is bool for k in flags) and all(type(s.get(k)) is int and 0 <= s[k] <= 9007199254740991 for k in numbers) and \
        type(s.get('ack_code')) is int and -1 <= s['ack_code'] <= 65535 and \
        all(isinstance(s.get(k), str) and (s[k] == '' or re.fullmatch(r'[a-f0-9]{64}', s[k])) for k in ('peer','binding')) and \
        all(isinstance(s.get(k), str) and (s[k] == '' or ID.fullmatch(s[k])) for k in ('operation_id','exit_operation_id')) and \
        s.get('exit_evidence') in ('none','device_event','user_confirmation') and isinstance(s.get('note'), str) and len(s['note']) <= 256 and \
        isinstance(s.get('ack_config',''), str) and len(s.get('ack_config','')) <= 1024 and s.get('text_profile','source-partial') in PROFILES


def validate_result(result, command):
    if not isinstance(result, dict) or result.get('schema') != 1 or result.get('id') != command['id'] or \
            json.loads(result.get('request_json', '{}')) != command or result.get('state') not in ('running','complete','error','uncertain') or \
            result.get('lens_verified') is not False or not snapshot_valid(result.get('snapshot')):
        raise ValueError('unexpected channel receipt')
    return result


def poll_result(hdc, device, folder, command, seconds=35):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        target = folder / 'result.json'
        if transport.transfer(hdc, device, 'recv', transport.REMOTE + '/' + command['id'] + '.json', target):
            if not 0 < target.stat().st_size <= 65536:
                raise ValueError('result size')
            value = validate_result(json.loads(target.read_text(encoding='utf-8-sig')), command)
            if value['state'] != 'running':
                return value
        time.sleep(.3)
    return {'id': command['id'], 'state': 'unknown', 'next': 'reconcile only; never replay start'}


def owns_pending(value, source):
    return isinstance(value, dict) and value.get('schema') == 2 and value.get('operation') == source and \
        isinstance(value.get('sid'), str) and re.fullmatch(r'[a-f0-9]{32}', value['sid']) is not None and value.get('evidence') == 'none'


def confirms_exit(value, source):
    return isinstance(value, dict) and value.get('schema') == 2 and value.get('operation') == source and \
        value.get('sid') == '' and value.get('peer') == '' and value.get('evidence') in ('device_event','user_confirmation')


def guard_transfer(hdc, device, direction, source, target, timeout=3):
    try:
        result = subprocess.run([hdc, '-t', device, 'file', direction, '-b', transport.BUNDLE, str(source), str(target)],
                                capture_output=True, timeout=timeout)
        return result.returncode == 0 and b'FileTransfer finish' in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def guard(job):
    job = job.resolve(strict=True)
    allowed = transport.PRIVATE.resolve()
    if not job.is_relative_to(allowed) or job.name != 'guard.json':
        raise ValueError('guard path')
    cfg = json.loads(job.read_text(encoding='utf8'))
    command = json.loads((job.parent / 'command.json').read_text(encoding='utf8'))
    if command.get('action') != 'display-start' or not ID.fullmatch(command.get('id', '')) or \
            cfg.get('source_id') != command['id'] or type(command.get('hold_ms')) is not int or not 5000 <= command['hold_ms'] <= 125000 or \
            not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', cfg.get('device', '')):
        raise ValueError('guard config')
    started = time.monotonic()
    (job.parent / 'guard.ready').write_text(str(os.getpid()), encoding='ascii')
    # Independent of model turns, TTS, playback and the original CLI process.
    deadline = started + command['hold_ms'] / 1000 + 2
    while time.monotonic() < deadline:
        time.sleep(max(0, min(.5, deadline - time.monotonic())))
    stop = {'schema': 1, 'id': 'chn-' + uuid.uuid4().hex, 'action': 'display-stop',
            'expires_at': int(time.time() * 1000) + 30000, 'source_id': command['id']}
    stopdir = job.parent / 'guard-stop'
    stopdir.mkdir()
    stopfile = stopdir / 'command.json'
    stopfile.write_text(json.dumps(stop, separators=(',', ':')), encoding='utf8')
    sent = guard_transfer(cfg['hdc'], cfg['device'], 'send', stopfile, transport.REMOTE + '/channel-stop.json')
    report = {'source_id': command['id'], 'stop_transfer_submitted': sent, 'exit_confirmed': False,
              'exit_evidence': 'none', 'cleanup_pending': True, 'stop_replayed': False}
    end = time.monotonic() + 8
    while time.monotonic() < end:
        path = stopdir / 'cleanup.json'
        if guard_transfer(cfg['hdc'], cfg['device'], 'recv', JOURNAL, path, min(3, max(.1, end-time.monotonic()))) and path.stat().st_size <= 1024:
            value = json.loads(path.read_text(encoding='utf-8-sig'))
            if confirms_exit(value, command['id']):
                report.update(exit_confirmed=True, exit_evidence=value['evidence'], cleanup_pending=False)
                break
            if not owns_pending(value, command['id']):
                report['note'] = 'different or unreadable session; no further writes'
                break
        time.sleep(.5)
    (job.parent / 'guard-result.json').write_text(json.dumps(report, indent=2), encoding='utf8')


def arm_guard(folder, command, hdc, device):
    job = folder / 'guard.json'
    job.write_text(json.dumps({'source_id': command['id'], 'hdc': hdc, 'device': device}), encoding='utf8')
    with (folder / 'guard.log').open('wb') as output:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'guard', '--job', str(job)],
                                   stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    end = time.monotonic() + 5
    while time.monotonic() < end:
        if (folder / 'guard.ready').is_file():
            return process.pid
        if process.poll() is not None:
            break
        time.sleep(.05)
    raise ValueError('guard was not armed; no start sent')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status','display-start','display-update','display-stop','notification-timing','reconcile','guard'))
    parser.add_argument('--device', default='6HQ0226407055391')
    parser.add_argument('--hdc', default=DEFAULT_HDC)
    parser.add_argument('--text')
    parser.add_argument('--seconds', type=int, default=15)
    parser.add_argument('--source-id')
    parser.add_argument('--profile', choices=PROFILES)
    parser.add_argument('--notice-seconds', type=int, choices=(5,10,15,20,30,120), help='Global ordinary-notification target only; previous device value is unknown, no automatic rollback')
    parser.add_argument('--set-global-target', action='store_true', help='Explicitly select a new global notification duration; not a suggestion-card TTL')
    parser.add_argument('--binding')
    parser.add_argument('--id')
    parser.add_argument('--job', type=Path)
    args = parser.parse_args()
    if args.action == 'guard':
        guard(args.job)
        return 0
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.device):
        parser.error('invalid device')
    if args.action != 'notification-timing' and (args.notice_seconds is not None or args.set_global_target):
        parser.error('notification timing flags are exclusive to notification-timing')
    if args.action == 'notification-timing' and (not args.set_global_target or args.notice_seconds is None or
            not args.binding or not re.fullmatch(r'[a-f0-9]{64}', args.binding) or args.text or args.source_id or args.profile):
        parser.error('notification-timing requires --set-global-target, --notice-seconds and fresh notice_binding; no text or display controls')
    if args.action == 'notification-timing' and any(token.startswith('--') and token.split('=',1)[0] not in
            {'--notice-seconds','--binding','--set-global-target','--device','--hdc'} for token in sys.argv[1:]):
        parser.error('notification-timing cannot mix display, guard or reconciliation flags')
    with transport.note_local_lock(args.device):
        root = transport.PRIVATE / args.device / 'channels'
        transport.note_local_chain(root)
        root.mkdir(exist_ok=True)
        if args.action == 'reconcile':
            if not args.id or not ID.fullmatch(args.id):
                parser.error('reconcile requires --id')
            folder = root / args.id
            command = json.loads((folder / 'command.json').read_text(encoding='utf8'))
        else:
            command = {'schema': 1, 'id': 'chn-' + uuid.uuid4().hex, 'action': args.action, 'expires_at': int(time.time()*1000) + 30000}
            if args.action == 'notification-timing':
                command.update(notice_seconds=args.notice_seconds, binding=args.binding)
            elif args.action == 'display-start':
                if not args.text or not args.text.strip() or len(args.text.encode('utf-16-le')) // 2 > 96 or re.search(r'[\x00-\x1f\x7f]', args.text) or not 5 <= args.seconds <= 125:
                    parser.error('start needs 1..96 UTF16 units and 5..125 seconds')
                command.update(text=args.text, hold_ms=args.seconds*1000)
                if args.profile:
                    command['profile'] = args.profile
            elif args.action == 'display-update':
                if not args.text or not args.text.strip() or len(args.text.encode('utf-16-le')) // 2 > 96 or re.search(r'[\x00-\x1f\x7f]', args.text) or \
                        not args.source_id or not ID.fullmatch(args.source_id) or not args.profile or args.profile.startswith('subtitle-'):
                    parser.error('update needs text, original source ID and an explicit bounded profile')
                command.update(text=args.text, source_id=args.source_id, profile=args.profile)
            elif args.action == 'display-stop':
                if bool(args.source_id) == bool(args.binding):
                    parser.error('stop needs exactly one original source ID or fresh binding')
                if args.source_id and ID.fullmatch(args.source_id):
                    command['source_id'] = args.source_id
                elif args.binding and re.fullmatch(r'[a-f0-9]{64}', args.binding):
                    command['binding'] = args.binding
                else:
                    parser.error('invalid stop binding')
            folder = root / command['id']
            folder.mkdir()
            (folder / 'command.json').write_text(json.dumps(command, separators=(',', ':')), encoding='utf8')
            if args.action == 'display-start':
                arm_guard(folder, command, args.hdc, args.device)
            if not transport.transfer(args.hdc, args.device, 'send', folder / 'command.json', transport.REMOTE + '/channel-command.json'):
                print(json.dumps({'id':command['id'],'state':'unknown','next':'guard remains armed; reconcile only; no replay'}))
                return 2
        result = poll_result(args.hdc, args.device, folder, command)
        result.pop('request_json', None)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['state'] == 'complete' else 2


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        print(json.dumps({'state':'error','error':'CHANNEL_CLI_FAILED','next':'inspect saved intent and guard; do not replay start'}))
        raise SystemExit(2)
