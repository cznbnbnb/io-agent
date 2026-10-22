"""Read/stop an existing capture lab; never starts audio or confirms lens exit.

The separate guard is armed before the UI start. It binds one new attempt and
uses a fixed monotonic deadline. Failed transport cannot prove the mic stopped.
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

spec = importlib.util.spec_from_file_location('lab_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
PRIVATE = transport.PRIVATE / 'capture-lab'
ID = re.compile(r'cap-[a-f0-9]{32}')
HEX = re.compile(r'[a-f0-9]{64}')
HDC = 'D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe'
BOOLS = ('active', 'connected', 'foreground', 'applicable', 'metrics_available',
         'observation_restored', 'stop_submitted', 'worker_exited', 'input_sealed')
COUNTS = ('type1_packets', 'first_type1_at', 'mic_write_started_at', 'mic_write_completed_at',
          'first_decoded_compressed_bytes', 'first_decoded_samples', 'capture_packets', 'pcm_bytes',
          'nonzero_packets', 'compressed_packets', 'compressed_bytes', 'repeated_compressed_packets',
          'first_audio_at', 'last_audio_at', 'stop_requested_at', 'input_sealed_at', 'tail_packets', 'tail_pcm_bytes', 'late_audio_packets')
KEYS = set(BOOLS + COUNTS) | {'phase', 'attempt_sha256', 'expected_binding', 'expected_peer', 'expected_connection',
    'exit_evidence', 'recorder_stop', 'exit_write', 'last_compressed_sha256', 'pcm_rms', 'pcm_peak', 'exit_reason', 'transcript_status', 'boundary_evidence'}


def snapshot_valid(s):
    if not isinstance(s, dict) or set(s) != KEYS or not all(type(s.get(k)) is bool for k in BOOLS) or \
            not all(type(s.get(k)) is int and 0 <= s[k] <= 9007199254740991 for k in COUNTS):
        return False
    return s.get('phase') in ('idle', 'preparing', 'starting', 'listening', 'stopping', 'cleanup_pending', 'draft', 'failed', 'blocked', 'unavailable') and \
        all(isinstance(s.get(k), str) and (s[k] == '' or HEX.fullmatch(s[k])) for k in ('attempt_sha256', 'expected_binding', 'expected_peer')) and \
        type(s.get('expected_connection')) is int and 0 <= s['expected_connection'] <= 9007199254740991 and \
        s.get('exit_evidence') in ('none', 'device_event', 'user_confirmation', 'legacy_record') and \
        all(s.get(k) in ('not_attempted', 'pending', 'submitted', 'failed') for k in ('recorder_stop', 'exit_write')) and \
        isinstance(s.get('last_compressed_sha256'), str) and (s['last_compressed_sha256'] == '' or HEX.fullmatch(s['last_compressed_sha256'])) and \
        all(type(s.get(k)) in (int, float) and 0 <= s[k] <= 32768 for k in ('pcm_rms', 'pcm_peak')) and \
        type(s.get('exit_reason')) is int and -1 <= s['exit_reason'] <= 65535 and \
        s.get('transcript_status') in ('none', 'pending', 'complete', 'partial', 'cancelled', 'legacy') and \
        s.get('boundary_evidence') in ('none', 'device_event', 'quiet_after_stop', 'limit', 'cancelled')


def command(action, snapshot=None):
    if action not in ('status', 'stop', 'cleanup'):
        raise ValueError('no start, clear or user-confirmation action exists')
    binding, peer, connection = '', '', 0
    if action != 'status':
        if not snapshot_valid(snapshot) or not snapshot['applicable'] or not snapshot['connected'] or \
                not HEX.fullmatch(snapshot['expected_binding']) or not HEX.fullmatch(snapshot['expected_peer']) or snapshot['expected_connection'] < 1:
            raise ValueError('exact applicable lab snapshot required')
        binding, peer, connection = (snapshot[k] for k in ('expected_binding', 'expected_peer', 'expected_connection'))
    return dict(schema=1, id='cap-' + uuid.uuid4().hex, action=action, expires_at=int(time.time() * 1000) + 30000,
                expected_binding=binding, expected_peer=peer, expected_connection=connection)


def transfer(hdc, device, direction, source, target, timeout=3):
    try:
        result = subprocess.run([hdc, '-t', device, 'file', direction, '-b', transport.BUNDLE, str(source), str(target)],
                                capture_output=True, timeout=timeout)
        return result.returncode == 0 and b'FileTransfer finish' in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def exchange(folder, cfg, request, seconds=5):
    end = time.monotonic() + seconds
    folder.mkdir(parents=True, exist_ok=False)
    file = folder / 'command.json'
    raw = json.dumps(request, separators=(',', ':'))
    file.write_text(raw, encoding='utf8')
    lane = 'lab-stop.json' if request['action'] == 'stop' else 'lab-command.json'
    remaining = end - time.monotonic()
    if remaining <= 0 or not transfer(cfg['hdc'], cfg['device'], 'send', file, transport.REMOTE + '/' + lane, timeout=min(3, remaining)):
        return {'state': 'unknown', 'reason': 'transfer_failed', 'exit_confirmed': False}
    while time.monotonic() < end:
        resultfile = folder / 'result.json'
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        if transfer(cfg['hdc'], cfg['device'], 'recv', transport.REMOTE + '/' + request['id'] + '.json', resultfile,
                    timeout=min(2, remaining)):
            if not 0 < resultfile.stat().st_size <= 32768:
                raise ValueError('invalid receipt size')
            value = json.loads(resultfile.read_text(encoding='utf-8-sig'))
            if not isinstance(value, dict) or set(value) != {'schema', 'id', 'request_json', 'state', 'error', 'snapshot', 'control_call_completed'} or \
                    value.get('schema') != 1 or value.get('id') != request['id'] or \
                    value.get('request_json') != raw or value.get('state') not in ('running', 'complete', 'error', 'uncertain') or \
                    not snapshot_valid(value.get('snapshot')) or type(value.get('control_call_completed')) is not bool or \
                    not isinstance(value.get('error'), str) or not re.fullmatch(r'[A-Z0-9_]{0,80}', value['error']):
                raise ValueError('invalid lab receipt')
            if value['state'] != 'running':
                return value
        time.sleep(max(0, min(.1, end - time.monotonic())))
    return {'state': 'unknown', 'reason': 'receipt_timeout_no_replay', 'exit_confirmed': False}


def confirms_exit(s, attempt):
    return snapshot_valid(s) and s['attempt_sha256'] == attempt and not s['active'] and \
        s['worker_exited'] and s['input_sealed'] and s['exit_evidence'] in ('device_event', 'user_confirmation')


def select_attempt(s, baseline):
    return snapshot_valid(s) and s['applicable'] and s['connected'] and s['foreground'] and s['active'] and \
        s['metrics_available'] and not s['observation_restored'] and bool(HEX.fullmatch(s['attempt_sha256'])) and s['attempt_sha256'] != baseline and \
        bool(HEX.fullmatch(s['expected_binding'])) and bool(HEX.fullmatch(s['expected_peer'])) and s['expected_connection'] > 0 and \
        s['phase'] in ('preparing', 'starting', 'listening')


def run_guard(job):
    job = job.resolve(strict=True)
    if not job.is_relative_to(PRIVATE.resolve()) or job.name != 'guard.json':
        raise ValueError('guard path')
    cfg = json.loads(job.read_text(encoding='utf8'))
    if set(cfg) != {'hdc', 'device', 'seconds', 'baseline'} or type(cfg['seconds']) is not int or not 10 <= cfg['seconds'] <= 25 or \
            not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', cfg['device']) or not isinstance(cfg['baseline'], str) or \
            cfg['baseline'] != '' and not HEX.fullmatch(cfg['baseline']):
        raise ValueError('guard config')
    with transport.note_local_lock('capture-guard-' + cfg['device']):
        return guard_armed(job.parent, cfg)


def guard_armed(folder, cfg):
    target, count = None, 0
    started = time.monotonic()
    deadline = started + cfg['seconds']
    report = dict(stop_sent=False, stop_replayed=False, exit_confirmed=False, cleanup_pending=True, reason='no_new_bound_attempt')
    (folder / 'guard.ready').write_text(json.dumps({'pid': os.getpid(), 'seconds': cfg['seconds'],
        'start_before_ms': int(time.time() * 1000) + 3000}), encoding='ascii')
    try:
        while time.monotonic() < deadline - 4:
            try:
                value = exchange(folder / ('observe-' + str(count)), cfg, command('status'), seconds=1)
            except (ValueError, OSError):
                # A broken observation cannot disarm an already-bound deadline.
                value = {'state': 'unknown'}
                report['observation_failed'] = True
            count += 1
            s = value.get('snapshot')
            if target is None and value.get('state') == 'complete' and select_attempt(s, cfg['baseline']):
                target = s
                report.update(attempt_sha256=s['attempt_sha256'], reason='bound_original_attempt')
            if target is not None and value.get('state') == 'complete':
                if s['applicable'] and HEX.fullmatch(s['attempt_sha256']) and s['attempt_sha256'] != target['attempt_sha256']:
                    # Keep A's fixed deadline and token even when B appears.
                    # The App CAS must reject A's stop against B; never rebind.
                    report['replacement_observed'] = True
                    break
                if confirms_exit(s, target['attempt_sha256']):
                    report.update(exit_confirmed=True, cleanup_pending=False, reason='original_attempt_exited_before_deadline')
                    return
            time.sleep(max(0, min(.4, deadline - 4 - time.monotonic())))
        time.sleep(max(0, deadline - time.monotonic()))
        if target is None:
            return
        # Never renew the original control token or automatically retry cleanup.
        stop = command('stop', target)
        report['stop_sent'] = True  # attempted once; delivery is in the receipt
        result = exchange(folder / 'deadline-stop', cfg, stop, seconds=2)
        report.update(stop_receipt_state=result['state'], reason='stop_requested_exit_unconfirmed')
        end = time.monotonic() + 8
        while time.monotonic() < end:
            value = exchange(folder / ('verify-' + str(count)), cfg, command('status'), seconds=1)
            count += 1
            s = value.get('snapshot')
            if value.get('state') == 'complete' and confirms_exit(s, target['attempt_sha256']):
                report.update(exit_confirmed=True, cleanup_pending=False, exit_evidence=s['exit_evidence'], reason='original_attempt_exit_observed')
                return
            if value.get('state') == 'complete' and s['applicable'] and HEX.fullmatch(s['attempt_sha256']) and s['attempt_sha256'] != target['attempt_sha256']:
                report['reason'] = 'attempt_changed_after_stop'
                return
            time.sleep(.3)
    except Exception as error:
        report['reason'] = 'guard_failure_' + type(error).__name__
    finally:
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        (folder / 'guard-result.json').write_text(json.dumps(report, indent=2), encoding='utf8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'stop', 'cleanup', 'arm', 'guard'))
    parser.add_argument('--device', default='6HQ0226407055391')
    parser.add_argument('--hdc', default=HDC)
    parser.add_argument('--snapshot', type=Path, help='Exact previous receipt; stop/cleanup only')
    parser.add_argument('--seconds', type=int, default=25, choices=range(10, 26))
    parser.add_argument('--job', type=Path)
    args = parser.parse_args()
    if args.action == 'guard':
        if args.job is None:
            parser.error('guard requires a private job')
        run_guard(args.job)
        return
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.device) or args.job is not None:
        parser.error('invalid target')
    if (args.action in ('stop', 'cleanup')) != (args.snapshot is not None):
        parser.error('stop/cleanup require exactly one prior receipt')
    cfg = {'hdc': args.hdc, 'device': args.device}
    transport.note_local_chain(PRIVATE)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    folder = PRIVATE / ('cap-' + uuid.uuid4().hex)
    folder.mkdir()
    if args.action != 'arm':
        s = json.loads(args.snapshot.read_text(encoding='utf-8-sig'))['snapshot'] if args.snapshot else None
        print(json.dumps(exchange(folder / 'request', cfg, command(args.action, s)), ensure_ascii=False))
        return
    value = exchange(folder / 'preflight', cfg, command('status'))
    s = value.get('snapshot')
    if value.get('state') != 'complete' or not snapshot_valid(s) or s['active'] or not s['connected'] or not s['foreground']:
        raise ValueError('guard preflight failed; do not start capture')
    cfg.update(seconds=args.seconds, baseline=s['attempt_sha256'])
    job = folder / 'guard.json'
    job.write_text(json.dumps(cfg), encoding='utf8')
    with (folder / 'guard.log').open('wb') as output:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'guard', '--job', str(job)],
                                   stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    end = time.monotonic() + 5
    while time.monotonic() < end and process.poll() is None:
        if (folder / 'guard.ready').is_file():
            ready = json.loads((folder / 'guard.ready').read_text(encoding='ascii'))
            if time.time() * 1000 >= ready['start_before_ms']:
                raise ValueError('guard readiness is stale; do not start capture')
            print(json.dumps({'ready': True, **ready, 'job': str(job), 'capture_started': False}))
            return
        time.sleep(.05)
    raise ValueError('guard was not armed; do not start capture')


if __name__ == '__main__':
    main()
