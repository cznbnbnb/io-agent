"""Bridge adapter for an existing Codex caller. No prompt dispatch or session creation."""
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from context import load_context, require
from runtime_journal import RuntimeJournalError, encode


def stable(prefix, value):
    return prefix + hashlib.sha256(encode(value).encode('utf-8')).hexdigest()


class ExistingCaller:
    def __init__(self, config, journal):
        self.config, self.journal = config, journal

    def on_item(self, item, delivery_id):
        if item.get('kind') == 'message':
            return []
        c = self.config
        require(item.get('kind') == 'task' and item.get('object_id') == c['task_id'] and item.get('body', {}).get('route') == c['route'], 'CALLER_OPERATION_MISMATCH')
        source = json.loads(self.journal._source(item))
        body = source['body']
        require(body.get('allow_create_session') is False and body.get('command') == 'Continue the already-running registered Codex task.', 'CALLER_COMMAND_MISMATCH')
        existing = self.journal.operation_for_task(c['task_id'])
        if existing:
            require(existing['operation_id'] == c['operation_id'], 'CALLER_OPERATION_MISMATCH')
            original = json.loads(existing['source'])
            require(all(original['body'].get(k) == body.get(k) for k in ['route', 'command', 'allow_create_session']) and original.get('command_expires_at') == source.get('command_expires_at'), 'CALLER_OPERATION_MISMATCH')
            if existing['state'] == 'admitted':
                self.journal.claim(c['operation_id'])
                self.running(existing)
            if body.get('state') == 'cancel_requested':
                # This records a cancellation request only; it cannot stop Codex execution.
                self.journal.request_cancel(existing['operation_id'])
            return []
        require(source['revision'] == 1 and body['state'] == 'queued' and delivery_id == 'item:task:' + c['task_id'] + ':1', 'CALLER_ORIGINAL_TASK_REQUIRED')
        receipt = {'action': 'receipt', 'stage': 'agent_received', 'subject_kind': 'task', 'subject_id': c['task_id'], 'subject_revision': 1}
        event = {'event_id': stable('rt-', [c['operation_id'], 'admitted']), 'delivery_id': delivery_id,
                 'actions': [{'action': 'task_state', 'state': 'agent_received'}, receipt]}
        # Admission proof and claim are durable; subsequent process restarts never run Codex.
        self.journal.admit(c['operation_id'], delivery_id, source, {'text': body['command']}, event)
        self.journal.claim(c['operation_id'])
        self.running(self.journal.operation(c['operation_id']))
        return []

    def running(self, operation):
        self.journal.append_event({'event_id': stable('rt-', [operation['operation_id'], 'running']), 'delivery_id': operation['delivery_id'], 'actions': [{'action': 'task_state', 'state': 'running'}]})

    def on_answer(self, request, answer):
        require(request.get('body', {}).get('task_id') == self.config['task_id'] and request['body'].get('route') == self.config['route'], 'CALLER_OPERATION_MISMATCH')
        self.journal.record_answer(self.config['operation_id'], request, answer)
        return [{'action': 'receipt', 'stage': 'agent_received', 'subject_kind': 'answer', 'subject_id': answer['object_id'], 'subject_revision': answer['revision']}]

    def on_closed(self, request):
        require(request.get('body', {}).get('task_id') == self.config['task_id'] and request['body'].get('route') == self.config['route'], 'CALLER_OPERATION_MISMATCH')
        self.journal.close_question(self.config['operation_id'], request['object_id'], request['state'])
        return []


def serve(file):
    config, journal = load_context(file)
    adapter = ExistingCaller(config, journal)
    try:
        while True:
            line = sys.stdin.buffer.readline(1048577)
            if not line:
                break
            require(len(line) <= 1048576 and line.endswith(b'\n'), 'RUNTIME_FRAME_TOO_LARGE')
            frame = json.loads(line.decode('utf-8'))
            require(isinstance(frame, dict) and type(frame.get('id')) is int, 'RUNTIME_FRAME_INVALID')
            kind = frame.get('type')
            response = {'id': frame['id'], 'ok': True}
            if kind == 'hello' and frame.get('protocol') == 1:
                response['capabilities'] = {'can_execute': True, 'async_events': True, 'graceful_shutdown': True,
                    'existing_caller_only': True, 'admission_probe_v1': True, 'answer_intake_probe_v1': True}
            elif kind == 'item':
                response['actions'] = adapter.on_item(frame['item'], frame['delivery_id'])
            elif kind == 'answer':
                response['actions'] = adapter.on_answer(frame['request'], frame['answer'])
            elif kind == 'closed':
                response['actions'] = adapter.on_closed(frame['request'])
            elif kind == 'admission_probe':
                require(frame['source'].get('object_id') == config['task_id'], 'CALLER_OPERATION_MISMATCH')
                response['admission'] = journal.inspect_admission(frame['delivery_id'], frame['source'])
            elif kind == 'answer_intake_probe':
                require(frame['request'].get('body', {}).get('task_id') == config['task_id'], 'CALLER_OPERATION_MISMATCH')
                response['answer_intake'] = journal.inspect_answer_intake(frame['delivery_id'], frame['request'], frame['answer'])
            elif kind == 'events':
                response['events'] = journal.events(frame['limit'])
            elif kind == 'events_ack':
                journal.acknowledge(frame['event_ids'])
            elif kind != 'shutdown':
                raise RuntimeJournalError('RUNTIME_FRAME_INVALID')
            encoded = encode(response)
            require(len(encoded.encode('utf-8')) <= 1048575, 'RUNTIME_RESPONSE_TOO_LARGE')
            sys.stdout.buffer.write((encoded + '\n').encode('utf-8'))
            sys.stdout.buffer.flush()
            if kind == 'shutdown':
                break
    finally:
        journal.close()


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3 and sys.argv[1] == '--config', 'CALLER_CONTEXT_REQUIRED')
        serve(sys.argv[2])
    except Exception:
        raise SystemExit(2)
