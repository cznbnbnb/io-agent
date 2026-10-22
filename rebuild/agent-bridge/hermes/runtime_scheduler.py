"""Durable single-runner scheduling; intake and question tools remain live."""
import asyncio
import hashlib
import json
import time
from runtime_journal import RuntimeJournalError, encode, timestamp
from native_observer import classify


def stable(prefix, value):
    return prefix + hashlib.sha256(encode(value).encode('utf-8')).hexdigest()


class RuntimeScheduler:
    def __init__(self, journal, sessions, runner_factory, lease, clock=time.time):
        self.journal, self.sessions, self.runner_factory, self.lease = journal, sessions, runner_factory, lease
        self.clock = clock
        self.worker = self.runner = self.active_id = None
        self.stopping = False
        self.failure = None

    def event(self, operation, tag, actions):
        return {'event_id': stable('rt-', [operation['operation_id'], tag]),
                'delivery_id': operation['delivery_id'], 'actions': actions}

    def receipt(self, operation, stage):
        source = json.loads(operation['source'])
        return {'action': 'receipt', 'stage': stage, 'subject_kind': 'task',
                'subject_id': source['body']['task_id'], 'subject_revision': source['revision']}

    def finish(self, operation, state, reason, unstarted=False):
        if state == 'completed' and self.journal.has_unsettled_questions(operation['operation_id']):
            state, reason = 'unknown', 'unanswered_question_at_native_completion'
        actions = [{'action': 'task_state', 'state': 'execution_unknown' if state == 'unknown' else state}]
        if state in {'completed', 'cancelled', 'failed'}:
            actions.append(self.receipt(operation, 'task_completed' if state == 'completed' else state))
        if state == 'completed':
            text = self.journal.native_observation(operation['operation_id'])['payload']['text']
            actions.append({'action': 'message', 'channel': 'result', 'text': text,
                            'message_id': stable('result-', operation['operation_id'])})
        event = self.event(operation, 'terminal', actions)
        settle = self.journal.settle_unstarted if unstarted else self.journal.settle
        settle(operation['operation_id'], state, {'reason': reason}, event)

    async def start(self):
        self.lease.assert_held()
        # Claimed work is never replayed. Closed native success can be reconciled;
        # an interrupted owner without full close proof stays unknown.
        for operation in self.journal.operations_in_state('claimed'):
            state = classify(self.journal.native_observation(operation['operation_id']))
            self.finish(operation, state, 'owner_restart_reconciliation')
        self.worker = asyncio.create_task(self.run())

    def check_route(self, item):
        source = json.loads(self.journal._source(item))
        route = source['body']['route']
        registration = self.sessions.get(route['session_id'])
        if registration is None or registration['project_id'] != route['project_id']:
            raise RuntimeJournalError('RUNTIME_SESSION_UNREGISTERED')
        return source

    async def on_item(self, item, delivery_id):
        self.lease.assert_held()
        if self.failure:
            raise RuntimeJournalError('RUNTIME_WORKER_FAILED')
        # Status/result messages are notifications, never an executable prompt.
        if item.get('kind') == 'message':
            return []
        if item.get('kind') != 'task':
            raise RuntimeJournalError('RUNTIME_SOURCE_INVALID')
        source = self.check_route(item)
        body = source['body']
        if (body.get('allow_create_session') is not False or not isinstance(body.get('command'), str)
                or not body['command'].strip() or body['command'].lstrip().startswith('/')):
            raise RuntimeJournalError('RUNTIME_COMMAND_INVALID')
        existing = self.journal.operation_for_task(body['task_id'])
        if existing:
            original = json.loads(existing['source'])
            if any(original['body'].get(key) != body.get(key) for key in ['command', 'route', 'allow_create_session']):
                raise RuntimeJournalError('RUNTIME_OPERATION_CONFLICT')
            if original.get('command_expires_at') != source.get('command_expires_at'):
                raise RuntimeJournalError('RUNTIME_OPERATION_CONFLICT')
            operation = existing
        else:
            operation_id = stable('op-', body['task_id'])
            operation = {'operation_id': operation_id, 'delivery_id': delivery_id, 'source': encode(source)}
            actions = ([{'action': 'task_state', 'state': 'agent_received'}, self.receipt(operation, 'agent_received')]
                       if body['state'] == 'queued' else [])
            operation = self.journal.admit(operation_id, delivery_id, source, {'text': body['command']},
                event=self.event(operation, 'admitted', actions))
            if body['state'] not in {'queued', 'cancel_requested'}:
                self.journal.claim(operation_id)
                self.finish(operation, 'unknown', 'prior_execution_without_local_claim')
        if body['state'] == 'cancel_requested':
            self.journal.request_cancel(operation['operation_id'])
            current = self.journal.operation(operation['operation_id'])
            if current['state'] == 'admitted':
                self.finish(current, 'cancelled', 'cancelled_before_claim', unstarted=True)
            elif current['state'] == 'claimed' and self.active_id == current['operation_id'] and self.runner:
                await self.runner.cancel()
        return []

    async def on_answer(self, request, answer):
        operation = self.journal.operation_for_task(request['body']['task_id'])
        if operation is None:
            raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
        self.journal.record_answer(operation['operation_id'], request, answer)
        # Receipt is only for the answer's durable intake; resume is emitted by
        # the actual wait tool after it consumes that answer.
        return [{'action': 'receipt', 'stage': 'agent_received', 'subject_kind': 'answer',
                 'subject_id': answer['object_id'], 'subject_revision': answer['revision']}]

    async def on_closed(self, request):
        operation = self.journal.operation_for_task(request['body']['task_id'])
        if operation is None:
            raise RuntimeJournalError('RUNTIME_OPERATION_UNKNOWN')
        self.journal.close_question(operation['operation_id'], request['object_id'], request['state'])
        return []

    async def run(self):
        try:
            while not self.stopping:
                self.lease.assert_held()
                # An uncertain earlier runner might have made external changes.
                # Preserve subsequent admitted work until explicit reconciliation.
                if self.journal.operations_in_state('unknown', 1):
                    await asyncio.sleep(0.05)
                    continue
                pending = self.journal.operations_in_state('admitted', 1)
                if not pending:
                    await asyncio.sleep(0.05)
                    continue
                operation = pending[0]
                source = json.loads(operation['source'])
                deadline = source.get('command_expires_at')
                if deadline is None:
                    self.finish(operation, 'failed', 'original_deadline_missing', unstarted=True)
                    continue
                if timestamp(deadline) <= self.clock():
                    self.finish(operation, 'expired', 'expired_before_claim', unstarted=True)
                    continue
                if self.journal.cancellation_requested(operation['operation_id']):
                    self.finish(operation, 'cancelled', 'cancelled_before_claim', unstarted=True)
                    continue
                if not self.journal.claim(operation['operation_id']):
                    continue
                self.active_id = operation['operation_id']
                self.journal.append_event(self.event(operation, 'running', [{'action': 'task_state', 'state': 'running'}]))
                outcome = None
                cancelled_before_prompt = False
                try:
                    self.runner = self.runner_factory(operation)
                    await self.runner.prepare()
                    if self.journal.cancellation_requested(self.active_id):
                        cancelled_before_prompt = True
                    else:
                        outcome = await self.runner.prompt(json.loads(operation['payload'])['text'])
                except Exception:
                    pass  # Only codes/outcome evidence, never provider errors/prompts.
                finally:
                    if self.runner:
                        await self.runner.close()
                        self.journal.native_process_closed(self.active_id)
                    self.runner = None
                state = 'cancelled' if cancelled_before_prompt else classify(self.journal.native_observation(self.active_id),
                    self.journal.cancellation_requested(self.active_id), bool(outcome and outcome.get('cancellation_observed')))
                self.finish(operation, state, 'native_result_and_confirmed_process_exit')
                self.active_id = None
        except BaseException as error:
            self.failure = type(error).__name__
            # Do not release ownership while child-tree shutdown remains unproven.
            raise

    async def close(self):
        self.stopping = True
        if self.runner:
            await self.runner.close()
        if self.worker:
            await self.worker
