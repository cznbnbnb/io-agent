"""Read the pinned engine's returned envelope, never infer completion from ACP.

This instrumentation uses a version-pinned internal method seam. It is not a
promise that arbitrary Hermes versions expose a supported completion API.
"""
import json
from runtime_journal import encode, RuntimeJournalError


def observe_result(result):
    if not isinstance(result, dict):
        return {'valid': False}
    flags = {key: result.get(key) for key in ['completed', 'failed', 'partial', 'interrupted', 'user_intervened']}
    text = result.get('final_response')
    # Do not silently truncate a result and then call it delivered in full.
    # The pinned engine legitimately returns final_response=None when an
    # interrupted turn produced no prose (also documented by its ACP server).
    # Accept that envelope only as interruption evidence. A successful return
    # still requires actual bounded text; never invent an empty success result.
    text_valid = (isinstance(text, str) and len(text) <= 65536 or
                  text is None and flags['interrupted'] is True and flags['completed'] is False)
    valid = all(type(value) is bool for value in flags.values()) and text_valid
    observation = {'valid': valid, **{key: value if type(value) is bool else None for key, value in flags.items()},
        'error_present': bool(result.get('error')), 'cleanup_error_present': bool(result.get('cleanup_errors')),
        'text': text if valid else None}
    if len(encode(observation).encode('utf-8')) > 240000:
        return {'valid': False}
    return observation


def wrap_agent(agent, journal, operation_id):
    original = agent.run_conversation
    def observed(*args, **kwargs):
        operation = journal.operation(operation_id)
        message = args[0] if args else kwargs.get('user_message')
        if operation is None or message != json.loads(operation['payload']).get('text'):
            raise RuntimeJournalError('RUNTIME_PROMPT_MISMATCH')
        journal.native_started(operation_id)
        try:
            result = original(*args, **kwargs)
        except BaseException:
            journal.native_returned(operation_id, {'exception_observed': True}, raised=True)
            raise
        journal.native_returned(operation_id, observe_result(result))
        return result
    agent.run_conversation = observed
    # Avoid post-turn background model/tool work outside the task boundary.
    agent.skip_background_review = True
    return agent


def classify(observation, cancellation_requested=False, cancellation_observed=False):
    if not observation or observation['process_closed'] != 1:
        return 'unknown'
    if observation['state'] == 'raised':
        return 'failed'
    value = observation['payload']
    if observation['state'] != 'returned' or not value or not value.get('valid'):
        return 'unknown'
    if value['completed'] and not any(value[key] for key in ['failed', 'partial', 'interrupted', 'user_intervened', 'error_present', 'cleanup_error_present']):
        return 'completed'
    if value['interrupted'] and cancellation_requested and cancellation_observed:
        return 'cancelled'
    if value['failed'] or value['error_present']:
        return 'failed'
    return 'unknown'
