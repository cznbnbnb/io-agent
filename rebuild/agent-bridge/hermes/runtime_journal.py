"""Runtime-owned operation claims and delayed events; separate from bridge outbox.

No model/tool execution here. A claimed operation never becomes permission to
execute again merely because the process died or a network response was lost.
"""
from contextlib import contextmanager
import json
import os
import re
from pathlib import Path
import sqlite3
import stat
import threading
import hashlib
import math
from datetime import datetime, timezone


class RuntimeJournalError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def identifier(value, maximum=128):
    if not isinstance(value, str) or not value or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise RuntimeJournalError('RUNTIME_ID_INVALID')
    return value


def timestamp(value):
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value):
            raise ValueError()
        parsed = datetime.fromisoformat(value[:-1] + '+00:00')
        # Server envelopes use JavaScript millisecond timestamps.
        return math.floor(parsed.timestamp() * 1000) / 1000
    except (ValueError, OverflowError):
        raise RuntimeJournalError('RUNTIME_TIME_INVALID') from None


class RuntimeJournal:
    APPLICATION_ID = 0x694F5274
    @classmethod
    def open_readonly(cls, file, binding):
        """Inspect an existing journal without initializing or migrating it."""
        original = Path(file).absolute()
        info = original.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeJournalError('RUNTIME_FILE_UNSAFE')
        journal = cls.__new__(cls)
        journal.file, journal.binding = original, dict(binding)
        journal.lock, journal.db = threading.RLock(), None
        try:
            journal.db = sqlite3.connect(original.as_uri() + '?mode=ro', uri=True,
                                         timeout=5, isolation_level=None)
            journal.db.row_factory = sqlite3.Row
            if (journal.db.execute('PRAGMA application_id').fetchone()[0] != cls.APPLICATION_ID
                    or journal.db.execute('PRAGMA user_version').fetchone()[0] != 3):
                raise RuntimeJournalError('RUNTIME_REVIEW_SCHEMA_UNSUPPORTED')
            row = journal.db.execute('SELECT value FROM metadata WHERE key=?', ('binding',)).fetchone()
            if row is None or row[0] != encode(binding):
                raise RuntimeJournalError('RUNTIME_BINDING_MISMATCH')
            return journal
        except Exception:
            journal.close()
            raise

    def __init__(self, file, binding):
        self.file = Path(file).absolute()
        self.lock = threading.RLock()
        self.db = None
        expected_keys = {'server_id', 'owner_id', 'producer_id', 'computer_id', 'agent_id'}
        if not isinstance(binding, dict) or set(binding) != expected_keys:
            raise RuntimeJournalError('RUNTIME_BINDING_INVALID')
        for value in binding.values():
            identifier(value)
        self.binding = dict(binding)
        self.file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.file.exists() or self.file.is_symlink():
            info = self.file.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise RuntimeJournalError('RUNTIME_FILE_UNSAFE')
        else:
            try:
                fd = os.open(self.file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
            except FileExistsError:
                # A simultaneous initializer must be validated just like an
                # existing journal; never follow a raced-in link.
                info = self.file.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise RuntimeJournalError('RUNTIME_FILE_UNSAFE')
        try:
            self.db = sqlite3.connect(self.file, timeout=5, isolation_level=None, check_same_thread=False)
            self.db.row_factory = sqlite3.Row
            with self.transaction():
                app_id = self.db.execute('PRAGMA application_id').fetchone()[0]
                tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if app_id == 0 and not tables:
                    self.db.execute('PRAGMA application_id=' + str(self.APPLICATION_ID))
                    self.db.execute('PRAGMA user_version=1')
                    self.db.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
                    self.db.execute('CREATE TABLE operations (operation_id TEXT PRIMARY KEY,delivery_id TEXT UNIQUE NOT NULL,source TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT)')
                    self.db.execute('CREATE TABLE runtime_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,delivery_id TEXT NOT NULL,event TEXT NOT NULL,acked INTEGER NOT NULL DEFAULT 0)')
                    self.db.execute('INSERT INTO metadata VALUES (?,?)', ('binding', encode(binding)))
                elif app_id != self.APPLICATION_ID or self.db.execute('PRAGMA user_version').fetchone()[0] not in {1, 2, 3}:
                    raise RuntimeJournalError('RUNTIME_FOREIGN_DATABASE')
                row = self.db.execute('SELECT value FROM metadata WHERE key=?', ('binding',)).fetchone()
                if row is None or row[0] != encode(binding):
                    raise RuntimeJournalError('RUNTIME_BINDING_MISMATCH')
                if self.db.execute('PRAGMA user_version').fetchone()[0] == 1:
                    self.db.execute('CREATE TABLE questions (request_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,question_key TEXT NOT NULL,spec TEXT NOT NULL,state TEXT NOT NULL,answer TEXT,UNIQUE(operation_id,question_key))')
                    self.db.execute('PRAGMA user_version=2')
                if self.db.execute('PRAGMA user_version').fetchone()[0] == 2:
                    self.db.execute('CREATE TABLE operation_controls (operation_id TEXT PRIMARY KEY,cancel_requested INTEGER NOT NULL DEFAULT 0)')
                    self.db.execute('CREATE TABLE native_turns (operation_id TEXT PRIMARY KEY,state TEXT NOT NULL,payload TEXT,process_closed INTEGER NOT NULL DEFAULT 0)')
                    self.db.execute('ALTER TABLE questions ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0')
                    self.db.execute('PRAGMA user_version=3')
            self.db.execute('PRAGMA synchronous=FULL')
        except RuntimeJournalError:
            self.close()
            raise
        except Exception:
            self.close()
            raise RuntimeJournalError('RUNTIME_JOURNAL_UNAVAILABLE') from None

    @contextmanager
    def transaction(self):
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            self.db.execute('BEGIN IMMEDIATE')
            try:
                yield
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise

    def _source(self, source):
        if not isinstance(source, dict) or source.get('kind') not in {'task', 'request'}:
            raise RuntimeJournalError('RUNTIME_SOURCE_INVALID')
        identifier(source.get('object_id'))
        if type(source.get('revision')) is not int or source['revision'] < 1:
            raise RuntimeJournalError('RUNTIME_SOURCE_INVALID')
        body = source.get('body')
        route = body.get('route') if isinstance(body, dict) else None
        if not isinstance(route, dict) or set(route) != {'computer_id', 'agent_id', 'project_id', 'session_id'}:
            raise RuntimeJournalError('RUNTIME_ROUTE_INVALID')
        for value in route.values():
            identifier(value)
        if route['computer_id'] != self.binding['computer_id'] or route['agent_id'] != self.binding['agent_id']:
            raise RuntimeJournalError('RUNTIME_ROUTE_MISMATCH')
        identifier(body.get('task_id'))
        if body.get(source['kind'] + '_id') != source['object_id'] or body.get('revision') != source['revision']:
            raise RuntimeJournalError('RUNTIME_SOURCE_INVALID')
        result = {key: source[key] for key in ['kind', 'object_id', 'revision', 'body']}
        for key in ['expires_at', 'command_expires_at']:
            if key in source:
                timestamp(source[key])
                result[key] = source[key]
        return encode(result)

    def admit(self, operation_id, delivery_id, source, payload, event=None):
        identifier(operation_id)
        identifier(delivery_id, 1024)
        encoded_source, encoded_payload = self._source(source), encode(payload)
        if len(encoded_source.encode('utf-8')) + len(encoded_payload.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_OPERATION_TOO_LARGE')
        with self.transaction():
            prior = self.db.execute('SELECT * FROM operations WHERE operation_id=?', (operation_id,)).fetchone()
            if prior is not None:
                if (prior['delivery_id'], prior['source'], prior['payload']) != (delivery_id, encoded_source, encoded_payload):
                    raise RuntimeJournalError('RUNTIME_OPERATION_CONFLICT')
            else:
                if self.db.execute('SELECT 1 FROM operations WHERE delivery_id=?', (delivery_id,)).fetchone():
                    raise RuntimeJournalError('RUNTIME_DELIVERY_CONFLICT')
                self.db.execute('INSERT INTO operations VALUES (?,?,?,?,?,NULL)', (operation_id, delivery_id, encoded_source, encoded_payload, 'admitted'))
            if event is not None:
                if not isinstance(event, dict) or event.get('delivery_id') != delivery_id:
                    raise RuntimeJournalError('RUNTIME_DELIVERY_CONFLICT')
                self._event(event)
            return self.operation(operation_id)

    def operations_in_state(self, state, limit=1000):
        if state not in {'admitted', 'claimed', 'unknown'} or type(limit) is not int or not 1 <= limit <= 1000:
            raise RuntimeJournalError('RUNTIME_LIMIT_INVALID')
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            return [dict(row) for row in self.db.execute('SELECT * FROM operations WHERE state=? ORDER BY rowid LIMIT ?', (state, limit))]

    def inspect_admission(self, delivery_id, source):
        """Prove only the original queued-task intake, without running anything.

        The scheduler's intake response for this case is always []. The atomic
        admission event remains evidence even after its transport ACK. Other
        handoffs (answers, cancellation, closed questions) are not recoverable
        through this proof.
        """
        identifier(delivery_id, 1024)
        encoded_source = self._source(source)
        normalized = json.loads(encoded_source)
        body = normalized['body']
        if normalized['kind'] != 'task' or normalized['revision'] != 1 or body.get('state') != 'queued' or \
           body.get('allow_create_session') is not False or delivery_id != 'item:task:' + normalized['object_id'] + ':1':
            raise RuntimeJournalError('RUNTIME_ADMISSION_SOURCE_INVALID')
        operation_id = 'op-' + hashlib.sha256(encode(body['task_id']).encode('utf-8')).hexdigest()
        event_id = 'rt-' + hashlib.sha256(encode([operation_id, 'admitted']).encode('utf-8')).hexdigest()
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            row = self.db.execute('SELECT * FROM operations WHERE operation_id=? AND delivery_id=?', (operation_id, delivery_id)).fetchone()
            if row is None:
                return {'status': 'not_proven'}
            if row['source'] != encoded_source or row['payload'] != encode({'text': body.get('command')}):
                raise RuntimeJournalError('RUNTIME_ADMISSION_CONFLICT')
            receipt = {'action': 'receipt', 'stage': 'agent_received', 'subject_kind': 'task',
                       'subject_id': body['task_id'], 'subject_revision': 1}
            expected = {'event_id': event_id, 'delivery_id': delivery_id,
                        'actions': [{'action': 'task_state', 'state': 'agent_received'}, receipt]}
            event = self.db.execute('SELECT event FROM runtime_events WHERE event_id=? AND delivery_id=?', (event_id, delivery_id)).fetchone()
            if event is None or event[0] != encode(expected):
                return {'status': 'not_proven'}
            return {'status': 'admitted', 'delivery_id': delivery_id, 'operation_id': operation_id,
                    'admitted_event_id': event_id, 'source': normalized}

    def settle_unstarted(self, operation_id, state, outcome, event):
        """Only work never claimed can be expired/cancelled without a runner."""
        if state not in {'cancelled', 'expired', 'failed'}:
            raise RuntimeJournalError('RUNTIME_OUTCOME_INVALID')
        encoded = encode(outcome)
        if len(encoded.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_OUTCOME_INVALID')
        with self.transaction():
            prior = self.operation(operation_id)
            if prior is None or not isinstance(event, dict) or event.get('delivery_id') != prior['delivery_id']:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            if prior['state'] != 'admitted':
                existing = self.db.execute('SELECT event FROM runtime_events WHERE event_id=?', (event.get('event_id'),)).fetchone()
                if prior['state'] == state and prior['outcome'] == encoded and existing is not None and existing['event'] == encode(event):
                    return
                raise RuntimeJournalError('RUNTIME_OPERATION_NOT_QUEUED')
            self._event(event)
            self.db.execute('UPDATE operations SET state=?,outcome=? WHERE operation_id=?', (state, encoded, operation_id))

    def operation(self, operation_id):
        identifier(operation_id)
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            row = self.db.execute('SELECT * FROM operations WHERE operation_id=?', (operation_id,)).fetchone()
            return dict(row) if row else None

    def claim(self, operation_id):
        identifier(operation_id)
        with self.transaction():
            changed = self.db.execute("UPDATE operations SET state='claimed' WHERE operation_id=? AND state='admitted'", (operation_id,)).rowcount
            if not changed and self.operation(operation_id) is None:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            return bool(changed)

    def operation_for_task(self, task_id):
        identifier(task_id)
        with self.lock:
            rows = self.db.execute("SELECT * FROM operations WHERE json_extract(source,'$.body.task_id')=?", (task_id,)).fetchall()
            if len(rows) > 1:
                raise RuntimeJournalError('RUNTIME_TASK_CONFLICT')
            return dict(rows[0]) if rows else None

    def request_cancel(self, operation_id):
        with self.transaction():
            if self.operation(operation_id) is None:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            self.db.execute('INSERT INTO operation_controls VALUES (?,1) ON CONFLICT(operation_id) DO UPDATE SET cancel_requested=1', (operation_id,))

    def cancellation_requested(self, operation_id):
        with self.lock:
            row = self.db.execute('SELECT cancel_requested FROM operation_controls WHERE operation_id=?', (operation_id,)).fetchone()
            return bool(row and row[0])

    def native_started(self, operation_id):
        """Pinned wrapper calls this immediately before the original run method."""
        with self.transaction():
            operation = self.operation(operation_id)
            if operation is None or operation['state'] != 'claimed':
                raise RuntimeJournalError('RUNTIME_OPERATION_NOT_ACTIVE')
            if self.db.execute('SELECT 1 FROM native_turns WHERE operation_id=?', (operation_id,)).fetchone():
                raise RuntimeJournalError('RUNTIME_NATIVE_ALREADY_STARTED')
            self.db.execute("INSERT INTO native_turns VALUES (?,'started',NULL,0)", (operation_id,))

    def native_returned(self, operation_id, payload, raised=False):
        encoded = encode(payload)
        if len(encoded.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_OUTCOME_INVALID')
        with self.transaction():
            row = self.db.execute('SELECT state FROM native_turns WHERE operation_id=?', (operation_id,)).fetchone()
            if row is None or row[0] != 'started':
                raise RuntimeJournalError('RUNTIME_NATIVE_NOT_STARTED')
            self.db.execute('UPDATE native_turns SET state=?,payload=? WHERE operation_id=?', ('raised' if raised else 'returned', encoded, operation_id))

    def native_process_closed(self, operation_id):
        """Owner-only, after confirmed ACP leader and tool descendant exit."""
        with self.transaction():
            self.db.execute('UPDATE native_turns SET process_closed=1 WHERE operation_id=?', (operation_id,))

    def native_observation(self, operation_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM native_turns WHERE operation_id=?', (operation_id,)).fetchone()
            return {**dict(row), 'payload': json.loads(row['payload']) if row['payload'] else None} if row else None

    def review_snapshot(self, operation_id):
        """Stable task evidence, excluding network event ACKs and unrelated tasks."""
        identifier(operation_id)
        with self.lock:
            own_transaction = not self.db.in_transaction
            if own_transaction:
                self.db.execute('BEGIN')
            try:
                operation = self.operation(operation_id)
                if operation is None:
                    raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
                questions = [dict(row) for row in self.db.execute(
                    'SELECT * FROM questions WHERE operation_id=? ORDER BY request_id LIMIT 257', (operation_id,))]
                if len(questions) > 256:
                    raise RuntimeJournalError('RUNTIME_REVIEW_TOO_LARGE')
                snapshot = {'binding': self.binding, 'operation': operation,
                            'native': self.native_observation(operation_id),
                            'cancel_requested': self.cancellation_requested(operation_id),
                            'questions': questions}
                if len(encode(snapshot).encode('utf-8')) > 8388608:
                    raise RuntimeJournalError('RUNTIME_REVIEW_TOO_LARGE')
                return snapshot
            finally:
                if own_transaction:
                    self.db.execute('ROLLBACK')  # Read transaction only.

    def reconcile_unknown(self, operation_id, expected_digest, state, audit, event):
        """Trusted administration only: keep unknown history and publish once.

        Caller must hold managed-home ownership and verify the decision evidence.
        This never claims an operation or replays a model/tool prompt.
        """
        if state not in {'completed', 'failed', 'cancelled'} or not isinstance(audit, dict):
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
        if not isinstance(expected_digest, str) or not re.fullmatch('[0-9a-f]{64}', expected_digest):
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
        if len(encode(audit).encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_RECONCILIATION_INVALID')
        with self.transaction():
            prior = self.operation(operation_id)
            if prior is None or not isinstance(event, dict) or event.get('delivery_id') != prior['delivery_id']:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            if prior['state'] != 'unknown':
                outcome = json.loads(prior['outcome']) if prior['outcome'] else {}
                existing = self.db.execute('SELECT event FROM runtime_events WHERE event_id=?', (event.get('event_id'),)).fetchone()
                if (prior['state'] == state and outcome.get('reconciliation') == audit
                        and existing is not None and existing['event'] == encode(event)):
                    return False
                raise RuntimeJournalError('RUNTIME_RECONCILIATION_CONFLICT')
            snapshot = self.review_snapshot(operation_id)
            if hashlib.sha256(encode(snapshot).encode('utf-8')).hexdigest() != expected_digest:
                raise RuntimeJournalError('RUNTIME_REVIEW_STALE')
            self._event(event)
            outcome = {'reason': 'explicit_reconciliation',
                       'prior_outcome': json.loads(prior['outcome']) if prior['outcome'] else None,
                       'reconciliation': audit}
            self.db.execute('UPDATE operations SET state=?,outcome=? WHERE operation_id=?',
                            (state, encode(outcome), operation_id))
            return True

    def _event(self, event):
        if not isinstance(event, dict) or set(event) != {'event_id', 'delivery_id', 'actions'}:
            raise RuntimeJournalError('RUNTIME_EVENT_INVALID')
        identifier(event['event_id'])
        if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', event['event_id']):
            raise RuntimeJournalError('RUNTIME_EVENT_INVALID')
        identifier(event['delivery_id'], 1024)
        if not isinstance(event['actions'], list) or len(event['actions']) > 20:
            raise RuntimeJournalError('RUNTIME_EVENT_INVALID')
        value = encode(event)
        if len(value.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_EVENT_TOO_LARGE')
        if self.db.execute('SELECT 1 FROM operations WHERE delivery_id=?', (event['delivery_id'],)).fetchone() is None:
            raise RuntimeJournalError('RUNTIME_DELIVERY_UNKNOWN')
        prior = self.db.execute('SELECT event FROM runtime_events WHERE event_id=?', (event['event_id'],)).fetchone()
        if prior is not None:
            if prior['event'] != value:
                raise RuntimeJournalError('RUNTIME_EVENT_CONFLICT')
            return False
        self.db.execute('INSERT INTO runtime_events (event_id,delivery_id,event) VALUES (?,?,?)', (event['event_id'], event['delivery_id'], value))
        return True

    def append_event(self, event):
        with self.transaction():
            return self._event(event)

    def ask(self, operation_id, question_key, question, mode, options, expires_at, now=None):
        """Model-facing creation; all routing comes from the admitted operation."""
        identifier(operation_id)
        identifier(question_key)
        if not isinstance(question, str) or not question.strip() or len(question) > 4096:
            raise RuntimeJournalError('RUNTIME_QUESTION_INVALID')
        if mode not in {'choice', 'free_text'} or not isinstance(options, list):
            raise RuntimeJournalError('RUNTIME_QUESTION_INVALID')
        if mode == 'free_text' and options or mode == 'choice' and not 2 <= len(options) <= 4:
            raise RuntimeJournalError('RUNTIME_OPTIONS_INVALID')
        ids = set()
        for option in options:
            if not isinstance(option, dict) or set(option) != {'option_id', 'label'}:
                raise RuntimeJournalError('RUNTIME_OPTIONS_INVALID')
            identifier(option['option_id'], 512)
            if option['option_id'] in ids or not isinstance(option['label'], str) or not option['label'].strip() or len(option['label']) > 512:
                raise RuntimeJournalError('RUNTIME_OPTIONS_INVALID')
            ids.add(option['option_id'])
        deadline = timestamp(expires_at)
        now = datetime.now(timezone.utc).timestamp() if now is None else now
        suffix = hashlib.sha256(encode([operation_id, question_key]).encode('utf-8')).hexdigest()
        request_id, runtime_id = 'req-' + suffix, 'wait-' + suffix
        spec = {'request_id': request_id, 'runtime_request_id': runtime_id, 'question': question,
                'mode': mode, 'options': options, 'expires_at': expires_at}
        encoded = encode(spec)
        with self.transaction():
            operation = self.operation(operation_id)
            if operation is None:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            prior = self.db.execute('SELECT spec FROM questions WHERE request_id=?', (request_id,)).fetchone()
            if prior is not None:
                if prior[0] != encoded:
                    raise RuntimeJournalError('RUNTIME_QUESTION_CONFLICT')
                return self.reply(operation_id, request_id, now=now)
            if operation['state'] != 'claimed':
                raise RuntimeJournalError('RUNTIME_OPERATION_NOT_ACTIVE')
            if not now < deadline <= now + 3600:
                raise RuntimeJournalError('RUNTIME_DEADLINE_INVALID')
            self.db.execute('INSERT INTO questions (request_id,operation_id,question_key,spec,state,answer) VALUES (?,?,?,?,?,NULL)',
                            (request_id, operation_id, question_key, encoded, 'pending'))
            self._event({'event_id': 'ask-' + suffix, 'delivery_id': operation['delivery_id'],
                         'actions': [{'action': 'request', **spec}, {'action': 'task_state', 'state': 'waiting_answer'}]})
            return self.reply(operation_id, request_id, now=now)

    def consume_answer(self, operation_id, request_id, now=None):
        """A real wait tool read, not adapter receipt, is the resumption boundary."""
        with self.transaction():
            reply = self.reply(operation_id, request_id, now=now)
            if reply['state'] != 'answered':
                return reply
            operation = self.operation(operation_id)
            row = self.db.execute('SELECT consumed FROM questions WHERE request_id=?', (request_id,)).fetchone()
            if not row[0]:
                source = json.loads(operation['source'])
                self._event({'event_id': 'resume-' + hashlib.sha256(request_id.encode()).hexdigest(),
                    'delivery_id': operation['delivery_id'], 'actions': [
                        {'action': 'task_state', 'state': 'running'},
                        {'action': 'receipt', 'stage': 'task_resumed', 'subject_kind': 'task',
                         'subject_id': source['body']['task_id'], 'subject_revision': source['revision']}]})
                self.db.execute('UPDATE questions SET consumed=1 WHERE request_id=?', (request_id,))
            return reply

    def reply(self, operation_id, request_id, now=None):
        identifier(operation_id)
        identifier(request_id)
        with self.lock:
            operation = self.operation(operation_id)
            row = self.db.execute('SELECT * FROM questions WHERE request_id=? AND operation_id=?', (request_id, operation_id)).fetchone()
            if operation is None or row is None:
                raise RuntimeJournalError('RUNTIME_QUESTION_UNKNOWN')
            spec = json.loads(row['spec'])
            now = datetime.now(timezone.utc).timestamp() if now is None else now
            # A local clock passing the deadline does not prove that the server
            # failed to accept an answer earlier. Only adapter reconciliation
            # may close the wait. Never re-execute a settled operation.
            return {'request_id': request_id, 'runtime_request_id': spec['runtime_request_id'],
                    'state': row['state'] if operation['state'] == 'claimed' else 'operation_closed',
                    'expires_at': spec['expires_at'], 'deadline_elapsed': now >= timestamp(spec['expires_at']),
                    'answer': json.loads(row['answer']) if row['answer'] else None}

    def record_answer(self, operation_id, request, answer):
        """Adapter-only: caller must supply authenticated server queue objects."""
        if not isinstance(request, dict) or not isinstance(answer, dict):
            raise RuntimeJournalError('RUNTIME_ANSWER_INVALID')
        req, body = request.get('body'), answer.get('body')
        if not isinstance(req, dict) or not isinstance(body, dict):
            raise RuntimeJournalError('RUNTIME_ANSWER_INVALID')
        identifier(answer.get('object_id'))
        with self.transaction():
            operation = self.operation(operation_id)
            row = self.db.execute('SELECT * FROM questions WHERE request_id=? AND operation_id=?', (request.get('object_id'), operation_id)).fetchone()
            if row is None or operation is None:
                raise RuntimeJournalError('RUNTIME_QUESTION_UNKNOWN')
            value = self._answer_value(operation, row, request, answer)
            if row['answer'] is not None:
                if row['answer'] != value:
                    raise RuntimeJournalError('RUNTIME_ANSWER_CONFLICT')
                return False
            if operation['state'] != 'claimed' or row['state'] != 'pending':
                raise RuntimeJournalError('RUNTIME_QUESTION_CLOSED')
            self.db.execute("UPDATE questions SET state='answered',answer=? WHERE request_id=?", (value, request['object_id']))
            return True

    def _answer_value(self, operation, row, request, answer):
        """Validate the same original question/answer for intake and its probe."""
        req, body = request.get('body'), answer.get('body')
        if not isinstance(req, dict) or not isinstance(body, dict):
            raise RuntimeJournalError('RUNTIME_ANSWER_INVALID')
        identifier(answer.get('object_id'))
        spec = json.loads(row['spec'])
        origin = json.loads(operation['source'])['body']
        if request.get('kind') != 'request' or request.get('revision') != 1 or req.get('revision') != 1 or req.get('request_id') != spec['request_id'] or \
           answer.get('kind') != 'answer' or answer.get('revision') != 1 or body.get('answer_id') != answer['object_id'] or \
           req.get('runtime_request_id') != spec['runtime_request_id'] or body.get('request_id') != spec['request_id'] or body.get('request_revision') != 1 or \
           any(value.get('task_id') != origin['task_id'] or value.get('route') != origin['route'] for value in [req, body]) or \
           any(req.get(key) != spec[key] for key in ['question', 'mode', 'options']):
            raise RuntimeJournalError('RUNTIME_ANSWER_ROUTE_MISMATCH')
        if timestamp(answer.get('stored_at')) >= timestamp(spec['expires_at']):
            raise RuntimeJournalError('RUNTIME_ANSWER_EXPIRED')
        if body.get('option_id') is not None and (not isinstance(body['option_id'], str) or body['option_id'] not in {option['option_id'] for option in spec['options']}) or \
           not isinstance(body.get('text'), str) or len(body['text']) > 16384 or (body.get('option_id') is None and not body['text'].strip()):
            raise RuntimeJournalError('RUNTIME_ANSWER_INVALID')
        return encode({'answer_id': answer['object_id'], 'stored_at': answer['stored_at'], 'body': body})

    def inspect_answer_intake(self, delivery_id, request, answer):
        """Read durable exact intake only, including after consumption/settlement.

        This does not consume an answer, emit resume, claim or execute a task.
        Absence is not proof that a prior executable call is safe to repeat.
        """
        identifier(delivery_id, 1024)
        normalized = json.loads(self._source(request))
        if not isinstance(answer, dict) or request.get('state') != 'answered' or \
           normalized['kind'] != 'request' or normalized['revision'] != 1 or \
           delivery_id != 'answer:' + normalized['object_id'] + ':1:' + str(answer.get('object_id')):
            raise RuntimeJournalError('RUNTIME_ANSWER_INTAKE_SOURCE_INVALID')
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            own_transaction = not self.db.in_transaction
            if own_transaction:
                self.db.execute('BEGIN')
            try:
                row = self.db.execute('SELECT * FROM questions WHERE request_id=?', (normalized['object_id'],)).fetchone()
                if row is None:
                    return {'status': 'not_proven'}
                operation = self.operation(row['operation_id'])
                if operation is None:
                    raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
                value = self._answer_value(operation, row, request, answer)
                if row['answer'] is None:
                    return {'status': 'not_proven'}
                if row['state'] != 'answered' or row['answer'] != value:
                    raise RuntimeJournalError('RUNTIME_ANSWER_INTAKE_CONFLICT')
                if request.get('expires_at') is not None:
                    # Hermes emits microseconds; the authenticated queue stores
                    # Date.parse milliseconds. Compare that same precision,
                    # without extending the original effective deadline.
                    spec_deadline = json.loads(row['spec'])['expires_at']
                    milliseconds = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00')).isoformat(timespec='milliseconds')
                    if milliseconds(request['expires_at']) != milliseconds(spec_deadline):
                        raise RuntimeJournalError('RUNTIME_ANSWER_INTAKE_CONFLICT')
                return {'status': 'received', 'delivery_id': delivery_id, 'operation_id': operation['operation_id'],
                        'request': normalized, 'answer_digest': hashlib.sha256(value.encode('utf-8')).hexdigest()}
            finally:
                if own_transaction:
                    self.db.execute('ROLLBACK')

    def close_question(self, operation_id, request_id, state):
        """Adapter reconciliation only; no model tool may withdraw or expire."""
        if state not in {'withdrawn', 'expired'}:
            raise RuntimeJournalError('RUNTIME_QUESTION_STATE_INVALID')
        with self.transaction():
            self.reply(operation_id, request_id)
            prior = self.db.execute('SELECT state FROM questions WHERE request_id=?', (request_id,)).fetchone()[0]
            if prior != 'pending' and prior != state:
                raise RuntimeJournalError('RUNTIME_QUESTION_CLOSED')
            self.db.execute('UPDATE questions SET state=? WHERE request_id=?', (state, request_id))

    def has_unsettled_questions(self, operation_id):
        with self.lock:
            return self.db.execute("SELECT 1 FROM questions WHERE operation_id=? AND (state='pending' OR (state='answered' AND consumed=0)) LIMIT 1", (operation_id,)).fetchone() is not None

    def settle(self, operation_id, state, outcome, event):
        if state not in {'completed', 'failed', 'cancelled', 'unknown'}:
            raise RuntimeJournalError('RUNTIME_OUTCOME_INVALID')
        encoded = encode(outcome)
        if len(encoded.encode('utf-8')) > 262144:
            raise RuntimeJournalError('RUNTIME_OUTCOME_INVALID')
        with self.transaction():
            prior = self.operation(operation_id)
            if prior is None or event.get('delivery_id') != prior['delivery_id']:
                raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
            if prior['state'] != 'claimed':
                if prior['state'] != state or prior['outcome'] != encoded:
                    raise RuntimeJournalError('RUNTIME_OUTCOME_CONFLICT')
                existing = self.db.execute('SELECT event FROM runtime_events WHERE event_id=?', (event.get('event_id'),)).fetchone()
                if existing is None or existing['event'] != encode(event):
                    raise RuntimeJournalError('RUNTIME_OUTCOME_CONFLICT')
                return
            self._event(event)
            self.db.execute('UPDATE operations SET state=?,outcome=? WHERE operation_id=?', (state, encoded, operation_id))

    def events(self, limit=20):
        if type(limit) is not int or not 1 <= limit <= 20:
            raise RuntimeJournalError('RUNTIME_LIMIT_INVALID')
        with self.lock:
            if self.db is None:
                raise RuntimeJournalError('RUNTIME_JOURNAL_CLOSED')
            return [json.loads(row[0]) for row in self.db.execute('SELECT event FROM runtime_events WHERE acked=0 ORDER BY sequence LIMIT ?', (limit,))]

    def acknowledge(self, event_ids):
        if not isinstance(event_ids, list) or len(event_ids) > 20:
            raise RuntimeJournalError('RUNTIME_ACK_INVALID')
        for event_id in event_ids:
            identifier(event_id)
        if len(set(event_ids)) != len(event_ids):
            raise RuntimeJournalError('RUNTIME_ACK_INVALID')
        with self.transaction():
            for event_id in event_ids:
                if self.db.execute('SELECT 1 FROM runtime_events WHERE event_id=?', (event_id,)).fetchone() is None:
                    raise RuntimeJournalError('RUNTIME_ACK_UNKNOWN')
            for event_id in event_ids:
                self.db.execute('UPDATE runtime_events SET acked=1 WHERE event_id=?', (event_id,))

    def close(self):
        with self.lock:
            if self.db is not None:
                self.db.close()
                self.db = None
