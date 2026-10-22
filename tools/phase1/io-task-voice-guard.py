"""Arm one independent stop guard for an already-offered task voice request.

No start, consent, cleanup, cancellation, recovery or answer-submit operation is
exposed. Local readiness is not a promise that HDC or the App will remain live.
All pulled journals and the frozen reply stay under the existing private root.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

spec = importlib.util.spec_from_file_location('task_guard_transport', Path(__file__).with_name('io-card-cli.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
PRIVATE = transport.PRIVATE / 'task-voice-guard'
REMOTE_FILES = transport.REMOTE.rsplit('/', 1)[0]
HDC = 'D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe'
MAX_SAFE = 9007199254740991
HEX = re.compile(r'[a-f0-9]{64}')
VOICE = re.compile(r'voice-[a-f0-9]{32}')
BINDING_KEYS = set('schema context_key operation_id request_id request_revision task_id route expires_at question mode options'.split())
JOURNAL_KEYS = set('schema token auth_epoch handle cancelled stop_requested phase text origin'.split())
HANDLE_KEYS = set('ownerId cleanupId uuid directory peer connectionEpoch'.split())
ORIGIN_KEYS = set('schema name uuid owner_id cleanup_id peer raw_bytes raw_sha256 result_sha256 material_id material_revision exit_evidence'.split())
BOOLS = set('paused capture_active can_recover binding_applicable draft_saved input_sealed tail_timed_out stop_submitted worker_exited capture_metrics_available observation_restored review_ready source_dispatch_started source_delivery_uncertain'.split())
COUNTS = set('request_revision capture_text_length draft_text_length capture_packets pcm_bytes nonzero_packets tail_packets tail_pcm_bytes late_audio_packets compressed_packets compressed_bytes repeated_compressed_packets first_audio_at last_audio_at stop_requested_at input_sealed_at type1_packets first_type1_at mic_write_started_at mic_write_completed_at first_decoded_compressed_bytes first_decoded_samples source_late_packets'.split())
STRINGS = set('request_id task_id operation_id stage cleanup_uid capture_phase exit_evidence attempt_id binding_sha256 capture_text_sha256 draft_text_sha256 recorder_stop exit_write last_compressed_sha256 transcript_status boundary_evidence review_block_reason reply_binding_sha256 source_state source_reason source_attempt_id source_binding_sha256 source_text_sha256'.split())
SNAPSHOT_KEYS = BOOLS | COUNTS | STRINGS | {'exit_reason', 'pcm_rms', 'pcm_peak'}
PHASES = ('idle', 'preparing', 'starting', 'listening', 'stopping', 'transcribing', 'cleanup_pending', 'draft', 'failed', 'blocked', 'unknown')


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('duplicate JSON key')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def units(value):
    return len(value.encode('utf-16-le')) // 2


def text(value, maximum, *, empty=False):
    return isinstance(value, str) and (empty or bool(value)) and units(value) <= maximum


def integer(value, minimum=0, maximum=MAX_SAFE):
    return type(value) is int and minimum <= value <= maximum


def stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)', value):
        raise ValueError('invalid expiry')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('missing expiry zone')
    return parsed.timestamp()


def binding(value):
    if not isinstance(value, dict) or set(value) != BINDING_KEYS or type(value['schema']) is not int or value['schema'] != 1 or \
            not text(value['context_key'], 8192) or not all(text(value[k], 512) for k in ('operation_id', 'request_id', 'task_id')) or \
            not integer(value['request_revision'], 1) or not text(value['question'], 4096) or value['mode'] not in ('choice', 'free_text'):
        raise ValueError('invalid reply binding')
    route = value['route']
    if not isinstance(route, dict) or set(route) != {'computer_id', 'agent_id', 'project_id', 'session_id'} or not all(text(v, 512) for v in route.values()):
        raise ValueError('invalid reply route')
    stamp(value['expires_at'])
    options = value['options']
    if not isinstance(options, list) or len(options) > 4 or any(not isinstance(o, dict) or set(o) != {'option_id', 'label'} or \
            not all(text(v, 512) for v in o.values()) for o in options) or len({o['option_id'] for o in options}) != len(options) or \
            (len(options) != 0 if value['mode'] == 'free_text' else len(options) < 2):
        raise ValueError('invalid reply options')
    return value


def digest(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def peer(value):
    return text(value, 128) and re.search(r'[\x00-\x20\x7f]', value) is None


def journal(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != JOURNAL_KEYS or type(value['schema']) is not int or value['schema'] != 1 or \
            not integer(value['auth_epoch'], 1) or any(type(value[k]) is not bool for k in ('cancelled', 'stop_requested')) or \
            not text(value['text'], 65536, empty=True) or value['phase'] not in ('preparing', 'capturing', 'waiting', 'cleanup_pending', 'complete', 'failed') or \
            not text(value['token'], 2048):
        raise ValueError('invalid capture journal')
    token = strict_json(value['token'])
    if not isinstance(token, dict) or set(token) != {'format', 'attempt_id', 'peer', 'reply'} or token['format'] != 'turboio-task-voice/1' or \
            not isinstance(token['attempt_id'], str) or not VOICE.fullmatch(token['attempt_id']) or not peer(token['peer']):
        raise ValueError('invalid capture token')
    binding(token['reply'])
    handle = value['handle']
    if handle is not None:
        if not isinstance(handle, dict) or set(handle) != HANDLE_KEYS or handle['ownerId'] != token['attempt_id'] or handle['peer'] != token['peer'] or \
                not isinstance(handle['cleanupId'], str) or not re.fullmatch(r'[a-f0-9]{32}', handle['cleanupId']) or \
                not isinstance(handle['uuid'], str) or not re.fullmatch(r'[A-Za-z0-9-]{1,64}', handle['uuid']) or \
                not text(handle['directory'], 1024) or not re.fullmatch(r'.+/recordings/take-[a-f0-9]{32}', handle['directory']) or \
                re.search(r'[\x00-\x1f\x7f\\]', handle['directory']) or re.search(r'(^|/)\.\.?($|/)', handle['directory']) or \
                not integer(handle['connectionEpoch']):
            raise ValueError('invalid capture owner')
    origin = value['origin']
    if origin is not None:
        if not isinstance(origin, dict) or set(origin) != ORIGIN_KEYS or type(origin['schema']) is not int or origin['schema'] != 1 or not handle or \
                origin['name'] != handle['directory'].rsplit('/', 1)[1] or any(origin[a] != handle[b] for a, b in \
                (('uuid', 'uuid'), ('owner_id', 'ownerId'), ('cleanup_id', 'cleanupId'), ('peer', 'peer'))) or \
                not integer(origin['raw_bytes'], 1, 1048576) or origin['raw_bytes'] % 240 or \
                not all(isinstance(origin[k], str) and HEX.fullmatch(origin[k]) for k in ('raw_sha256', 'result_sha256')) or \
                not text(origin['material_id'], 128) or not integer(origin['material_revision'], 1) or origin['exit_evidence'] not in ('device_event', 'user_confirmation'):
            raise ValueError('invalid capture origin')
    if value['phase'] == 'complete' and (not handle or value['cancelled'] or not value['text'].strip() or not origin):
        raise ValueError('invalid complete journal')
    return token


def snapshot(value):
    if not isinstance(value, dict) or set(value) != SNAPSHOT_KEYS or any(type(value[k]) is not bool for k in BOOLS) or \
            any(not integer(value[k]) for k in COUNTS) or any(not text(value[k], 8192, empty=True) for k in STRINGS) or \
            not integer(value['exit_reason'], -1, 65535) or any(type(value[k]) not in (int, float) or not math.isfinite(value[k]) or \
            not 0 <= value[k] <= 32768 for k in ('pcm_rms', 'pcm_peak')):
        raise ValueError('invalid task snapshot')
    if value['capture_phase'] not in PHASES or value['exit_evidence'] not in ('none', 'device_event', 'user_confirmation', 'legacy_record') or \
            any(value[k] not in ('not_attempted', 'pending', 'submitted', 'failed') for k in ('recorder_stop', 'exit_write')) or \
            any(value[k] and not HEX.fullmatch(value[k]) for k in ('binding_sha256', 'capture_text_sha256', 'draft_text_sha256', 'last_compressed_sha256', 'reply_binding_sha256', 'source_binding_sha256', 'source_text_sha256')) or \
            any(value[k] and not VOICE.fullmatch(value[k]) for k in ('attempt_id', 'source_attempt_id')):
        raise ValueError('invalid task snapshot values')
    return value


def matches_request(s, reply):
    return all(s[a] == reply[b] for a, b in (('request_id', 'request_id'), ('request_revision', 'request_revision'), ('task_id', 'task_id'), ('operation_id', 'operation_id')))


def select_target(s, row, reply, baseline):
    snapshot(s)
    token = journal(row)
    if not token or not matches_request(s, reply) or s['paused'] or not s['binding_applicable'] or not s['capture_active'] or \
            s['capture_phase'] not in ('preparing', 'listening') or s['observation_restored'] or s['stage'] != 'voice_authorized' or s['cleanup_uid'] or \
            row['phase'] not in ('preparing', 'capturing') or row['cancelled'] or row['stop_requested'] or not row['handle'] or \
            token['reply'] != reply or token['attempt_id'] == baseline or s['attempt_id'] != token['attempt_id'] or s['binding_sha256'] != digest(row['token']):
        return None
    # Neither numerical epoch is a boot identity. Cold incomplete journals are
    # rejected above by their actual cancelled/cleanup-pending transition.
    return {'binding_sha256': s['binding_sha256'], 'attempt_id': token['attempt_id'], 'auth_epoch': row['auth_epoch'], 'handle': dict(row['handle'])}


def confirms_exit(s, target):
    snapshot(s)
    return s['binding_applicable'] and s['binding_sha256'] == target['binding_sha256'] and s['attempt_id'] == target['attempt_id'] and s['exit_evidence'] == 'device_event'


class Clock:
    wall = staticmethod(time.time)
    mono = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)


def private_read(path, limit):
    transport.note_local_chain(path.parent)
    before = transport.note_local_stat(path)
    if before.st_nlink != 1 or not 0 < before.st_size < limit:
        raise ValueError('private input size or identity')
    raw = path.read_bytes()
    after = transport.note_local_stat(path)
    if len(raw) != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError('private input changed')
    return strict_json(raw.decode('utf-8-sig'))


def durable(path, value):
    transport.note_local_chain(path.parent)
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())


def transfer(cfg, direction, source, target, seconds):
    if seconds <= 0:
        return False
    try:
        result = subprocess.run([cfg['hdc'], '-t', cfg['device'], 'file', direction, '-b', transport.BUNDLE, str(source), str(target)],
                                capture_output=True, timeout=seconds)
        return result.returncode == 0 and b'FileTransfer finish' in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


class Hdc:
    def __init__(self, folder, cfg, clock=None):
        self.folder, self.cfg, self.clock, self.count = folder, cfg, clock or Clock(), 0
        self.last_outcome = {}

    def new_folder(self):
        self.count += 1
        folder = self.folder / ('request-' + str(self.count))
        folder.mkdir(exist_ok=False)
        return folder

    def read(self, name, seconds):
        if name not in ('task-decision-draft.json', 'task-recording-capture.json'):
            raise ValueError('remote read outside whitelist')
        folder = self.new_folder()
        target = folder / name
        if not transfer(self.cfg, 'recv', REMOTE_FILES + '/' + name, target, seconds):
            raise ValueError('private journal unavailable')
        return private_read(target, 262145)

    def exchange(self, action, expected='', seconds=2):
        if action not in ('task-status', 'voice-finish') or (action == 'task-status' and expected) or (action == 'voice-finish' and not HEX.fullmatch(expected)):
            raise ValueError('guard action unavailable')
        end = self.clock.mono() + seconds
        now = datetime.fromtimestamp(self.clock.wall(), timezone.utc)
        command = transport.make_command(action, 'dbg-' + uuid.uuid4().hex, binding_sha256=expected, now=now)
        # Command consumption and host receipt IO are distinct deadlines. A
        # short serial-poll delay must not expire the one stop before the App
        # reads it; the host still spends at most `seconds` on send + receive.
        lifetime = 10 if action == 'voice-finish' else seconds
        command['expires_at'] = (now + timedelta(seconds=lifetime)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        folder = self.new_folder()
        intent = folder / 'command.json'
        durable(intent, command)
        outcome = {'state': 'unknown', 'send_attempted': False, 'transfer_completed': False, 'control_call_completed': False}
        self.last_outcome = outcome
        remaining = end - self.clock.mono()
        if remaining <= 0:
            return outcome
        # Persist before the one ambiguous send. This command is never replayed.
        durable(folder / 'send-attempted.json', {'id': command['id']})
        outcome['send_attempted'] = True
        if not transfer(self.cfg, 'send', intent, transport.REMOTE + '/command.json', end - self.clock.mono()):
            return outcome
        outcome['transfer_completed'] = True
        while self.clock.mono() < end:
            target = folder / ('receipt-' + uuid.uuid4().hex + '.json')
            if transfer(self.cfg, 'recv', transport.REMOTE + '/' + command['id'] + '.json', target, end - self.clock.mono()):
                value = private_read(target, 65537)
                keys = {'schema', 'id', 'request_json', 'state', 'started_at', 'finished_at', 'error', 'snapshot', 'control_call_completed'}
                if not isinstance(value, dict) or set(value) not in (keys, keys | {'task_snapshot'}) or type(value['schema']) is not int or value['schema'] != 1 or \
                        value['id'] != command['id'] or not isinstance(value['request_json'], str) or strict_json(value['request_json']) != command or \
                        value['state'] not in ('running', 'complete', 'error') or type(value['control_call_completed']) is not bool or \
                        not isinstance(value['error'], str) or not re.fullmatch(r'[A-Z0-9_]{0,160}', value['error']):
                    raise ValueError('invalid task receipt')
                if value.get('task_snapshot') is not None:
                    snapshot(value['task_snapshot'])
                elif value['state'] == 'complete':
                    raise ValueError('missing completed task snapshot')
                if value['state'] != 'running':
                    outcome.update(state=value['state'], control_call_completed=value['control_call_completed'], task_snapshot=value.get('task_snapshot'))
                    return outcome
            self.clock.sleep(max(0, min(.1, end - self.clock.mono())))
        return outcome


def check_draft(row, reply):
    keys = set('schema binding plan stage cleanup_uid cleanup_peer card_stage used_uids option_id text input_source'.split())
    if not isinstance(row, dict) or type(row.get('schema')) is not int or row['schema'] not in (1, 2) or \
            set(row) != (keys if row['schema'] == 1 else keys | {'voice_source'}) or row['binding'] != reply or \
            row['stage'] not in ('proposal', 'supplement_offer'):
        raise ValueError('original offered task unavailable')
    binding(row['binding'])


class Guard:
    def __init__(self, api, reply, clock=None):
        self.api, self.reply, self.clock = api, binding(reply), clock or Clock()

    def status(self, seconds):
        value = self.api.exchange('task-status', seconds=seconds)
        if value['state'] != 'complete':
            raise ValueError('fresh status unavailable')
        return snapshot(value.get('task_snapshot'))

    def run(self, ready, heartbeat=lambda: None, before_stop=lambda target: None):
        start = self.clock.mono()
        expiry = stamp(self.reply['expires_at'])
        if not 0 < expiry - self.clock.wall() <= 300:
            raise ValueError('question must expire within 300 seconds')
        # A missing original task is rejected using recv only, before even a
        # passive status command is written to the phone.
        check_draft(self.api.read('task-decision-draft.json', 2), self.reply)
        journal_unavailable = False
        try:
            row = self.api.read('task-recording-capture.json', 2)
        except (ValueError, OSError):
            row, journal_unavailable = None, True
        old = journal(row)
        baseline = old['attempt_id'] if old else ''
        s = self.status(2)
        if not matches_request(s, self.reply) or s['paused'] or s['capture_active'] or s['stage'] not in ('proposal', 'supplement_offer'):
            raise ValueError('task not available for guarded consent')
        if journal_unavailable and (s['capture_phase'] != 'idle' or s['binding_sha256'] or s['attempt_id'] or s['binding_applicable']):
            raise ValueError('capture baseline unverifiable')
        check_draft(self.api.read('task-decision-draft.json', 2), self.reply)
        remaining = expiry - self.clock.wall()
        if not 0 < remaining <= 300:
            raise ValueError('question expired during preflight')
        wait_end = self.clock.mono() + remaining + 3
        report = dict(ready=True, bound=False, stop_attempted=False, stop_send_attempted=False, stop_transfer_completed=False,
                      control_call_completed=False, exit_confirmed=False, stop_replayed=False, reason='no_new_bound_attempt')
        target, deadline = None, None
        ready()
        while self.clock.mono() < (deadline if target else wait_end):
            heartbeat()
            end = deadline if target else wait_end
            budget = min(1.5, end - self.clock.mono())
            if budget <= 0:
                break
            try:
                s = self.status(budget)
                if target:
                    if confirms_exit(s, target):
                        report.update(exit_confirmed=True, reason='original_device_event_observed')
                        break
                    if s['binding_applicable'] and s['binding_sha256'] and s['binding_sha256'] != target['binding_sha256']:
                        report['replacement_observed'] = True
                elif self.clock.wall() < expiry and s['capture_active']:
                    row = self.api.read('task-recording-capture.json', min(.75, max(0, wait_end - self.clock.mono())))
                    selected = select_target(s, row, self.reply, baseline)
                    if selected:
                        # Recheck the exact status after the private journal read.
                        latest = self.status(min(1.5, max(0, wait_end - self.clock.mono())))
                        selected = select_target(latest, row, self.reply, baseline)
                        if selected and self.clock.wall() < expiry:
                            target, deadline = selected, self.clock.mono() + 20
                            report.update(bound=True, binding_sha256=target['binding_sha256'], reason='original_attempt_bound')
            except (ValueError, OSError, KeyError, UnicodeError):
                report['observation_failed'] = True
            self.clock.sleep(max(0, min(.4, (deadline if target else wait_end) - self.clock.mono())))
        if target and not report['exit_confirmed']:
            # An unreadable observation or B replacing A cannot disarm A's
            # fixed deadline. Only the original opaque CAS is sent, once.
            before_stop(target)
            report['stop_attempted'] = True
            terminal_receipt = False
            try:
                result = self.api.exchange('voice-finish', target['binding_sha256'], seconds=2)
                terminal_receipt = result['state'] in ('complete', 'error')
                report.update(stop_send_attempted=result.get('send_attempted', False), stop_transfer_completed=result.get('transfer_completed', False),
                              control_call_completed=result.get('control_call_completed', False), stop_receipt_state=result['state'], reason='stop_requested_exit_unconfirmed')
                if terminal_receipt and result.get('task_snapshot') is not None and confirms_exit(result['task_snapshot'], target):
                    report.update(exit_confirmed=True, reason='original_device_event_observed')
            except (ValueError, OSError, KeyError, UnicodeError):
                report['reason'] = 'stop_receipt_unverifiable_no_replay'
                attempted = getattr(self.api, 'last_outcome', {})
                report.update(stop_send_attempted=attempted.get('send_attempted', False), stop_transfer_completed=attempted.get('transfer_completed', False))
            if not terminal_receipt:
                # The stop may still be waiting in the shared command.json.
                # Even a read-only task-status would overwrite it. Leave that
                # inbox untouched; no replay or implicit cleanup is allowed.
                report['reason'] = 'stop_receipt_unknown_inbox_preserved'
            verify_end = self.clock.mono() + 6
            while terminal_receipt and not report['exit_confirmed'] and self.clock.mono() < verify_end:
                heartbeat()
                try:
                    if confirms_exit(self.status(min(1.5, verify_end - self.clock.mono())), target):
                        report.update(exit_confirmed=True, reason='original_device_event_observed')
                except (ValueError, OSError, KeyError, UnicodeError):
                    report['observation_failed'] = True
                self.clock.sleep(max(0, min(.4, verify_end - self.clock.mono())))
        report['elapsed_seconds'] = round(self.clock.mono() - start, 3)
        return report


def job_read(path):
    transport.note_local_chain(path.parent)
    path = path.resolve(strict=True)
    if path.name != 'guard.json' or not path.is_relative_to(PRIVATE.resolve()):
        raise ValueError('guard job outside private root')
    cfg = private_read(path, 65536)
    if not isinstance(cfg, dict) or set(cfg) != {'schema', 'nonce', 'hdc', 'device', 'reply'} or type(cfg['schema']) is not int or cfg['schema'] != 1 or \
            not isinstance(cfg['nonce'], str) or not re.fullmatch(r'[a-f0-9]{32}', cfg['nonce']) or not isinstance(cfg['hdc'], str) or not cfg['hdc'] or \
            not isinstance(cfg['device'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', cfg['device']):
        raise ValueError('invalid guard job')
    binding(cfg['reply'])
    return path, cfg


def heartbeat_file(folder, nonce):
    temporary = folder / 'heartbeat.partial'
    if temporary.exists():
        raise ValueError('heartbeat pending')
    durable(temporary, {'pid': os.getpid(), 'nonce': nonce, 'at': time.time()})
    os.replace(temporary, folder / 'heartbeat.json')


def child(job):
    job, cfg = job_read(job)
    with transport.note_local_lock('task-voice-guard-' + cfg['device']):
        # A crashed/restarted guard never replays its old stop command.
        durable(job.parent / 'guard.started', {'pid': os.getpid(), 'nonce': cfg['nonce']})
        try:
            def ready():
                heartbeat_file(job.parent, cfg['nonce'])
                durable(job.parent / 'guard.ready', {'pid': os.getpid(), 'nonce': cfg['nonce'], 'expires_at': cfg['reply']['expires_at']})
            result = Guard(Hdc(job.parent, cfg), cfg['reply']).run(ready, lambda: heartbeat_file(job.parent, cfg['nonce']),
                lambda target: durable(job.parent / 'stop-once.json', {'binding_sha256': target['binding_sha256']}))
        except Exception as error:
            # Exception text may contain private task fields; retain only type.
            result = {'ready': False, 'reason': 'guard_failed_' + type(error).__name__, 'exit_confirmed': False}
        durable(job.parent / 'guard-result.json', result)
        return result


def process_alive(pid):
    if not integer(pid, 1):
        return False
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            return bool(kernel.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def live(job):
    job, cfg = job_read(job)
    ready = private_read(job.parent / 'guard.ready', 4096)
    beat = private_read(job.parent / 'heartbeat.json', 4096)
    return set(ready) == {'pid', 'nonce', 'expires_at'} and set(beat) == {'pid', 'nonce', 'at'} and \
        ready['nonce'] == beat['nonce'] == cfg['nonce'] and ready['pid'] == beat['pid'] and process_alive(ready['pid']) and \
        type(beat['at']) in (int, float) and math.isfinite(beat['at']) and 0 <= time.time() - beat['at'] <= 4 and \
        not (job.parent / 'guard-result.json').exists() and ready['expires_at'] == cfg['reply']['expires_at'] and \
        0 < stamp(ready['expires_at']) - time.time() <= 300


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('arm', 'check', 'guard'))
    parser.add_argument('--reply-file', type=Path)
    parser.add_argument('--device', default='')
    parser.add_argument('--hdc', default=HDC)
    parser.add_argument('--job', type=Path)
    args = parser.parse_args()
    if args.action in ('check', 'guard'):
        if args.job is None or args.reply_file is not None or args.device:
            parser.error('check/guard require only a private --job')
        if args.action == 'guard':
            child(args.job)
        else:
            active = live(args.job)
            print(json.dumps({'ready': active, 'live': active, 'capture_started': False}))
            return 0 if active else 2
        return 0
    if args.job is not None or args.reply_file is None or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.device):
        parser.error('arm requires explicit --device and --reply-file')
    path = args.reply_file.absolute()
    if not path.resolve(strict=True).is_relative_to(transport.PRIVATE.resolve()):
        raise ValueError('reply file must be under existing private root')
    supplied = private_read(path, 65536)
    reply = binding(supplied.get('binding') if isinstance(supplied, dict) and 'binding' in supplied else supplied)
    if not 0 < stamp(reply['expires_at']) - time.time() <= 300:
        raise ValueError('question must expire within 300 seconds')
    transport.note_local_chain(PRIVATE)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    folder = PRIVATE / ('guard-' + uuid.uuid4().hex)
    folder.mkdir()
    job = folder / 'guard.json'
    durable(job, {'schema': 1, 'nonce': uuid.uuid4().hex, 'hdc': args.hdc, 'device': args.device, 'reply': reply})
    with (folder / 'guard.log').open('xb') as output:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'guard', '--job', str(job)],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    end = time.monotonic() + 12
    while time.monotonic() < end and process.poll() is None:
        if (folder / 'guard.ready').is_file() and live(job) and process.poll() is None:
            print(json.dumps({'ready': True, 'pid': process.pid, 'job': str(job), 'capture_started': False,
                              'expires_at': reply['expires_at'], 'bound_deadline_seconds': 20, 'requires_live_check_before_consent': True}))
            return 0
        time.sleep(.05)
    print(json.dumps({'ready': False, 'job': str(job), 'capture_started': False, 'reason': 'preflight_or_child_failed_do_not_authorize'}))
    return 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, UnicodeError, KeyError) as error:
        print(json.dumps({'ready': False, 'error': type(error).__name__, 'capture_started': False}))
        sys.exit(2)
