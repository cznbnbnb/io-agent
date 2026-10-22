"""HDC -> debug App private inbox. Never taps UI or opens another BLE connection.

search-local is read-only and returns sensitive local canonical excerpts on an
explicit query. Partial coverage and unindexed legacy files remain explicit.
list-summaries returns metadata; read-summary explicitly returns one UTF16 chunk
of a source-verified saved Markdown file. It never generates a new summary.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager, ExitStack
from datetime import date, datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'rebuild/phase1/device-private/card-cli'
REMOTE = 'data/storage/el2/base/haps/entry/files/io-debug'
BUNDLE = 'org.turboio.harmony.research'
TASK_ACTIONS = ('task-status', 'voice-finish', 'voice-cancel', 'voice-recover')
REVIEW_ACTION = 'review-card'
RECOVERY_ACTIONS = ('recovery-status', 'recovery-restore')
LOCAL_ACTION = 'search-local'
SCAN_ACTION = 'scan-local'
SUMMARY_ACTIONS = ('list-summaries', 'read-summary')
NOTE_WRITES = ('save-summary-note', 'resume-summary-note')
NOTE_ACTIONS = (*NOTE_WRITES, 'summary-note-status', 'list-summary-notes', 'read-summary-note', 'read-summary-note-pending')
PLAYBACK_ACTIONS = ('playback-play', 'playback-status', 'playback-pause', 'playback-resume', 'playback-seek', 'playback-stop')
RECORDING_ACTIONS = tuple('recording-summary-' + action for action in ('preview','start','status','cancel','resume','list','read','citation'))
RECORDING_ERRORS = tuple('RECORDING_SUMMARY_' + code for code in ('INVALID','LIMIT','STALE','BLOCKED','BUSY','NOT_FOREGROUND','CONFIG_CHANGED','WRITE_FAILED','NOT_READY','RESPONSE_INVALID'))
TODO_ACTIONS = ('todo-list','todo-delete','todo-delete-status','todo-delete-cancel','todo-delete-send','todo-query','todo-query-status')
TODO_ERRORS = tuple('TODO_' + code for code in ('INVALID','STALE','BLOCKED','BUSY','WRONG_PEER','NOT_FOREGROUND','ALREADY_SENT','LIMIT','NOT_FOUND','FAILED'))
PLAYBACK_ERRORS = ('PLAYBACK_INVALID', 'PLAYBACK_UNAVAILABLE', 'PLAYBACK_SOURCE_CHANGED', 'PLAYBACK_STALE_SESSION', 'PLAYBACK_BUSY',
                   'PLAYBACK_NOT_FOREGROUND', 'PLAYBACK_PLAYER_FAILED', 'PLAYBACK_CLEANUP_PENDING', 'PLAYBACK_IN_USE',
                   'PLAYBACK_SOURCE_UNAVAILABLE', 'PLAYBACK_INCOMPLETE', 'PLAYBACK_DELETED', 'PLAYBACK_ANCHOR_STALE', 'PLAYBACK_TIME_UNKNOWN')
MAX_RESULT_BYTES = 65536
JS_TRIM = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def playback_session_valid(value, *, empty=False):
    return isinstance(value, str) and (empty and value == '' or re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value) is not None)


def playback_selection_valid(value):
    if not isinstance(value, dict) or set(value) != {'kind', 'name', 'revision', 'utterance_id'} or value['kind'] not in ('recording', 'lifelog') or \
            not isinstance(value['name'], str) or not re.fullmatch(('take-' if value['kind'] == 'recording' else 'seg-') + r'[a-f0-9]{32}', value['name']) or \
            type(value['revision']) is not int or not 0 <= value['revision'] <= 999999999 or not isinstance(value['utterance_id'], str):
        return False
    utterance = value['utterance_id']
    try:
        size = len(utterance.encode('utf-16-le')) // 2
    except UnicodeError:
        return False
    return size <= 256 and re.search(r'[\x00-\x1f\x7f-\x9f]', utterance) is None and (value['revision'] == 0) == (utterance == '')


def validate_playback_selection(action, value):
    if not isinstance(value, dict):
        raise ValueError('invalid playback selection')
    if action == 'playback-play':
        valid = playback_selection_valid(value)
    elif action == 'playback-status':
        valid = not value
    elif action in ('playback-pause', 'playback-resume', 'playback-stop'):
        valid = set(value) == {'session_id'} and playback_session_valid(value['session_id'])
    elif action == 'playback-seek':
        valid = set(value) == {'session_id', 'position_ms'} and playback_session_valid(value['session_id']) and \
            type(value['position_ms']) is int and 0 <= value['position_ms'] <= 86400000
    else:
        valid = False
    if not valid:
        raise ValueError('invalid playback selection')
    return dict(value)


def validate_playback_result(command, snapshot, state):
    validate_playback_selection(command['action'], command.get('playback'))
    if snapshot is None:
        if state == 'complete':
            raise ValueError('missing playback snapshot')
        return
    keys = {'schema', 'session_id', 'phase', 'position_ms', 'position_known', 'duration_ms', 'duration_known', 'native_state', 'callback_seq', 'error', 'note', 'audio_output_verified'}
    if not isinstance(snapshot, dict) or set(snapshot) not in (keys, keys | {'source'}) or type(snapshot['schema']) is not int or snapshot['schema'] != 1 or \
            not playback_session_valid(snapshot['session_id'], empty=True) or snapshot['phase'] not in ('idle','loading','playing','paused','seeking','ended','stopping','blocked','error') or \
            snapshot['native_state'] not in ('','idle','initialized','prepared','playing','paused','stopped','completed','released','error') or \
            any(type(snapshot[key]) is not int or not 0 <= snapshot[key] <= 9007199254740991 for key in ('position_ms','duration_ms','callback_seq')) or \
            any(type(snapshot[key]) is not bool for key in ('position_known','duration_known')) or snapshot['audio_output_verified'] is not False or \
            snapshot['error'] not in ('', *PLAYBACK_ERRORS) or not isinstance(snapshot['note'], str) or len(snapshot['note']) > 512 or re.search(r'[\x00-\x1f\x7f-\x9f]', snapshot['note']):
        raise ValueError('unexpected playback snapshot')
    try:
        snapshot['note'].encode('utf-8')
    except UnicodeError:
        raise ValueError('unexpected playback note') from None
    source = snapshot.get('source')
    if source is not None:
        if not isinstance(source, dict) or set(source) != {'kind','name','audio_sha256','format','revision','utterance_id'} or \
                not playback_selection_valid({key: source[key] for key in ('kind','name','revision','utterance_id')}) or \
                not isinstance(source['audio_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', source['audio_sha256']) or source['format'] not in ('wav','ogg'):
            raise ValueError('unexpected playback source')
    elif 'source' in snapshot:
        raise ValueError('unexpected empty playback source')


def summary_day_valid(value):
    if not isinstance(value, str) or not re.fullmatch(r'(19[7-9][0-9]|[2-9][0-9]{3})-[0-9]{2}-[0-9]{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def summary_cursor_valid(value):
    return isinstance(value, str) and (not value or len(value) <= 81 and
            re.fullmatch(r'[a-f0-9]{64}:(0|[1-9][0-9]*)', value) and int(value.split(':')[1]) <= 9007199254740991)


def summary_ref_valid(value, *, allow_empty_hash=False):
    return isinstance(value, dict) and set(value) == {'day', 'summary_id', 'content_sha256'} and summary_day_valid(value['day']) and \
        isinstance(value['summary_id'], str) and re.fullmatch(r'saved-' + value['day'] + r'-(cache|[a-f0-9]{64})', value['summary_id']) and \
        isinstance(value['content_sha256'], str) and (allow_empty_hash and not value['content_sha256'] or re.fullmatch(r'[a-f0-9]{64}', value['content_sha256']))


def validate_saved_summary(action, value):
    if not isinstance(value, dict) or not summary_day_valid(value.get('day')):
        raise ValueError('invalid saved summary selection')
    if action == 'list-summaries':
        if set(value) != {'day', 'limit', 'cursor'} or type(value['limit']) is not int or not 1 <= value['limit'] <= 10 or not summary_cursor_valid(value['cursor']):
            raise ValueError('invalid saved summary list filter')
    elif action == 'read-summary':
        ref = {key: value.get(key) for key in ['day', 'summary_id', 'content_sha256']}
        if set(value) != {'day', 'summary_id', 'content_sha256', 'offset', 'max_chars'} or not summary_ref_valid(ref) or \
                type(value['offset']) is not int or not 0 <= value['offset'] <= 2097152 or type(value['max_chars']) is not int or not 2 <= value['max_chars'] <= 4000:
            raise ValueError('invalid saved summary reference or chunk bounds')
    else:
        raise ValueError('saved summary selection requires list-summaries or read-summary')
    return dict(value)


def validate_saved_result(command, page, chunk, state):
    action = command.get('action')
    selection = validate_saved_summary(action, command.get('saved_summary'))
    if state != 'complete':
        if page is not None or chunk is not None:
            raise ValueError('unexpected saved summary error payload')
        return
    if action == 'list-summaries':
        keys = {'schema', 'scope', 'day', 'items', 'next_cursor', 'has_more', 'snapshot_sha256', 'scanned', 'unreadable', 'incomplete', 'incomplete_reason'}
        entry_keys = {'reference', 'file_kind', 'bytes', 'state', 'source_sha256', 'can_open', 'producer', 'generated_at'}
        if chunk is not None or not isinstance(page, dict) or set(page) != keys or type(page['schema']) is not int or page['schema'] != 1 or page['scope'] != 'local_saved_journals' or \
                page['day'] != selection['day'] or not isinstance(page['items'], list) or len(page['items']) > selection['limit'] or \
                not summary_cursor_valid(page['next_cursor']) or type(page['has_more']) is not bool or bool(page['next_cursor']) != page['has_more'] or \
                not isinstance(page['snapshot_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', page['snapshot_sha256']) or \
                any(type(page[key]) is not int or page[key] < 0 for key in ['scanned', 'unreadable']) or type(page['incomplete']) is not bool or \
                page['incomplete_reason'] not in ('', 'scan_limit', 'text_limit', 'unreadable', 'source_unavailable'):
            raise ValueError('unexpected saved summary metadata page')
        for entry in page['items']:
            if not isinstance(entry, dict) or set(entry) != entry_keys or not summary_ref_valid(entry.get('reference'), allow_empty_hash=True) or entry['reference']['day'] != selection['day'] or \
                    entry['file_kind'] not in ('day_cache', 'snapshot') or entry['state'] not in ('current', 'stale', 'unverifiable', 'not_summary', 'corrupt', 'unreadable', 'source_unavailable') or \
                    type(entry['bytes']) is not int or entry['bytes'] < 0 or type(entry['can_open']) is not bool or entry['can_open'] != (entry['state'] == 'current') or \
                    not isinstance(entry['source_sha256'], str) or entry['source_sha256'] and not re.fullmatch(r'[a-f0-9]{64}', entry['source_sha256']) or \
                    not isinstance(entry['producer'], str) or not isinstance(entry['generated_at'], str) or entry['can_open'] and not summary_ref_valid(entry['reference']):
                raise ValueError('unexpected saved summary metadata entry')
    else:
        keys = {'schema', 'reference', 'source_sha256', 'markdown', 'offset', 'next_offset', 'total_utf16', 'has_more'}
        expected = {key: selection[key] for key in ['day', 'summary_id', 'content_sha256']}
        if page is not None or not isinstance(chunk, dict) or set(chunk) != keys or type(chunk['schema']) is not int or chunk['schema'] != 1 or chunk['reference'] != expected or \
                not isinstance(chunk['source_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', chunk['source_sha256']) or not isinstance(chunk['markdown'], str) or \
                any(type(chunk[key]) is not int or not 0 <= chunk[key] <= 2097152 for key in ['offset', 'next_offset', 'total_utf16']) or \
                chunk['offset'] != selection['offset'] or type(chunk['has_more']) is not bool:
            raise ValueError('unexpected saved summary chunk binding')
        length = len(chunk['markdown'].encode('utf-16-le')) // 2
        if length > selection['max_chars'] or chunk['next_offset'] != chunk['offset'] + length or chunk['next_offset'] > chunk['total_utf16'] or \
                chunk['has_more'] != (chunk['next_offset'] < chunk['total_utf16']) or not length and chunk['has_more']:
            raise ValueError('unexpected saved summary chunk progress')


def note_operation_valid(value):
    return isinstance(value, str) and re.fullmatch(r'noteop-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{32}', value) and summary_day_valid(value[7:17])


def note_ref_valid(value):
    return isinstance(value, dict) and set(value) == {'day', 'note_id', 'content_sha256'} and summary_day_valid(value['day']) and \
        isinstance(value['note_id'], str) and re.fullmatch(r'note-' + value['day'] + r'-[a-f0-9]{32}', value['note_id']) and \
        isinstance(value['content_sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', value['content_sha256'])


def note_created_valid(value):
    if value == '':
        return True
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z', value):
        return False
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.isoformat(timespec='milliseconds').replace('+00:00', 'Z') == value
    except ValueError:
        return False


def validate_note_selection(action, value):
    if not isinstance(value, dict):
        raise ValueError('invalid note selection')
    if action in (*NOTE_WRITES, 'summary-note-status', 'read-summary-note-pending'):
        keys = {'operation_id', 'body_sha256'} if action in NOTE_WRITES else {'operation_id', 'input_sha256'} if action == 'read-summary-note-pending' else {'operation_id'}
        if set(value) != keys or not note_operation_valid(value.get('operation_id')) or any(not isinstance(value[key], str) or not re.fullmatch(r'[a-f0-9]{64}', value[key]) for key in keys - {'operation_id'}):
            raise ValueError('invalid note operation or hash')
    elif action == 'list-summary-notes':
        validate_saved_summary('list-summaries', value)
    elif action == 'read-summary-note':
        ref = {key: value.get(key) for key in ['day', 'note_id', 'content_sha256']}
        if set(value) != {'day', 'note_id', 'content_sha256', 'format', 'offset', 'max_chars'} or not note_ref_valid(ref) or value['format'] not in ('md', 'json') or \
                type(value['offset']) is not int or not 0 <= value['offset'] <= 8388608 or type(value['max_chars']) is not int or not 2 <= value['max_chars'] <= 4000:
            raise ValueError('invalid note reference or chunk bounds')
    else:
        raise ValueError('note selection requires a note action')
    return dict(value)


def validate_note_input(value):
    if not isinstance(value, dict) or set(value) not in ({'operation_id', 'parent', 'source_sha256', 'text'}, {'operation_id', 'parent', 'source_sha256', 'text', 'previous'}) or \
            not note_operation_valid(value.get('operation_id')) or not summary_ref_valid(value.get('parent')) or value['operation_id'][7:17] != value['parent']['day'] or \
            not isinstance(value.get('source_sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', value['source_sha256']) or not isinstance(value.get('text'), str) or not value['text'].strip(JS_TRIM):
        raise ValueError('invalid note input')
    if len(value['text'].encode('utf-16-le')) // 2 > 8192:
        raise ValueError('note exceeds 8192 UTF16 units')
    if 'previous' in value and (not note_ref_valid(value['previous']) or value['previous']['day'] != value['parent']['day']):
        raise ValueError('invalid previous note reference')
    parent = {key: value['parent'][key] for key in ['day', 'summary_id', 'content_sha256']}
    normalized = {'operation_id': value['operation_id'], 'parent': parent, 'source_sha256': value['source_sha256'], 'text': value['text']}
    if 'previous' in value:
        normalized['previous'] = {key: value['previous'][key] for key in ['day', 'note_id', 'content_sha256']}
    if len(note_input_bytes(normalized)) > 65536:
        raise ValueError('note input exceeds bounded attachment size')
    return normalized


def note_input_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def note_local_stat(path, *, directory=False):
    item = path.lstat()
    if path.is_symlink() or getattr(item, 'st_file_attributes', 0) & 0x400 or (not path.is_dir() if directory else not path.is_file()):
        raise ValueError('local note staging identity unavailable')
    return item


def note_local_chain(path):
    for item in [path, *path.parents]:
        try:
            note_local_stat(item, directory=True)
        except FileNotFoundError:
            continue


@contextmanager
def note_local_lock(device, *, create=True):
    root = PRIVATE / device
    note_local_chain(root)
    if create:
        root.mkdir(parents=True, exist_ok=True)
    note_local_stat(root, directory=True)
    lock_path = root / '.note-staging.lock'
    try:
        stat = note_local_stat(lock_path)
        if stat.st_size > 1 or stat.st_nlink != 1:
            raise ValueError('local note staging lock unavailable')
    except FileNotFoundError:
        pass
    stream = lock_path.open('a+b')
    locked = False
    try:
        if os.fstat(stream.fileno()).st_nlink != 1:
            raise ValueError('local note staging lock unavailable')
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError:
            raise ValueError('local note staging is busy; no upload attempted') from None
        if os.fstat(stream.fileno()).st_size > 1:
            raise ValueError('local note staging lock unavailable')
        if os.fstat(stream.fileno()).st_size == 0:
            stream.write(b'\0')
            stream.flush()
            os.fsync(stream.fileno())
        yield root
    finally:
        if locked:
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        stream.close()


def note_local_json(path, limit):
    stat = note_local_stat(path)
    if not 0 < stat.st_size <= limit:
        raise ValueError('local note staging evidence unavailable')
    data = path.read_bytes()
    if len(data) != stat.st_size:
        raise ValueError('local note staging evidence changed')
    return json.loads(data.decode('utf-8-sig'))


def note_staging_capacity(root, incoming_bytes):
    count, total, seen = 0, 0, 0
    with os.scandir(root) as entries:
        for entry in entries:
            seen += 1
            if seen > 4096:
                raise ValueError('local note staging inventory exceeds scan bound')
            if not re.fullmatch(r'dbg-[a-f0-9]{32}', entry.name):
                continue
            folder = root / entry.name
            note_local_stat(folder, directory=True)
            body_path, intent = folder / 'annotation.json', folder / 'command.json'
            body_exists = body_path.exists() or body_path.is_symlink()
            if not intent.exists():
                if body_exists:
                    raise ValueError('unknown local note attachment retained; inspect staging')
                continue
            command = note_local_json(intent, 2048)
            if not isinstance(command, dict):
                raise ValueError('local command evidence unavailable')
            is_note = command.get('schema') == 7 and command.get('action') in NOTE_WRITES
            if not body_exists and not is_note:
                continue
            if not is_note or command.get('id') != entry.name or command.get('expected_uid') != '' or set(command) != {'schema','id','action','created_at','expires_at','expected_uid','annotation'}:
                raise ValueError('unknown local note attachment retained; inspect staging')
            validate_note_selection(command['action'], command.get('annotation'))
            terminal = False
            receipt_path = folder / 'result.json'
            if receipt_path.exists():
                receipt = note_local_json(receipt_path, MAX_RESULT_BYTES)
                if receipt.get('schema') != 1 or receipt.get('id') != entry.name or json.loads(receipt.get('request_json', 'null')) != command or receipt.get('state') not in ('running','complete','error'):
                    raise ValueError('local note receipt evidence unavailable')
                terminal = receipt['state'] in ('complete','error')
                if terminal:
                    validate_note_result(command, *[receipt.get(key) for key in ['summary_note_receipt','summary_notes','summary_note_chunk','summary_note_pending']], receipt['state'])
            if not body_exists:
                if not terminal:
                    raise ValueError('unresolved local note attachment missing; inspect staging')
                continue
            stat = note_local_stat(body_path)
            if not 0 < stat.st_size <= 65536 or stat.st_nlink != 1:
                raise ValueError('local note attachment identity unavailable')
            raw = body_path.read_bytes()
            if len(raw) != stat.st_size or hashlib.sha256(raw).hexdigest() != command['annotation']['body_sha256']:
                raise ValueError('local note attachment hash unavailable')
            body = validate_note_input(json.loads(raw.decode('utf-8')))
            if body['operation_id'] != command['annotation']['operation_id']:
                raise ValueError('local note attachment binding unavailable')
            count += 1
            total += len(raw)
            if count >= 128 or total + incoming_bytes > 8388608:
                raise ValueError('local note staging full; retained inputs require reconciliation')
    if total + incoming_bytes > 8388608:
        raise ValueError('local note staging full; retained inputs require reconciliation')


def cleanup_local_note(folder, command, result):
    if command.get('schema') != 7 or command.get('action') not in NOTE_WRITES or result.get('state') != 'complete':
        return
    saved = result.get('summary_note_receipt')
    if not isinstance(saved, dict) or saved.get('state') != 'saved' or saved.get('operation_id') != command['annotation']['operation_id']:
        return  # Error/pending/unknown may be the only remaining complete input.
    validate_note_result(command, saved, None, None, None, 'complete')
    note_local_chain(folder)
    if folder.name != command['id']:
        return
    receipt_path = folder / 'result.json'
    if note_local_json(receipt_path, MAX_RESULT_BYTES) != result:
        return
    # Persist the already validated terminal receipt without truncating it.
    with receipt_path.open('r+b') as stream:
        stream.flush()
        os.fsync(stream.fileno())
    if note_local_json(receipt_path, MAX_RESULT_BYTES) != result:
        return
    path = folder / 'annotation.json'
    if not path.exists():
        return
    stat = note_local_stat(path)
    if stat.st_nlink != 1 or not 0 < stat.st_size <= 65536:
        return
    raw = path.read_bytes()
    if len(raw) != stat.st_size or hashlib.sha256(raw).hexdigest() != command['annotation']['body_sha256']:
        return
    body = validate_note_input(json.loads(raw.decode('utf-8')))
    if body['operation_id'] != saved['operation_id'] or hashlib.sha256(note_input_bytes(body)).hexdigest() != saved['input_sha256'] or body['source_sha256'] != saved['source_sha256'] or \
            not note_ref_valid(saved.get('reference')) or saved['reference']['note_id'] != 'note-' + saved['operation_id'][7:]:
        return
    if note_saved_state(saved) is True:
        path.unlink()


def note_saved_state(receipt):
    if isinstance(receipt, dict):
        if receipt.get('state') == 'saved':
            return True
        if receipt.get('state') in ('missing','reserved','pending','stale'):
            return False
    return None


def validate_note_result(command, receipt, page, chunk, pending, state):
    action = command['action']
    selection = validate_note_selection(action, command.get('annotation'))
    values = [receipt, page, chunk, pending]
    if state != 'complete':
        if any(value is not None for value in values):
            raise ValueError('unexpected note error payload')
        return
    if action == 'read-summary-note-pending':
        if any(value is not None for value in values[:3]):
            raise ValueError('unexpected note pending data')
        valid = validate_note_input(pending)
        if valid['operation_id'] != selection['operation_id'] or hashlib.sha256(note_input_bytes(valid)).hexdigest() != selection['input_sha256']:
            raise ValueError('unexpected note pending binding')
    elif action in (*NOTE_WRITES, 'summary-note-status'):
        keys = {'schema', 'operation_id', 'state', 'input_sha256', 'reference', 'source_sha256', 'can_open', 'replayed', 'note', 'created_at'}
        required = keys - {'reference'}
        if any(value is not None for value in values[1:]) or not isinstance(receipt, dict) or not required.issubset(receipt) or not set(receipt).issubset(keys) or \
                type(receipt['schema']) is not int or receipt['schema'] != 1 or receipt['operation_id'] != selection['operation_id'] or \
                receipt['state'] not in ('missing', 'reserved', 'pending', 'saved', 'stale', 'corrupt', 'blocked') or type(receipt['can_open']) is not bool or type(receipt['replayed']) is not bool or \
                not isinstance(receipt['note'], str) or len(receipt['note']) > 256 or not note_created_valid(receipt['created_at']):
            raise ValueError('unexpected note receipt')
        for key in ['input_sha256', 'source_sha256']:
            if not isinstance(receipt[key], str) or receipt[key] and not re.fullmatch(r'[a-f0-9]{64}', receipt[key]):
                raise ValueError('unexpected note receipt hash')
        if receipt.get('reference') is not None and (not note_ref_valid(receipt['reference']) or receipt['reference']['day'] != selection['operation_id'][7:17]):
            raise ValueError('unexpected note receipt reference')
    elif action == 'list-summary-notes':
        keys = {'schema', 'scope', 'day', 'items', 'next_cursor', 'has_more', 'snapshot_sha256', 'scanned', 'incomplete', 'incomplete_reason'}
        if receipt is not None or chunk is not None or pending is not None or not isinstance(page, dict) or set(page) != keys or type(page['schema']) is not int or page['schema'] != 1 or page['scope'] != 'local_summary_notes' or \
                page['day'] != selection['day'] or not isinstance(page['items'], list) or len(page['items']) > selection['limit'] or not summary_cursor_valid(page['next_cursor']) or \
                type(page['has_more']) is not bool or bool(page['next_cursor']) != page['has_more'] or type(page['incomplete']) is not bool or not isinstance(page['incomplete_reason'], str) or len(page['incomplete_reason']) > 128 or \
                not isinstance(page['snapshot_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', page['snapshot_sha256']) or type(page['scanned']) is not int or page['scanned'] < 0:
            raise ValueError('unexpected notes metadata page')
        for item in page['items']:
            if not isinstance(item, dict) or not note_operation_valid(item.get('operation_id')) or item['operation_id'][7:17] != selection['day']:
                raise ValueError('unexpected notes metadata operation')
            validate_note_result({'action': 'summary-note-status', 'annotation': {'operation_id': item['operation_id']}}, item, None, None, None, 'complete')
    else:
        keys = {'schema', 'reference', 'format', 'text', 'offset', 'next_offset', 'total_utf16', 'has_more', 'source_sha256'}
        ref = {key: selection[key] for key in ['day', 'note_id', 'content_sha256']}
        if receipt is not None or page is not None or pending is not None or not isinstance(chunk, dict) or set(chunk) != keys or type(chunk['schema']) is not int or chunk['schema'] != 1 or \
                chunk['reference'] != ref or chunk['format'] != selection['format'] or not isinstance(chunk['text'], str) or not isinstance(chunk['source_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', chunk['source_sha256']) or \
                any(type(chunk[key]) is not int or not 0 <= chunk[key] <= 8388608 for key in ['offset', 'next_offset', 'total_utf16']) or chunk['offset'] != selection['offset'] or type(chunk['has_more']) is not bool:
            raise ValueError('unexpected note chunk binding')
        length = len(chunk['text'].encode('utf-16-le')) // 2
        if length > selection['max_chars'] or chunk['next_offset'] != chunk['offset'] + length or chunk['next_offset'] > chunk['total_utf16'] or chunk['has_more'] != (chunk['next_offset'] < chunk['total_utf16']) or not length and chunk['has_more']:
            raise ValueError('unexpected note chunk progress')


def validate_local_query(value):
    if not isinstance(value, dict) or set(value) != {'from', 'to', 'keyword', 'speaker', 'limit', 'cursor'}:
        raise ValueError('invalid local query fields')
    start, end, limit = value['from'], value['to'], value['limit']
    if any(type(number) is not int or not 0 <= number <= 8640000000000000 for number in [start, end]):
        raise ValueError('local query times must be nonnegative safe integer milliseconds')
    if (start or end) and (end <= start or end - start > 366 * 86400000):
        raise ValueError('local query range must be positive and at most 366 days')
    if type(limit) is not int or not 1 <= limit <= 10:
        raise ValueError('local query limit must be 1 to 10')
    for key, bound in [('keyword', 200), ('speaker', 80)]:
        text = value[key]
        if not isinstance(text, str) or len(text.encode('utf-16-le')) // 2 > bound or any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in text):
            raise ValueError('invalid local query text')
    if not value['keyword'].strip() and not value['speaker'].strip():
        raise ValueError('search-local requires a keyword or speaker')
    cursor = value['cursor']
    if not isinstance(cursor, str) or len(cursor) > 81 or cursor and (not re.fullmatch(r'[a-f0-9]{64}:(0|[1-9][0-9]*)', cursor) or int(cursor.split(':')[1]) > 9007199254740991):
        raise ValueError('invalid local query cursor')
    return dict(value)


def recording_text(value, limit, *, control=False):
    if not isinstance(value, str) or control and re.search(r'[\x00-\x1f\x7f-\x9f]', value):
        return False
    try:
        return len(value.encode('utf-16-le')) // 2 <= limit
    except UnicodeError:
        return False


def recording_reference_valid(value, *, empty=False):
    base = {'material_id','revision','text_revision','utterance_id','content_sha256'}
    if not isinstance(value, dict) or set(value) not in (base, base | {'source_range'}):
        return False
    if empty and type(value['revision']) is int and type(value['text_revision']) is int and value == {'material_id':'','revision':0,'text_revision':0,'utterance_id':'','content_sha256':''}:
        return True
    if not isinstance(value['material_id'], str) or not re.fullmatch(r'mat-recording-[a-f0-9]{32}', value['material_id']) or \
            type(value['revision']) is not int or not 1 <= value['revision'] <= 9007199254740991 or \
            type(value['text_revision']) is not int or not 0 <= value['text_revision'] <= value['revision'] or \
            not recording_text(value['utterance_id'], 256, control=True) or not isinstance(value['content_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['content_sha256']):
        return False
    if 'source_range' not in value:
        return True
    r = value['source_range']
    return isinstance(r, dict) and set(r) == {'parent_utterance_id','parent_revision','start_ms','end_ms','text_start','text_end'} and \
        bool(value['utterance_id']) and recording_text(r['parent_utterance_id'], 256, control=True) and bool(r['parent_utterance_id']) and \
        all(type(r[key]) is int and 0 <= r[key] <= 9007199254740991 for key in ['parent_revision','start_ms','end_ms','text_start','text_end']) and \
        0 < r['parent_revision'] < value['revision'] and r['end_ms'] >= r['start_ms'] and r['text_end'] > r['text_start']


def recording_piece_valid(value):
    return isinstance(value, str) and re.fullmatch(r'piece-[0-9]{4}', value) is not None and 1 <= int(value[6:]) <= 128


def validate_recording_selection(action, value):
    if not isinstance(value, dict) or action not in RECORDING_ACTIONS:
        raise ValueError('invalid recording summary selection')
    operation = action[len('recording-summary-'):]
    keys = {'preview': {'reference'}, 'start': {'job_id','reference','confirm_send'}, 'status': {'job_id'},
            'cancel': {'job_id','state_sha256'}, 'resume': {'job_id','state_sha256','confirm_send'}, 'list': {'material_id','limit','cursor'},
            'read': {'job_id','state_sha256','format','offset','max_chars'}, 'citation': {'job_id','state_sha256','piece_id'}}[operation]
    valid = set(value) == keys
    if valid and operation in ('preview','start'):
        valid = recording_reference_valid(value['reference'])
    if valid and operation in ('start','resume'):
        valid = value['confirm_send'] is True
    if valid and 'job_id' in keys:
        valid = isinstance(value['job_id'], str) and re.fullmatch(r'rsum-[a-f0-9]{32}', value['job_id']) is not None
    if valid and 'state_sha256' in keys:
        valid = isinstance(value['state_sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', value['state_sha256']) is not None
    if valid and operation == 'list':
        valid = isinstance(value['material_id'], str) and re.fullmatch(r'mat-recording-[a-f0-9]{32}', value['material_id']) is not None and \
            type(value['limit']) is int and 1 <= value['limit'] <= 10 and summary_cursor_valid(value['cursor'])
    if valid and operation == 'read':
        valid = value['format'] in ('md','json') and type(value['offset']) is int and 0 <= value['offset'] <= 8388608 and \
            type(value['max_chars']) is int and 2 <= value['max_chars'] <= 4000
    if valid and operation == 'citation':
        valid = recording_piece_valid(value['piece_id'])
    if not valid:
        raise ValueError('invalid recording summary selection or explicit confirmation')
    return dict(value)


def validate_recording_view(value, *, job='', material='', metadata=False):
    keys = {'schema','job_id','state_sha256','phase','note','source','model','generated_at','text_units','piece_count','leaf_count','step_count','completed_steps','calls_used','max_calls','can_resume','transcription_state','entries'}
    if not isinstance(value, dict) or set(value) != keys or type(value['schema']) is not int or value['schema'] != 1 or \
            not isinstance(value['job_id'], str) or not re.fullmatch(r'rsum-[a-f0-9]{32}', value['job_id']) or job and value['job_id'] != job or \
            value['phase'] not in ('missing','queued','running','resumable','paused','ready','error','stale','blocked') or \
            not recording_text(value['note'],512,control=True) or not recording_text(value['model'],128,control=True) or \
            type(value['can_resume']) is not bool or value['transcription_state'] not in (('','unknown','pending','partial','complete') if value['phase'] in ('missing','blocked','stale') else ('unknown','pending','partial','complete')):
        raise ValueError('unexpected recording summary metadata')
    if not recording_reference_valid(value['source'], empty=value['phase'] in ('missing','blocked')) or material and value['source']['material_id'] != material or \
            not isinstance(value['state_sha256'],str) or not (re.fullmatch(r'[a-f0-9]{64}',value['state_sha256']) or value['phase'] in ('missing','blocked') and value['state_sha256']==''):
        raise ValueError('unexpected recording summary source or checkpoint')
    limits = {'text_units':120000,'piece_count':128,'leaf_count':8,'step_count':15,'completed_steps':15,'calls_used':30,'max_calls':30}
    if any(type(value[key]) is not int or not 0 <= value[key] <= limit for key,limit in limits.items()) or value['max_calls'] != 30 or value['completed_steps'] > value['step_count']:
        raise ValueError('unexpected recording summary progress')
    if not note_created_valid(value['generated_at']) or (value['phase']=='ready') != bool(value['generated_at']):
        raise ValueError('unexpected recording summary generation timestamp')
    if not isinstance(value['entries'],list) or len(value['entries'])>20 or (metadata or value['phase']!='ready') and value['entries']:
        raise ValueError('unexpected recording summary entries')
    for entry in value['entries']:
        if not isinstance(entry,dict) or set(entry)!={'category','text','evidence_ids'} or entry['category'] not in ('fact','todo','question','suggestion') or \
                not recording_text(entry['text'],512) or not entry['text'].strip(JS_TRIM) or not isinstance(entry['evidence_ids'],list) or \
                not 1 <= len(entry['evidence_ids']) <= 8 or not all(recording_piece_valid(v) for v in entry['evidence_ids']) or len(set(entry['evidence_ids']))!=len(entry['evidence_ids']):
            raise ValueError('unexpected recording summary entry')


def validate_recording_result(command, result):
    selection = validate_recording_selection(command['action'],command.get('recording_summary'))
    operation = command['action'][len('recording-summary-'):]
    fields = ['recording_summary_preview','recording_summary_view','recording_summary_list','recording_summary_chunk','recording_summary_piece']
    expected = 'recording_summary_' + ('view' if operation in ('start','status','cancel','resume') else 'chunk' if operation=='read' else 'piece' if operation=='citation' else operation)
    if any(result.get(key) is not None for key in fields if key!=expected) or result['state']!='complete' and any(result.get(key) is not None for key in fields):
        raise ValueError('unexpected recording summary error or action payload')
    if result['state']!='complete':
        return
    value=result.get(expected)
    if operation=='preview':
        if not isinstance(value,dict) or set(value)!={'schema','text_units','pieces','leaf_count','max_calls','transcription_state'} or type(value['schema']) is not int or value['schema']!=1 or \
                any(type(value[k]) is not int or not 0 <= value[k] <= limit for k,limit in {'text_units':120000,'pieces':128,'leaf_count':8,'max_calls':30}.items()) or \
                value['max_calls']!=30 or value['transcription_state'] not in ('unknown','pending','partial','complete'):
            raise ValueError('unexpected recording summary preview')
    elif operation in ('start','status','cancel','resume'):
        validate_recording_view(value,job=selection['job_id'])
        if operation=='start' and value['source']!=selection['reference']:
            raise ValueError('unexpected recording summary start reference')
    elif operation=='list':
        keys={'items','next_cursor','has_more','snapshot_sha256','scanned','incomplete','incomplete_reason'}
        if not isinstance(value,dict) or set(value)!=keys or not isinstance(value['items'],list) or len(value['items'])>selection['limit'] or \
                not summary_cursor_valid(value['next_cursor']) or type(value['has_more']) is not bool or bool(value['next_cursor'])!=value['has_more'] or \
                not isinstance(value['snapshot_sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['snapshot_sha256']) or \
                type(value['scanned']) is not int or not 0 <= value['scanned'] <= 128 or type(value['incomplete']) is not bool or \
                value['incomplete_reason'] not in ('','scan_limit','read_limit','unreadable','source_unavailable'):
            raise ValueError('unexpected recording summary metadata list')
        for item in value['items']:
            validate_recording_view(item,material=selection['material_id'],metadata=True)
    elif operation=='read':
        keys={'job_id','state_sha256','format','text','offset','next_offset','total_utf16','has_more'}
        if not isinstance(value,dict) or set(value)!=keys or any(value[k]!=selection[k] for k in ['job_id','state_sha256','format','offset']) or \
                not recording_text(value['text'],selection['max_chars']) or any(type(value[k]) is not int or not 0 <= value[k] <= 8388608 for k in ['offset','next_offset','total_utf16']) or type(value['has_more']) is not bool:
            raise ValueError('unexpected recording summary chunk binding')
        length=len(value['text'].encode('utf-16-le'))//2
        if value['next_offset']!=value['offset']+length or value['next_offset']>value['total_utf16'] or value['has_more']!=(value['next_offset']<value['total_utf16']) or not length and value['has_more']:
            raise ValueError('unexpected recording summary chunk progress')
    else:
        keys={'id','reference','text_field','char_start','char_end','text','speaker_label','start_ms','end_ms'}
        if not isinstance(value,dict) or set(value)!=keys or value['id']!=selection['piece_id'] or not recording_reference_valid(value['reference']) or \
                value['text_field'] not in ('utterance','body') or not recording_text(value['text'],4000) or not recording_text(value['speaker_label'],256) or \
                any(type(value[k]) is not int or not 0 <= value[k] <= 120000 for k in ['char_start','char_end']) or value['char_end']-value['char_start']!=len(value['text'].encode('utf-16-le'))//2 or \
                any(v is not None and (type(v) is not int or not 0 <= v <= 8640000000000000) for v in [value['start_ms'],value['end_ms']]) or \
                (value['start_ms'] is None)!=(value['end_ms'] is None) or value['start_ms'] is not None and value['end_ms']<value['start_ms']:
            raise ValueError('unexpected recording summary citation')


def todo_operation_valid(value):
    return isinstance(value, str) and re.fullmatch(r'tdel-[a-f0-9]{32}', value) is not None


def todo_cursor_valid(value):
    return isinstance(value, str) and (value == '' or re.fullmatch(r'tcur-[a-f0-9]{64}-(0|[1-9][0-9]{0,2})', value) is not None and int(value[70:]) <= 200)


def todo_reference_valid(value, *, empty=False):
    if not isinstance(value, dict) or set(value) != {'id','revision','peer','content_sha256'}:
        return False
    if empty and type(value['id']) is int and type(value['revision']) is int and value == {'id':0,'revision':0,'peer':'','content_sha256':''}:
        return True
    return all(type(value[key]) is int and 1 <= value[key] <= 9007199254740991 for key in ('id','revision')) and \
        isinstance(value['peer'], str) and (value['peer'] == '' or re.fullmatch(r'[a-f0-9]{12}', value['peer']) is not None) and \
        isinstance(value['content_sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', value['content_sha256']) is not None


def validate_todo_selection(action, value):
    if not isinstance(value, dict) or action not in TODO_ACTIONS:
        raise ValueError('invalid todo selection')
    expected = {'todo-list':{'scope','limit','cursor'}, 'todo-delete':{'operation_id','reference','confirm'},
                'todo-delete-status':{'operation_id'}, 'todo-delete-cancel':{'operation_id','state_sha256'},
                'todo-delete-send':{'operation_id','state_sha256','confirm'}, 'todo-query':set(), 'todo-query-status':set()}[action]
    if set(value) != expected:
        raise ValueError('invalid todo action fields')
    if action in ('todo-query','todo-query-status'):
        return value
    if action == 'todo-list':
        if value['scope'] not in ('active','deleted') or type(value['limit']) is not int or not 1 <= value['limit'] <= 10 or not todo_cursor_valid(value['cursor']):
            raise ValueError('invalid todo page filter')
        return value
    if not todo_operation_valid(value['operation_id']):
        raise ValueError('invalid explicit todo operation id')
    if action in ('todo-delete','todo-delete-send') and value['confirm'] is not True:
        raise ValueError('todo delete/send requires explicit confirmation')
    if action == 'todo-delete' and not todo_reference_valid(value['reference']):
        raise ValueError('invalid todo reference')
    if action in ('todo-delete-cancel','todo-delete-send') and (not isinstance(value['state_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['state_sha256'])):
        raise ValueError('invalid todo deletion checkpoint')
    return value


def todo_integer(value, minimum=0, maximum=9007199254740991):
    return type(value) is int and minimum <= value <= maximum


def validate_todo_item(value, *, empty=False):
    fields = {'reference','title','completed','important','delivery','created','modified'}
    if not isinstance(value, dict) or set(value) != fields or not todo_reference_valid(value['reference'],empty=empty) or \
            not recording_text(value['title'],60) or type(value['completed']) is not bool or type(value['important']) is not bool or \
            not todo_integer(value['created'],-9007199254740991) or not todo_integer(value['modified'],-9007199254740991):
        raise ValueError('unexpected todo item')
    if empty and value['reference']['id'] == 0:
        if value != {'reference':{'id':0,'revision':0,'peer':'','content_sha256':''},'title':'','completed':False,'important':False,'delivery':'','created':0,'modified':0}:
            raise ValueError('unexpected empty todo item')
    elif not value['title'].strip(JS_TRIM) or value['delivery'] not in ('local','pending','submitted','confirmed','conflict'):
        raise ValueError('unexpected todo item metadata')


def validate_todo_deletion(value, operation=''):
    fields = {'schema','operation_id','state_sha256','revision','phase','note','todo','attempts','max_attempts','can_cancel','can_send',
              'receipt_observed','receipt_success_count','receipt_failure_code','receipt_at','receipt_correlation','query_observation','query_at'}
    if not isinstance(value,dict) or set(value) != fields or type(value['schema']) is not int or value['schema'] != 1 or \
            not todo_operation_valid(value['operation_id']) or operation and value['operation_id'] != operation or \
            value['phase'] not in ('missing','blocked','local_deleted','pending','sending','submitted','uncertain','cancelled') or not recording_text(value['note'],512) or \
            not todo_integer(value['attempts'],0,3) or type(value['max_attempts']) is not int or value['max_attempts'] != 3 or \
            any(type(value[key]) is not bool for key in ('can_cancel','can_send','receipt_observed')) or \
            not todo_integer(value['receipt_success_count'],-1,400) or not todo_integer(value['receipt_failure_code'],-1,2147483647) or \
            value['receipt_correlation'] not in ('none','unattributed','failure_id') or value['query_observation'] not in ('not_queried','present','absent','incomplete') or \
            not note_created_valid(value['receipt_at']) or not note_created_valid(value['query_at']):
        raise ValueError('unexpected todo deletion state')
    missing = value['phase'] in ('missing','blocked')
    if missing:
        if value['state_sha256'] != '' or not todo_integer(value['revision'],0,0) or value['attempts'] != 0 or value['can_cancel'] or value['can_send']:
            raise ValueError('unexpected missing/blocked todo deletion')
    elif not isinstance(value['state_sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['state_sha256']) or not todo_integer(value['revision'],1):
        raise ValueError('unexpected todo deletion checkpoint')
    validate_todo_item(value['todo'],empty=missing)
    if not value['receipt_observed'] and (value['receipt_success_count'] != -1 or value['receipt_failure_code'] != -1 or value['receipt_at'] != '' or value['receipt_correlation'] != 'none'):
        raise ValueError('unobserved todo receipt cannot claim evidence')
    if value['receipt_observed'] and (value['receipt_at'] == '' or value['receipt_success_count'] < 0 or value['receipt_correlation'] == 'none'):
        raise ValueError('observed todo receipt lacks bounded evidence')
    if value['query_observation'] == 'not_queried' and value['query_at'] != '' or value['query_observation'] != 'not_queried' and value['query_at'] == '':
        raise ValueError('todo query observation lacks timestamp')


def validate_todo_query(value):
    fields = {'schema','query_id','phase','peer','started_at','deadline_at','completed_at','batches','received','todo_total','schedule_total','note','absence_is_confirmation'}
    if not isinstance(value,dict) or set(value) != fields or type(value['schema']) is not int or value['schema'] != 1 or \
            value['phase'] not in ('idle','waiting','complete','incomplete','error','disconnected') or value['absence_is_confirmation'] is not False or \
            not recording_text(value['note'],512) or not todo_integer(value['batches'],0,64) or not todo_integer(value['received'],0,400) or \
            not todo_integer(value['todo_total'],-1,200) or not todo_integer(value['schedule_total'],-1,200) or \
            any(not note_created_valid(value[key]) for key in ('started_at','deadline_at','completed_at')):
        raise ValueError('unexpected todo query state')
    if value['phase'] == 'idle':
        if any(value[key] != '' for key in ('query_id','peer','started_at','deadline_at','completed_at')):
            raise ValueError('unexpected idle todo query identity')
    elif not isinstance(value['query_id'],str) or not re.fullmatch(r'tqry-[a-f0-9]{32}',value['query_id']) or not isinstance(value['peer'],str) or \
            not re.fullmatch(r'[a-f0-9]{12}',value['peer']) or not value['started_at'] or not value['deadline_at']:
        raise ValueError('unexpected todo query identity')
    if value['phase'] in ('complete','incomplete','error','disconnected') and not value['completed_at']:
        raise ValueError('terminal todo query lacks completion time')


def validate_todo_result(command,result):
    action=command['action'];selection=validate_todo_selection(action,command.get('todo'))
    fields=['todo_page','todo_deletion','todo_query'];present=[key for key in fields if result.get(key) is not None]
    expected='todo_page' if action=='todo-list' else 'todo_query' if action in ('todo-query','todo-query-status') else 'todo_deletion'
    if result['state']=='error':
        if present:
            raise ValueError('unexpected todo error payload')
        return
    if present != [expected]:
        raise ValueError('missing or mixed todo result')
    value=result[expected]
    if expected=='todo_deletion':
        validate_todo_deletion(value,selection['operation_id'])
        if action=='todo-delete' and value['phase'] not in ('missing','blocked') and value['todo']['reference'] != selection['reference']:
            raise ValueError('todo deletion reference changed')
    elif expected=='todo_query':
        validate_todo_query(value)
    else:
        page_fields={'schema','scope','todos','deletions','next_cursor','has_more','snapshot_sha256','scanned','incomplete','incomplete_reason'}
        if not isinstance(value,dict) or set(value)!=page_fields or type(value['schema']) is not int or value['schema']!=1 or value['scope']!=selection['scope'] or \
                not isinstance(value['todos'],list) or not isinstance(value['deletions'],list) or \
                not todo_cursor_valid(value['next_cursor']) or type(value['has_more']) is not bool or bool(value['next_cursor']) != value['has_more'] or \
                not isinstance(value['snapshot_sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',value['snapshot_sha256']) or \
                not todo_integer(value['scanned'],0,selection['limit']) or type(value['incomplete']) is not bool or value['incomplete_reason'] not in ('','unreadable','scan_limit','read_limit'):
            raise ValueError('unexpected todo metadata page')
        items=value['todos'] if value['scope']=='active' else value['deletions']
        other=value['deletions'] if value['scope']=='active' else value['todos']
        if other:
            raise ValueError('mixed active and deleted todo results')
        if len(items)>selection['limit'] or len(items)!=value['scanned'] or value['has_more'] and not items or \
                value['next_cursor'] and value['next_cursor'][5:69]!=value['snapshot_sha256']:
            raise ValueError('unexpected todo page bounds')
        for item in items:
            validate_todo_item(item) if value['scope']=='active' else validate_todo_deletion(item)


def scan_cursor_parts(value):
    if not isinstance(value,str) or len(value)>160:
        return None
    match=re.fullmatch(r'lscan1:([a-f0-9]{64}):([a-f0-9]{64}):(0|[1-9][0-9]*)',value)
    return (match[1],match[2],int(match[3])) if match and int(match[3])<=9007199254740991 else None


def validate_local_scan(value):
    keys={'from','to','keyword','speaker','limit','scan_cursor','hit_cursor'}
    if not isinstance(value,dict) or set(value)!=keys:
        raise ValueError('invalid local scan fields')
    validate_local_query({**{key:value[key] for key in ('from','to','keyword','speaker','limit')},'cursor':value['hit_cursor']})
    if not value['keyword'].strip(JS_TRIM) and not value['speaker'].strip(JS_TRIM):
        raise ValueError('local scan requires a keyword or speaker')
    if not isinstance(value['scan_cursor'],str) or value['scan_cursor'] and scan_cursor_parts(value['scan_cursor']) is None or value['hit_cursor'] and not value['scan_cursor']:
        raise ValueError('local scan requires separate canonical scan and hit cursors')
    return dict(value)


def validate_local_scan_hit(value):
    fields={'reference','kind','name','source_started','source_ended','start_ms','end_ms','excerpt','speaker_id','speaker_label','speaker_basis','label_basis',
            'is_self','overlap','transcription_state','audio_available'}
    if not isinstance(value,dict) or set(value)!=fields or value['kind'] not in ('recording','lifelog') or not recording_text(value['name'],256) or not value['name'] or \
            any(not todo_integer(value[key],0,8640000000000000) for key in ('source_started','source_ended')) or value['source_ended']<value['source_started'] or \
            not recording_text(value['excerpt'],160) or not recording_text(value['speaker_id'],128) or not recording_text(value['speaker_label'],80) or \
            value['speaker_basis'] not in ('unknown','segment_cluster','user') or value['label_basis'] not in ('anonymous','user_confirmed','role_match') or \
            value['transcription_state'] not in ('unknown','pending','partial','complete') or any(type(value[key]) is not bool for key in ('is_self','overlap','audio_available')):
        raise ValueError('unexpected local scan hit')
    ref=value['reference'];base={'material_id','revision','text_revision','utterance_id','content_sha256'}
    if not isinstance(ref,dict) or set(ref) not in (base,base|{'source_range'}) or not isinstance(ref['material_id'],str) or \
            not re.fullmatch('mat-'+value['kind']+r'-[a-f0-9]{32}',ref['material_id']) or not todo_integer(ref['revision'],1) or \
            not todo_integer(ref['text_revision'],0,ref['revision']) or not recording_text(ref['utterance_id'],256) or not isinstance(ref['content_sha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',ref['content_sha256']):
        raise ValueError('unexpected local scan reference')
    start,end=value['start_ms'],value['end_ms'];duration=value['source_ended']-value['source_started']
    if start is None or end is None:
        if start is not None or end is not None:
            raise ValueError('unexpected partial local scan timing')
    elif not todo_integer(start,0,duration) or not todo_integer(end,start,duration):
        raise ValueError('unexpected local scan timing')
    if not ref['utterance_id'] and start is not None or ref['utterance_id'] and start is None and 'source_range' not in ref:
        raise ValueError('unexpected local scan text anchor')
    if 'source_range' in ref:
        r=ref['source_range']
        if not isinstance(r,dict) or set(r)!={'parent_utterance_id','parent_revision','start_ms','end_ms','text_start','text_end'} or not ref['utterance_id'] or \
                not recording_text(r['parent_utterance_id'],256) or not r['parent_utterance_id'] or not todo_integer(r['parent_revision'],1,ref['revision']-1) or \
                not todo_integer(r['start_ms'],0,duration) or not todo_integer(r['end_ms'],r['start_ms'],duration) or not todo_integer(r['text_start']) or not todo_integer(r['text_end'],r['text_start']+1) or start is not None:
            raise ValueError('unexpected local scan range reference')
    if value['is_self'] and value['label_basis']!='user_confirmed':
        raise ValueError('unexpected local scan identity claim')


def validate_local_scan_result(command,page,state):
    selection=validate_local_scan(command.get('local_scan'))
    if state=='error':
        if page is not None:raise ValueError('unexpected local scan error payload')
        return
    fields={'schema','scope','hits','next_cursor','has_more','snapshot_sha256','scanned','unreadable','incomplete','incomplete_reason','legacy_not_indexed',
            'catalog_sha256','catalog_total','window_start','window_end','content_units','oversized','scan_cursor','next_scan_cursor','scan_has_more','stop_reason'}
    if not isinstance(page,dict) or set(page)!=fields or type(page['schema']) is not int or page['schema']!=1 or page['scope']!='local_canonical_window' or \
            not isinstance(page['hits'],list) or len(page['hits'])>selection['limit'] or any(type(page[key]) is not bool for key in ('has_more','incomplete','scan_has_more')) or page['legacy_not_indexed'] is not True or \
            any(not isinstance(page[key],str) or not re.fullmatch(r'[a-f0-9]{64}',page[key]) for key in ('snapshot_sha256','catalog_sha256')) or \
            any(not todo_integer(page[key]) for key in ('catalog_total','window_start','window_end')) or not todo_integer(page['scanned'],0,512) or \
            not todo_integer(page['unreadable'],0,page['scanned']) or not todo_integer(page['oversized'],0,page['scanned']) or not todo_integer(page['content_units'],0,2097152) or \
            not 0<=page['window_start']<=page['window_end']<=page['catalog_total'] or page['window_end']-page['window_start']>page['scanned'] or \
            page['incomplete_reason'] not in ('','window_only','unreadable','oversized') or bool(page['incomplete_reason'])!=page['incomplete'] or \
            page['stop_reason'] not in ('end','scan_limit','text_limit','oversized') or not isinstance(page['next_scan_cursor'],str) or not summary_cursor_valid(page['next_cursor']) or bool(page['next_cursor'])!=page['has_more']:
        raise ValueError('unexpected local scan window metadata')
    current=scan_cursor_parts(page['scan_cursor']);following=scan_cursor_parts(page['next_scan_cursor']) if page['next_scan_cursor'] else None
    if current is None or current[0]!=page['catalog_sha256'] or current[2]!=page['window_start'] or \
            selection['scan_cursor'] and page['scan_cursor']!=selection['scan_cursor'] or not selection['scan_cursor'] and page['window_start']!=0 or \
            page['scan_has_more']!=(page['window_end']<page['catalog_total']) or bool(page['next_scan_cursor'])!=page['scan_has_more'] or \
            page['scan_has_more'] and (following is None or following[:2]!=current[:2] or following[2]!=page['window_end'] or following[2]<=current[2]) or \
            (page['window_start']>0 or page['scan_has_more'] or page['unreadable'] or page['oversized']) and not page['incomplete']:
        raise ValueError('unexpected local scan continuation binding')
    prior=selection['hit_cursor'];offset=int(prior.split(':')[1]) if prior else 0
    if prior and prior[:64]!=page['snapshot_sha256'] or page['has_more'] and (not page['hits'] or page['next_cursor']!=page['snapshot_sha256']+':'+str(offset+len(page['hits']))):
        raise ValueError('unexpected local scan hit continuation binding')
    for hit in page['hits']:validate_local_scan_hit(hit)


def make_command(action, command_id, uid='', binding_sha256='', now=None, reply_binding_sha256='', recovery_binding_sha256='', recovery_source='', local_query=None, saved_summary=None, annotation=None, playback=None, recording_summary=None, todo=None, local_scan=None):
    if not re.fullmatch(r'dbg-[a-f0-9]{32}', command_id):
        raise ValueError('invalid command id')
    if action==SCAN_ACTION:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or any(value is not None for value in (local_query,saved_summary,annotation,playback,recording_summary,todo)):
            raise ValueError('local scan cannot mix other command selectors')
        local_scan=validate_local_scan(local_scan)
    elif local_scan is not None:
        raise ValueError('local scan arguments are exclusive to scan-local')
    elif action in TODO_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or any(value is not None for value in [local_query,saved_summary,annotation,playback,recording_summary]):
            raise ValueError('todo commands cannot mix other command arguments')
        todo = validate_todo_selection(action, todo)
    elif todo is not None:
        raise ValueError('todo selection requires a matching action')
    elif action in RECORDING_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or any(value is not None for value in [local_query,saved_summary,annotation,playback]):
            raise ValueError('recording summary commands cannot mix other command arguments')
        recording_summary=validate_recording_selection(action,recording_summary)
    elif recording_summary is not None:
        raise ValueError('recording summary selection requires a matching action')
    elif action in PLAYBACK_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or local_query is not None or saved_summary is not None or annotation is not None:
            raise ValueError('playback commands cannot use card, task, recovery, query or summary arguments')
        playback = validate_playback_selection(action, playback)
    elif playback is not None:
        raise ValueError('playback selection requires a playback action')
    elif action in NOTE_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or local_query is not None or saved_summary is not None:
            raise ValueError('note commands cannot use card, task, recovery or summary read arguments')
        annotation = validate_note_selection(action, annotation)
    elif annotation is not None:
        raise ValueError('annotation selection requires a note action')
    elif action in SUMMARY_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source or local_query is not None:
            raise ValueError('saved summary reads cannot use card, task, recovery or local query arguments')
        saved_summary = validate_saved_summary(action, saved_summary)
    elif saved_summary is not None:
        raise ValueError('saved summary arguments require list-summaries or read-summary')
    elif action == LOCAL_ACTION:
        if uid or binding_sha256 or reply_binding_sha256 or recovery_binding_sha256 or recovery_source:
            raise ValueError('search-local cannot use card, voice, answer or recovery bindings')
        local_query = validate_local_query(local_query)
    elif local_query is not None:
        raise ValueError('local query arguments are only accepted by search-local')
    elif action in RECOVERY_ACTIONS:
        if uid or binding_sha256 or reply_binding_sha256:
            raise ValueError('recovery commands cannot use card, voice or answer bindings')
        if action == 'recovery-status':
            if recovery_binding_sha256 or recovery_source:
                raise ValueError('recovery-status is read only and takes no binding or source')
        elif not re.fullmatch(r'[a-f0-9]{64}', recovery_binding_sha256) or recovery_source not in ('main', 'partial', 'resume'):
            raise ValueError('recovery-restore requires --recovery-binding-sha256 and --recovery-source main|partial|resume')
    elif recovery_binding_sha256 or recovery_source:
        raise ValueError('recovery arguments are only accepted by recovery commands')
    elif action == REVIEW_ACTION:
        if uid or binding_sha256 or not re.fullmatch(r'[a-f0-9]{64}', reply_binding_sha256):
            raise ValueError('review-card requires only the exact observed reply binding SHA256')
    elif reply_binding_sha256:
        raise ValueError('reply binding SHA256 is only accepted by review-card')
    elif action in TASK_ACTIONS:
        if uid or (bool(binding_sha256) if action == 'task-status' else not re.fullmatch(r'[a-f0-9]{64}', binding_sha256)):
            raise ValueError('task-status takes no binding; voice controls require the exact observed binding SHA256')
    elif action not in ('status', 'show-card', 'remove-card') or binding_sha256 or (not re.fullmatch(r'p10-[a-z0-9-]{1,100}', uid) if action == 'remove-card' else bool(uid)):
        raise ValueError('invalid card command binding')
    now = datetime.now(timezone.utc) if now is None else now
    stamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    command = {'schema': 11 if action==SCAN_ACTION else 10 if action in TODO_ACTIONS else 9 if action in RECORDING_ACTIONS else 8 if action in PLAYBACK_ACTIONS else 7 if action in NOTE_ACTIONS else 6 if action in SUMMARY_ACTIONS else 5 if action == LOCAL_ACTION else 4 if action in RECOVERY_ACTIONS else 3 if action == REVIEW_ACTION else 2 if action in TASK_ACTIONS else 1, 'id': command_id, 'action': action,
               'created_at': stamp(now), 'expires_at': stamp(now + timedelta(seconds=60)), 'expected_uid': uid}
    if action in TASK_ACTIONS:
        command['expected_voice_binding'] = binding_sha256
    elif action == REVIEW_ACTION:
        command['expected_reply_binding'] = reply_binding_sha256
    elif action in RECOVERY_ACTIONS:
        command['expected_recovery_binding'] = recovery_binding_sha256
        command['recovery_source'] = recovery_source
    elif action == LOCAL_ACTION:
        command['local_query'] = local_query
    elif action in SUMMARY_ACTIONS:
        command['saved_summary'] = saved_summary
    elif action in NOTE_ACTIONS:
        command['annotation'] = annotation
    elif action in PLAYBACK_ACTIONS:
        command['playback'] = playback
    elif action in RECORDING_ACTIONS:
        command['recording_summary'] = recording_summary
    elif action==SCAN_ACTION:
        command['local_scan']=local_scan
    elif action in TODO_ACTIONS:
        command['todo'] = todo
    if len(json.dumps(command, ensure_ascii=False).encode('utf-8')) > 2048:
        raise ValueError('command exceeds 2048 bytes')
    return command


def cached_power(settings_text, trace_text, now=None):
    if len(settings_text) > 131072 or len(trace_text) > 1048576:
        raise ValueError('cached power input limit exceeded')
    settings = json.loads(settings_text)
    general = settings.get('generalSettings') if isinstance(settings, dict) else None
    value = general.get('autoLockTime') if isinstance(general, dict) else None
    if type(value) is not int or value < 0 or value > 86400:
        raise ValueError('autoLockTime unavailable')
    last = None
    for line in trace_text.splitlines():
        try:
            row = json.loads(line)
            if row.get('dir') == 'rx' and row.get('type') == 4:
                last = row
        except (ValueError, AttributeError):
            continue
    matched, received, age = False, None, None
    current_time = time.time() if now is None else now
    if last and type(last.get('t')) is int and 0 < last['t'] <= current_time * 1000:
        body = last.get('json')
        try:
            body = json.loads(body) if isinstance(body, str) else body
            matched = json.dumps(body, sort_keys=True) == json.dumps(settings, sort_keys=True)
        except (ValueError, TypeError):
            pass
        if matched:
            received = datetime.fromtimestamp(last['t'] / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            age = round((time.time() if now is None else now) - last['t'] / 1000, 3)
    return {'channel': 'hdc_cached_readback', 'cached': True, 'auto_lock_seconds': value,
            'last_rx_matches_cache': matched, 'last_device_read_at': received, 'cache_age_seconds': age,
            'fresh_device_query_performed': False, 'settings_changed': False,
            'notification_timeout_seconds': None, 'lens_sleep_cause_verified': False}


def transfer(hdc, device, direction, source, target):
    result = subprocess.run([hdc, '-t', device, 'file', direction, '-b', BUNDLE, str(source), str(target)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
    return result.returncode == 0 and 'FileTransfer finish' in result.stdout


def _main(stack):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'show-card', 'remove-card', 'reconcile', 'cached-power', *TASK_ACTIONS, REVIEW_ACTION, *RECOVERY_ACTIONS, LOCAL_ACTION, SCAN_ACTION, *SUMMARY_ACTIONS, *NOTE_ACTIONS, *PLAYBACK_ACTIONS, *RECORDING_ACTIONS, *TODO_ACTIONS])
    parser.add_argument('--device', default='6HQ0226407055391')
    parser.add_argument('--hdc', default='D:/APP/DevEcoStudio/sdk/default/openharmony/toolchains/hdc.exe')
    parser.add_argument('--uid', default='')
    parser.add_argument('--id', default='', help='Only for reconcile; never resend an uncertain command')
    parser.add_argument('--binding-sha256', default='', help='Exact binding_sha256 observed by task-status; voice controls only')
    parser.add_argument('--reply-binding-sha256', default='', help='Exact reply_binding_sha256 observed by task-status; review-card display only')
    parser.add_argument('--recovery-binding-sha256', default='', help='Exact inspection_sha256 from recovery-status; restores a paused local draft only')
    parser.add_argument('--recovery-source', default='', help='main, partial, or resume; no arbitrary file paths')
    parser.add_argument('--from-ms', type=int, default=None, help='search-local/scan-local: inclusive local source time in milliseconds')
    parser.add_argument('--to-ms', type=int, default=None, help='search-local/scan-local: exclusive local source time in milliseconds')
    parser.add_argument('--keyword', default=None, help='search-local/scan-local: case-insensitive text substring, up to 200 UTF16 units')
    parser.add_argument('--speaker', default=None, help='search-local/scan-local: local speaker ID or label, up to 80 UTF16 units')
    parser.add_argument('--limit', type=int, default=None, help='search-local/scan-local: 1 to 10 hits, default 10')
    parser.add_argument('--cursor', default=None, help='search-local only: exact cursor from the preceding local snapshot')
    parser.add_argument('--scan-cursor', default=None, help='scan-local only: exact source-window cursor; default starts the first window')
    parser.add_argument('--hit-cursor', default=None, help='scan-local only: next_cursor within the same explicit scan-cursor window')
    parser.add_argument('--summary-day', default=None, help='saved summary reads only: real YYYY-MM-DD local date')
    parser.add_argument('--summary-id', default=None, help='read-summary only: exact closed ID returned by list-summaries')
    parser.add_argument('--summary-sha256', default=None, help='read-summary only: exact full-file content SHA256 returned by list-summaries')
    parser.add_argument('--summary-limit', type=int, default=None, help='list-summaries only: 1 to 10 metadata entries, default 10')
    parser.add_argument('--summary-cursor', default=None, help='list-summaries only: exact cursor from the preceding saved-file snapshot')
    parser.add_argument('--offset', type=int, default=None, help='read-summary only: UTF16 offset, default 0')
    parser.add_argument('--max-chars', type=int, default=None, help='read-summary only: 2 to 4000 UTF16 units, default 4000')
    for flag in ['operation-id', 'file', 'day', 'parent-id', 'parent-sha256', 'source-sha256', 'previous-id', 'previous-sha256', 'cursor', 'id', 'sha256', 'input-sha256']:
        parser.add_argument('--note-' + flag, default=None, help='note actions only; exact action-specific input')
    for flag in ['limit', 'offset', 'max-chars']:
        parser.add_argument('--note-' + flag, type=int, default=None, help='note list/chunk bounds only')
    parser.add_argument('--note-format', choices=['md', 'json'], default=None, help='read-summary-note only, default md')
    for flag in ['kind', 'name', 'utterance-id', 'session-id']:
        parser.add_argument('--playback-' + flag, default=None, help='playback only; closed source or exact observed session')
    for flag in ['revision', 'position-ms']:
        parser.add_argument('--playback-' + flag, type=int, default=None, help='playback only; canonical revision or seek position')
    for flag in ['reference','job-id','state-sha256','material-id','piece-id','cursor']:
        parser.add_argument('--recording-' + flag, default=None, help='recording summary only; exact local reference or observed job/checkpoint')
    for flag in ['limit','offset','max-chars']:
        parser.add_argument('--recording-' + flag, type=int, default=None, help='recording summary metadata/chunk bounds only')
    parser.add_argument('--recording-format', choices=['md','json'], default=None)
    for flag in ['reference','operation-id','state-sha256','scope','cursor']:
        parser.add_argument('--todo-' + flag, default=None, help='todo only; exact selected reference or observed deletion operation/checkpoint')
    parser.add_argument('--todo-limit', type=int, default=None, help='todo-list only; 1 to 10 entries, default 10')
    parser.add_argument('--confirm', action='store_true', help='Explicitly allow the selected recording-summary model request or todo delete/send action')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', args.device):
        parser.error('invalid device')
    if args.action!=SCAN_ACTION and any(value is not None for value in (args.scan_cursor,args.hit_cursor)):
        parser.error('scan and hit cursors are exclusive to scan-local')
    if args.action==SCAN_ACTION:
        accepted={'--device','--hdc','--from-ms','--to-ms','--keyword','--speaker','--limit','--scan-cursor','--hit-cursor'}
        if any(token.startswith('--') and token.split('=',1)[0] not in accepted for token in sys.argv[1:]):
            parser.error('scan-local cannot mix old cursor, bindings, confirmations or other action flags, including explicit empty defaults')
    todo_allowed = {'todo-list':{'scope','limit','cursor'}, 'todo-delete':{'operation_id','reference'},
                    'todo-delete-status':{'operation_id'}, 'todo-delete-cancel':{'operation_id','state_sha256'},
                    'todo-delete-send':{'operation_id','state_sha256'}, 'todo-query':set(), 'todo-query-status':set()}
    todo_flags = {key[5:]:value for key,value in vars(args).items() if key.startswith('todo_')}
    if any(value is not None and key not in todo_allowed.get(args.action,set()) for key,value in todo_flags.items()):
        parser.error('todo flags are exclusive to their matching todo action')
    todo = None
    if args.action in TODO_ACTIONS:
        accepted = {'--device','--hdc', *('--todo-'+flag.replace('_','-') for flag in todo_allowed[args.action])}
        if args.action in ('todo-delete','todo-delete-send'):
            accepted.add('--confirm')
        if any(token.startswith('--') and token.split('=',1)[0] not in accepted for token in sys.argv[1:]):
            parser.error('todo actions cannot mix old command flags, including explicit empty defaults')
        if args.action in ('todo-delete','todo-delete-send') and not args.confirm:
            parser.error('--confirm is required before deleting or explicitly sending a todo deletion')
        try:
            if args.action == 'todo-list':
                todo = {'scope':'active' if args.todo_scope is None else args.todo_scope, 'limit':10 if args.todo_limit is None else args.todo_limit,
                        'cursor':'' if args.todo_cursor is None else args.todo_cursor}
            elif args.action in ('todo-query','todo-query-status'):
                todo = {}
            else:
                if not todo_operation_valid(args.todo_operation_id):
                    raise ValueError('explicit operation id required')
                todo = {'operation_id':args.todo_operation_id}
                if args.action == 'todo-delete':
                    if args.todo_reference is None:
                        raise ValueError('todo reference file required')
                    reference_path = Path(args.todo_reference)
                    if not 0 < note_local_stat(reference_path).st_size <= 4096:
                        raise ValueError('todo reference file size invalid')
                    with reference_path.open('rb') as stream:
                        raw_reference = stream.read(4097)
                    if len(raw_reference) > 4096:
                        raise ValueError('todo reference file grew')
                    todo.update(reference=json.loads(raw_reference.decode('utf-8-sig')),confirm=True)
                elif args.action in ('todo-delete-cancel','todo-delete-send'):
                    todo['state_sha256'] = args.todo_state_sha256
                    if args.action == 'todo-delete-send':
                        todo['confirm'] = True
            todo = validate_todo_selection(args.action,todo)
        except (OSError,ValueError):
            parser.error('invalid or unavailable todo reference, explicit operation or checkpoint; no command sent')
    recording_allowed = {'preview':{'reference'},'start':{'reference','job_id'},'status':{'job_id'},'cancel':{'job_id','state_sha256'},
                         'resume':{'job_id','state_sha256'},'list':{'material_id','limit','cursor'},'read':{'job_id','state_sha256','format','offset','max_chars'},
                         'citation':{'job_id','state_sha256','piece_id'}}
    recording_operation = args.action[len('recording-summary-'):] if args.action in RECORDING_ACTIONS else ''
    recording_flags = {key[10:]:value for key,value in vars(args).items() if key.startswith('recording_')}
    if any(value is not None and key not in recording_allowed.get(recording_operation,set()) for key,value in recording_flags.items()) or args.confirm and recording_operation not in ('start','resume') and args.action not in ('todo-delete','todo-delete-send'):
        parser.error('recording summary flags and confirmation are exclusive to their matching action')
    recording_summary=None
    if args.action in RECORDING_ACTIONS:
        accepted={'--device','--hdc',*('--recording-'+flag.replace('_','-') for flag in recording_allowed[recording_operation])}
        if recording_operation in ('start','resume'):
            accepted.add('--confirm')
        if any(token.startswith('--') and token.split('=',1)[0] not in accepted for token in sys.argv[1:]):
            parser.error('recording summary actions cannot mix old command flags, including explicit empty defaults')
        if recording_operation in ('start','resume') and not args.confirm:
            parser.error('--confirm is required before sending transcription text to the configured model')
        try:
            if recording_operation in ('preview','start'):
                if args.recording_reference is None:
                    raise ValueError('reference file required')
                reference_path=Path(args.recording_reference)
                item=note_local_stat(reference_path)
                if not 0<item.st_size<=4096:
                    raise ValueError('reference file size invalid')
                with reference_path.open('rb') as stream:
                    raw_reference=stream.read(4097)
                if len(raw_reference)>4096:
                    raise ValueError('reference file grew')
                reference=json.loads(raw_reference.decode('utf-8-sig'))
                recording_summary={'reference':reference}
                if recording_operation=='start':
                    recording_summary.update(job_id='rsum-'+uuid.uuid4().hex if args.recording_job_id is None else args.recording_job_id,confirm_send=True)
            elif recording_operation=='list':
                recording_summary={'material_id':args.recording_material_id,'limit':10 if args.recording_limit is None else args.recording_limit,'cursor':'' if args.recording_cursor is None else args.recording_cursor}
            else:
                recording_summary={'job_id':args.recording_job_id}
                if recording_operation in ('cancel','resume','read','citation'):
                    recording_summary['state_sha256']=args.recording_state_sha256
                if recording_operation=='resume':
                    recording_summary['confirm_send']=True
                if recording_operation=='read':
                    recording_summary.update(format='md' if args.recording_format is None else args.recording_format,offset=0 if args.recording_offset is None else args.recording_offset,max_chars=4000 if args.recording_max_chars is None else args.recording_max_chars)
                elif recording_operation=='citation':
                    recording_summary['piece_id']=args.recording_piece_id
            recording_summary=validate_recording_selection(args.action,recording_summary)
        except (OSError,ValueError):
            parser.error('invalid or unavailable recording summary reference, job or checkpoint; no command sent')
    if args.action in PLAYBACK_ACTIONS:
        accepted = {'--device','--hdc', *('--playback-' + flag for flag in ['kind','name','revision','utterance-id','session-id','position-ms'])}
        if any(token.startswith('--') and token.split('=',1)[0] not in accepted for token in sys.argv[1:]):
            parser.error('playback actions cannot mix any old command flags, including explicit empty defaults')
    playback_flags = {key: value for key, value in vars(args).items() if key.startswith('playback_')}
    playback_allowed = {'playback-play': {'kind','name','revision','utterance_id'}, 'playback-status': set(),
                        'playback-pause': {'session_id'}, 'playback-resume': {'session_id'}, 'playback-stop': {'session_id'},
                        'playback-seek': {'session_id','position_ms'}}
    if any(value is not None and key[9:] not in playback_allowed.get(args.action, set()) for key, value in playback_flags.items()):
        parser.error('playback flags are exclusive to their matching playback action')
    playback = None
    if args.action in PLAYBACK_ACTIONS:
        if args.action == 'playback-play':
            playback = {'kind':args.playback_kind,'name':args.playback_name,'revision':0 if args.playback_revision is None else args.playback_revision,
                        'utterance_id':'' if args.playback_utterance_id is None else args.playback_utterance_id}
        elif args.action == 'playback-status':
            playback = {}
        else:
            playback = {'session_id':args.playback_session_id}
            if args.action == 'playback-seek':
                playback['position_ms'] = args.playback_position_ms
    local_arguments = [args.from_ms, args.to_ms, args.keyword, args.speaker, args.limit, args.cursor]
    if args.action not in (LOCAL_ACTION,SCAN_ACTION) and any(value is not None for value in local_arguments):
        parser.error('local query arguments are only accepted by search-local')
    local_query = {'from': args.from_ms or 0, 'to': args.to_ms or 0, 'keyword': args.keyword or '',
                   'speaker': args.speaker or '', 'limit': 10 if args.limit is None else args.limit, 'cursor': args.cursor or ''} if args.action == LOCAL_ACTION else None
    local_scan={'from':0 if args.from_ms is None else args.from_ms,'to':0 if args.to_ms is None else args.to_ms,'keyword':args.keyword or '',
                'speaker':args.speaker or '','limit':10 if args.limit is None else args.limit,'scan_cursor':args.scan_cursor or '',
                'hit_cursor':args.hit_cursor or ''} if args.action==SCAN_ACTION else None
    summary_arguments = [args.summary_day, args.summary_id, args.summary_sha256, args.summary_limit, args.summary_cursor, args.offset, args.max_chars]
    if args.action not in SUMMARY_ACTIONS and any(value is not None for value in summary_arguments):
        parser.error('saved summary flags are only accepted by list-summaries or read-summary')
    saved_summary = None
    if args.action == 'list-summaries':
        if any(value is not None for value in [args.summary_id, args.summary_sha256, args.offset, args.max_chars]):
            parser.error('list-summaries accepts only --summary-day, --summary-limit and --summary-cursor')
        saved_summary = {'day': args.summary_day, 'limit': 10 if args.summary_limit is None else args.summary_limit,
                         'cursor': '' if args.summary_cursor is None else args.summary_cursor}
    elif args.action == 'read-summary':
        if args.summary_limit is not None or args.summary_cursor is not None:
            parser.error('read-summary does not accept list pagination flags')
        saved_summary = {'day': args.summary_day, 'summary_id': args.summary_id, 'content_sha256': args.summary_sha256,
                         'offset': 0 if args.offset is None else args.offset, 'max_chars': 4000 if args.max_chars is None else args.max_chars}
    note_flags = {key: value for key, value in vars(args).items() if key.startswith('note_')}
    note_allowed = {'save-summary-note': {'operation_id', 'file', 'day', 'parent_id', 'parent_sha256', 'source_sha256', 'previous_id', 'previous_sha256'},
                    'resume-summary-note': {'operation_id', 'file', 'day', 'parent_id', 'parent_sha256', 'source_sha256', 'previous_id', 'previous_sha256'},
                    'summary-note-status': {'operation_id'}, 'list-summary-notes': {'day', 'limit', 'cursor'},
                    'read-summary-note': {'day', 'id', 'sha256', 'format', 'offset', 'max_chars'},
                    'read-summary-note-pending': {'operation_id', 'input_sha256'}}
    if any(value is not None and key[5:] not in note_allowed.get(args.action, set()) for key, value in note_flags.items()):
        parser.error('note flags are exclusive to their matching note action')
    annotation, annotation_body = None, None
    try:
        if args.action in NOTE_WRITES:
            if args.note_file is None:
                raise ValueError('note text file is required')
            text_path = Path(args.note_file)
            if not text_path.is_file() or not 0 < text_path.stat().st_size <= 65536:
                raise ValueError('note text file is unavailable or exceeds size bound')
            raw_text = text_path.read_bytes()
            if len(raw_text) > 65536:
                raise ValueError('note text file changed beyond size bound')
            body = {'operation_id': args.note_operation_id,
                    'parent': {'day': args.note_day, 'summary_id': args.note_parent_id, 'content_sha256': args.note_parent_sha256},
                    'source_sha256': args.note_source_sha256, 'text': raw_text.decode('utf-8')}
            if args.note_previous_id is not None or args.note_previous_sha256 is not None:
                body['previous'] = {'day': args.note_day, 'note_id': args.note_previous_id, 'content_sha256': args.note_previous_sha256}
            body = validate_note_input(body)
            annotation_body = note_input_bytes(body)
            annotation = {'operation_id': body['operation_id'], 'body_sha256': hashlib.sha256(annotation_body).hexdigest()}
        elif args.action in ('summary-note-status', 'read-summary-note-pending'):
            annotation = {'operation_id': args.note_operation_id}
            if args.action == 'read-summary-note-pending':
                annotation['input_sha256'] = args.note_input_sha256
        elif args.action == 'list-summary-notes':
            annotation = {'day': args.note_day, 'limit': 10 if args.note_limit is None else args.note_limit, 'cursor': '' if args.note_cursor is None else args.note_cursor}
        elif args.action == 'read-summary-note':
            annotation = {'day': args.note_day, 'note_id': args.note_id, 'content_sha256': args.note_sha256, 'format': 'md' if args.note_format is None else args.note_format,
                          'offset': 0 if args.note_offset is None else args.note_offset, 'max_chars': 4000 if args.note_max_chars is None else args.note_max_chars}
    except (OSError, ValueError):
        parser.error('invalid or unavailable note input; no command sent')
    if args.action == 'cached-power':
        if args.id or args.uid or args.binding_sha256 or args.reply_binding_sha256 or args.recovery_binding_sha256 or args.recovery_source:
            parser.error('cached-power does not accept command bindings')
        folder = PRIVATE / args.device / ('power-' + uuid.uuid4().hex)
        folder.mkdir(parents=True)
        for name in ['last-general-settings.json', 'launcher-rx.jsonl']:
            if not transfer(args.hdc, args.device, 'recv', 'data/storage/el2/base/haps/entry/files/' + name, folder / name):
                raise OSError('cached readback unavailable')
        result = cached_power((folder / 'last-general-settings.json').read_text(encoding='utf-8-sig'),
                              (folder / 'launcher-rx.jsonl').read_text(encoding='utf-8-sig'))
        (folder / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(result))
        return 0
    if args.action == 'reconcile':
        if not re.fullmatch(r'dbg-[a-f0-9]{32}', args.id) or args.uid or args.binding_sha256 or args.reply_binding_sha256 or args.recovery_binding_sha256 or args.recovery_source:
            parser.error('reconcile requires --id only, without bindings')
        command_id = args.id
    else:
        if args.id:
            parser.error('--id is only accepted by reconcile')
        command_id = 'dbg-' + uuid.uuid4().hex
        try:
            command = make_command(args.action, command_id, args.uid, args.binding_sha256, reply_binding_sha256=args.reply_binding_sha256,
                                   recovery_binding_sha256=args.recovery_binding_sha256, recovery_source=args.recovery_source, local_query=local_query, saved_summary=saved_summary, annotation=annotation, playback=playback, recording_summary=recording_summary, todo=todo, local_scan=local_scan)
        except ValueError as error:
            parser.error(str(error))
    note_lock_held = False
    if annotation_body is not None:
        try:
            local_root = stack.enter_context(note_local_lock(args.device))
            note_lock_held = True
            note_staging_capacity(local_root, len(annotation_body))
        except (OSError, ValueError):
            print(json.dumps({'state': 'command_not_sent', 'error': 'NOTE_BLOCKED', 'note': 'local_staging_capacity_busy_or_unverifiable',
                              'next': 'inspect retained local note inputs and reconcile their known IDs; no new command directory or upload attempted; no unknown files deleted'}))
            return 2
    folder = PRIVATE / args.device / command_id
    folder.mkdir(parents=True, exist_ok=True)
    intent = folder / 'command.json'
    if args.action != 'reconcile':
        # Unique local intent is durable before a possibly ambiguous HDC transfer.
        attachment = folder / 'annotation.json'
        if annotation_body is not None:
            with attachment.open('xb') as handle:
                handle.write(annotation_body)
                handle.flush()
                os.fsync(handle.fileno())
        with intent.open('x', encoding='utf-8') as handle:
            json.dump(command, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        print(json.dumps({'id': command_id, 'phase': 'intent_saved', 'channel': 'hdc_private_file',
                          'synthetic_card_only': command['schema'] == 1, 'opens_microphone': False, 'submits_answer': False,
                          'requires_physical_confirmation': command['schema'] == 3,
                          'reads_local_canonical_only': command['schema'] in (5,11), 'may_include_sensitive_excerpts': command['schema'] in (5,11),
                          **({'local_scan_window_only':True,'automatic_continuation':False} if command['schema']==11 else {}),
                          'reads_saved_journals_only': command['schema'] == 6, 'may_include_sensitive_saved_markdown': args.action == 'read-summary',
                          **({'user_note_action_only': True, 'may_include_sensitive_note_input': args.action == 'read-summary-note-pending'} if command['schema'] == 7 else {}),
                          **({'local_playback_control_only': True, 'audio_output_verified': False} if command['schema'] == 8 else {}),
                          **({'recording_summary_job_only':True,'model_text_send_confirmed':args.action in ('recording-summary-start','recording-summary-resume'),
                              'job_id':command['recording_summary'].get('job_id','')} if command['schema']==9 else {}),
                           **({'todo_action_only':True,'todo_delete_send_confirmed':args.action in ('todo-delete','todo-delete-send'),
                               'operation_id':command['todo'].get('operation_id','')} if command['schema']==10 else {}),
                          'restores_paused_local_draft_only': args.action == 'recovery-restore'}), flush=True)
        if annotation_body is not None:
            # The existing bridge has no trustworthy remote inventory API. App
            # rejects over-budget/unknown staging; never sweep orphan files here.
            if not transfer(args.hdc, args.device, 'send', attachment, REMOTE + '/' + command_id + '-annotation.json'):
                print(json.dumps({'id': command_id, 'state': 'command_not_sent', 'next': 'attachment transfer unconfirmed; command transfer not attempted; inspect saved full input; any explicit retry must preserve operation and full input'}))
                return 2
            with (folder / 'command-transfer-attempted.json').open('x', encoding='utf-8') as marker:
                json.dump({'id': command_id, 'command_transfer_attempted': True}, marker)
                marker.flush()
                os.fsync(marker.fileno())
        if not transfer(args.hdc, args.device, 'send', intent, REMOTE + '/command.json'):
            print(json.dumps({'id': command_id, 'state': 'unknown', 'next': 'reconcile only; do not resend'}))
            return 2
    deadline = time.monotonic() + 15
    receipt = folder / 'result.json'
    while time.monotonic() < deadline:
        if transfer(args.hdc, args.device, 'recv', REMOTE + '/' + command_id + '.json', receipt):
            if not 0 < receipt.stat().st_size <= MAX_RESULT_BYTES:
                raise ValueError('debug result exceeds bounded size')
            result = json.loads(receipt.read_text(encoding='utf-8-sig'))
            if result.get('schema') != 1 or result.get('id') != command_id:
                raise ValueError('unexpected result binding')
            if intent.exists() and json.loads(result['request_json']) != json.loads(intent.read_text(encoding='utf-8')):
                raise ValueError('unexpected command bytes')
            if result['state'] in ('complete', 'error'):
                task_result = result.get('task_snapshot') or {}
                if not isinstance(task_result, dict):
                    raise ValueError('unexpected task snapshot')
                recovery_result = result.get('recovery_snapshot')
                if recovery_result is not None and not isinstance(recovery_result, dict):
                    raise ValueError('unexpected recovery snapshot')
                local_result = result.get('local_query')
                received_command = json.loads(result['request_json'])
                scan_action=received_command.get('schema')==11 and received_command.get('action')==SCAN_ACTION
                scan_result=result.get('local_scan')
                if scan_action:
                    if any(result.get(key) is not None for key in ['task_snapshot','recovery_snapshot','local_query','saved_summaries','saved_summary','summary_note_receipt','summary_notes','summary_note_chunk','summary_note_pending','playback_snapshot','recording_summary_preview','recording_summary_view','recording_summary_list','recording_summary_chunk','recording_summary_piece','todo_page','todo_deletion','todo_query']):
                        raise ValueError('unexpected unrelated data in local scan receipt')
                    validate_local_scan_result(received_command,scan_result,result['state'])
                elif scan_result is not None:
                    raise ValueError('unexpected local scan data')
                local_search = received_command.get('schema') == 5 and received_command.get('action') == LOCAL_ACTION
                if local_result is not None and (not local_search or not isinstance(local_result, dict) or local_result.get('schema') != 1 or
                        local_result.get('scope') != 'local_canonical_only' or not isinstance(local_result.get('hits'), list) or len(local_result['hits']) > 10):
                    raise ValueError('unexpected local query result')
                if local_search and result['state'] == 'complete' and local_result is None:
                    raise ValueError('missing local query result')
                summary_read = received_command.get('schema') == 6 and received_command.get('action') in SUMMARY_ACTIONS
                saved_page, saved_chunk = result.get('saved_summaries'), result.get('saved_summary')
                if summary_read:
                    if result.get('task_snapshot') is not None or recovery_result is not None or local_result is not None:
                        raise ValueError('unexpected task or query data in a saved summary receipt')
                    validate_saved_result(received_command, saved_page, saved_chunk, result['state'])
                elif saved_page is not None or saved_chunk is not None:
                    raise ValueError('unexpected saved summary data')
                note_action = received_command.get('schema') == 7 and received_command.get('action') in NOTE_ACTIONS
                note_receipt, note_page, note_chunk, note_pending = [result.get(key) for key in ['summary_note_receipt', 'summary_notes', 'summary_note_chunk', 'summary_note_pending']]
                if note_action:
                    if result.get('task_snapshot') is not None or recovery_result is not None or local_result is not None or saved_page is not None or saved_chunk is not None:
                        raise ValueError('unexpected unrelated data in note receipt')
                    validate_note_result(received_command, note_receipt, note_page, note_chunk, note_pending, result['state'])
                elif any(value is not None for value in [note_receipt, note_page, note_chunk, note_pending]):
                    raise ValueError('unexpected note data')
                playback_action = received_command.get('schema') == 8 and received_command.get('action') in PLAYBACK_ACTIONS
                playback_snapshot = result.get('playback_snapshot')
                if playback_action:
                    if result.get('task_snapshot') is not None or recovery_result is not None or local_result is not None or saved_page is not None or saved_chunk is not None or any(value is not None for value in [note_receipt,note_page,note_chunk,note_pending]):
                        raise ValueError('unexpected unrelated data in playback receipt')
                    validate_playback_result(received_command, playback_snapshot, result['state'])
                elif playback_snapshot is not None:
                    raise ValueError('unexpected playback data')
                recording_action=received_command.get('schema')==9 and received_command.get('action') in RECORDING_ACTIONS
                recording_fields=['recording_summary_preview','recording_summary_view','recording_summary_list','recording_summary_chunk','recording_summary_piece']
                if recording_action:
                    if any(result.get(key) is not None for key in ['task_snapshot','recovery_snapshot','local_query','saved_summaries','saved_summary','summary_note_receipt','summary_notes','summary_note_chunk','summary_note_pending','playback_snapshot']):
                        raise ValueError('unexpected unrelated data in recording summary receipt')
                    validate_recording_result(received_command,result)
                elif any(result.get(key) is not None for key in recording_fields):
                    raise ValueError('unexpected recording summary data')
                todo_action=received_command.get('schema')==10 and received_command.get('action') in TODO_ACTIONS
                todo_fields=['todo_page','todo_deletion','todo_query']
                if todo_action:
                    if any(result.get(key) is not None for key in ['task_snapshot','recovery_snapshot','local_query','saved_summaries','saved_summary','summary_note_receipt','summary_notes','summary_note_chunk','summary_note_pending','playback_snapshot',*recording_fields]):
                        raise ValueError('unexpected unrelated data in todo receipt')
                    validate_todo_result(received_command,result)
                elif any(result.get(key) is not None for key in todo_fields):
                    raise ValueError('unexpected todo data')
                error_code = result['error']
                if scan_action and error_code not in ('','LOCAL_QUERY_STALE','LOCAL_QUERY_INVALID','LOCAL_SCAN_UNAVAILABLE','DEBUG_OPERATION_FAILED','DEBUG_COMMAND_EXPIRED'):
                    error_code='DEBUG_OPERATION_FAILED'
                if summary_read and error_code not in ('', 'SAVED_SUMMARY_STALE', 'SAVED_SUMMARY_INVALID', 'DEBUG_OPERATION_FAILED', 'DEBUG_COMMAND_EXPIRED'):
                    error_code = 'DEBUG_OPERATION_FAILED'
                if note_action and error_code not in ('', 'NOTE_INVALID', 'NOTE_STALE', 'NOTE_CONFLICT', 'NOTE_BLOCKED', 'NOTE_IO', 'DEBUG_OPERATION_FAILED', 'DEBUG_COMMAND_EXPIRED'):
                    error_code = 'DEBUG_OPERATION_FAILED'
                if playback_action and error_code not in ('', *PLAYBACK_ERRORS, 'DEBUG_OPERATION_FAILED', 'DEBUG_COMMAND_EXPIRED'):
                    error_code = 'DEBUG_OPERATION_FAILED'
                if recording_action and error_code not in ('',*RECORDING_ERRORS,'DEBUG_OPERATION_FAILED','DEBUG_COMMAND_EXPIRED'):
                    error_code='DEBUG_OPERATION_FAILED'
                if todo_action and error_code not in ('',*TODO_ERRORS,'DEBUG_COMMAND_EXPIRED'):
                    error_code='TODO_FAILED'
                if note_action and received_command['action'] in NOTE_WRITES and intent.exists():
                    try:
                        if note_lock_held:
                            cleanup_local_note(folder, received_command, result)
                        else:
                            with note_local_lock(args.device, create=False):
                                cleanup_local_note(folder, received_command, result)
                    except (OSError, ValueError):
                        pass  # Retained matching copy still counts against quota.
                # CLI completion is transport/control evidence, never lens observation.
                print(json.dumps({'id': command_id, 'state': result['state'], 'error': error_code,
                                  'started_at': result['started_at'], 'finished_at': result['finished_at'],
                                  'snapshot': result['snapshot'], 'task_snapshot': result.get('task_snapshot'),
                                  'recovery_snapshot': recovery_result,
                                  'local_query': local_result, 'contains_sensitive_local_excerpts': local_result is not None or scan_result is not None,
                                  **({'local_scan':scan_result,'local_scan_window_only':True,'automatic_continuation':False} if scan_action else {}),
                                  'saved_summaries': saved_page, 'saved_summary': saved_chunk, 'contains_sensitive_saved_markdown': saved_chunk is not None,
                                  **({'summary_note_receipt': note_receipt, 'summary_notes': note_page, 'summary_note_chunk': note_chunk, 'summary_note_pending': note_pending,
                                      'contains_sensitive_note_input': note_pending is not None, 'contains_sensitive_note_export': note_chunk is not None,
                                      'annotation_saved': note_saved_state(note_receipt)} if note_action else {}),
                                  **({'playback_snapshot': playback_snapshot, 'audio_output_verified': False} if playback_action else {}),
                                  **({**{key:result.get(key) for key in recording_fields},'summary_ready':(result.get('recording_summary_view') or {}).get('phase')=='ready',
                                      'contains_sensitive_recording_summary':result.get('recording_summary_chunk') is not None or result.get('recording_summary_piece') is not None or bool((result.get('recording_summary_view') or {}).get('entries'))} if recording_action else {}),
                                  **({key:result.get(key) for key in todo_fields} if todo_action else {}),
                                  'control_call_completed': result.get('control_call_completed', result['state'] == 'complete'),
                                  'draft_saved': task_result.get('draft_saved', False),
                                  'completion_scope': 'local_canonical_window_only; window hit pagination and source scan continuation are separate explicit commands; zero window hits is not proof of no matches elsewhere; order is local to this window; legacy coverage remains excluded; reconcile reads the frozen receipt without scanning again; no microphone, model, network, delete or task effects' if scan_action else 'todo_control_only; local deletion, send submission, unattributed receipt and query observation are separate; query absence is not device confirmation; inspect a new todo-delete-status/todo-query-status; reconcile reads the prior receipt without resending; no microphone or Agent task effects' if todo_action else 'recording_summary_control_only; complete is not ready; inspect a new recording-summary-status; only confirmed start/resume may schedule configured model calls; reconcile reads the prior receipt without resending; no microphone, todo or Agent task effects' if recording_action else 'local_playback_control_only; saved receipt is not current status; use a new playback-status; native callbacks are not proof of audible output; no microphone, task or network effects' if playback_action else 'local_user_note_only; inspect receipt state separately from command completion; pending read is explicit sensitive input, never resume; chunk text is full-ref-bound UTF16 md/json; no generation, device, task or network effects' if note_action else 'local_saved_journal_read_only; metadata or one explicit full-file-bound UTF16 chunk; follow next_offset while has_more with the same reference, concatenate exact chunks then verify content_sha256; no generation, device, task or network effects' if summary_read else 'local_canonical_query_only; requested excerpts may be sensitive; incomplete and legacy coverage are explicit; no device or task effects' if local_search else 'local_recovery_control_only; inspect recovery-status and task-status; no answer submitted' if recovery_result is not None else 'control_call_only; inspect a new task-status for durable draft state',
                                  'lens_display_verified': False}, ensure_ascii=False))
                return 0 if result['state'] == 'complete' else 1
        time.sleep(0.5)
    print(json.dumps({'id': command_id, 'state': 'unknown_or_running', 'next': 'reconcile --id ' + command_id,
                      'requires': 'debug candidate installed, iO foreground; no automatic unlock or restart'}))
    return 2


def main():
    with ExitStack() as stack:
        return _main(stack)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'error': type(error).__name__, 'next': 'inspect saved intent and reconcile; never blindly resend'}))
        sys.exit(2)
