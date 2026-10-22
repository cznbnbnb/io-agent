"""Validate the normal-phone, real-Hermes two-shake subset; no voice claim."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
BASE = PHASE / 'device-private/task080b-evidence'
RUNTIME = 'phone080-20261015-b'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    version = read(BASE / 'installed-version.json')
    assert version['version_code'] == 10080 and version['version'] == '0.1.80' and not version['new_install']
    original_install = read(PHASE / 'device-private/suggestion080-evidence/install-ledger.json')
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.80.hap') == original_install['hap_sha256']
    human = read(BASE / 'human-feedback.json')
    assert human['source'] == 'direct_user_confirmation' and human['result_feedback'] == '没失败，显示垃圾桶图标了'
    assert human['closure_feedback'] == '两张都正常，已消失'
    draft, queued = read(BASE / 'draft-after-send.json'), read(BASE / 'draft-after-answer.json')
    assert draft['stage'] == 'review' and queued['stage'] == 'queued' and draft['binding'] == queued['binding']
    assert len(draft['used_uids']) == len(set(draft['used_uids'])) == 2 and draft['used_uids'] == queued['used_uids']
    assert all(uid.startswith(draft['binding']['operation_id'] + '-') for uid in draft['used_uids'])
    assert not draft['cleanup_uid'] and not queued['cleanup_uid']
    assert draft['text'] == queued['text'] == '未采用当前方案' and draft['input_source'] == queued['input_source'] == 'glasses_semantic'
    assert read(BASE / 'final-answer-intent.json')['expected_answer'] == draft['text']
    before = read(BASE / 'cloud-after-cards.json')
    assert before['task']['state'] == 'waiting_answer' and before['request']['state'] == 'pending' and before['request']['answer'] is None
    native_before, native_after = read(BASE / 'mailbox-after-delegate.json'), read(BASE / 'mailbox-after-answer.json')
    assert native_before['principal'] == native_after['principal'] and native_after['principal']['ownerId'] == 'synthetic-cloud-' + RUNTIME
    assert len(native_before['outbox']) == 1 and len(native_after['outbox']) == 2
    assert all(row['state'] == 'server_stored' and row['ack'] for row in native_after['outbox'])
    events = [json.loads(row['payload']) for row in native_after['outbox']]
    assert sorted(event['kind'] for event in events) == ['answer', 'task']
    answer = next(event for event in events if event['kind'] == 'answer')
    task_event = next(event for event in events if event['kind'] == 'task')
    binding = draft['binding']
    assert task_event['producer_id'] == answer['producer_id'] == 'cloud-phone'
    assert answer['body']['request_id'] == binding['request_id'] and answer['body']['request_revision'] == binding['request_revision']
    assert answer['body']['task_id'] == task_event['body']['task_id'] == binding['task_id']
    assert answer['body']['route'] == task_event['body']['route'] == binding['route']
    assert answer['body']['text'] == draft['text'] and answer['body']['input_source'] == 'glasses_semantic' and answer['body']['raw_action'] is None
    cloud = read(BASE / 'cloud-final-poll-0.json')
    assert cloud['task']['state'] == 'completed' and cloud['task']['object_id'] == binding['task_id']
    assert cloud['request']['state'] == 'answered' and cloud['request']['object_id'] == binding['request_id']
    assert cloud['request']['answer']['body'] == answer['body']
    stages = [r['stage'] for r in cloud['task']['receipts']]
    assert all(stage in stages for stage in ['agent_received', 'task_resumed', 'task_completed'])
    result = read(BASE / 'cloud-final-result.json')['message']['body']
    assert result['route'] == binding['route'] and result['task_id'] == binding['task_id'] and result['channel'] == 'result'
    assert result['text'] == 'IO_PHONE_WAIT_OK:未采用当前方案'
    native_results = [row['item'] for row in native_after['objects'] if row['item']['kind'] == 'message' and row['item']['body']['channel'] == 'result']
    assert len(native_results) == 1 and native_results[0]['body'] == result
    ui = read(BASE / 'review-ledger.json')
    assert ui['version'] == '0.1.80' and not ui['after_cold_start'] and all(ui['observed'].values())
    assert sha(BASE / 'capture-after-test.json') == sha(PHASE / 'device-private/suggestion080-evidence/capture-after-install.json')
    assert read(BASE / 'pause-ledger.json')['disabled_confirmed']
    observer = read(PHASE / (RUNTIME + '-live-observation.json'))
    assert observer['status'] == 'stopped' and observer['bridgeStopped'] and observer['phoneRoleSubmissionsByThisTool'] == 0
    revoked = read(PHASE / ('cloud-' + RUNTIME + '-credentials-revoke.json'))
    assert set(revoked['public_identity_status'].values()) == {401}
    output = {
        'kind': 'two_stage_decline_joint_native_and_real_hermes', 'version': '0.1.80', 'version_code': 10080,
        'verified_at': version['at'], 'hap_sha256': original_install['hap_sha256'], 'synthetic_task': True,
        'normal_phone_sole_task_and_answer_producer': True, 'unique_child_card_uids': 2,
        'human_two_shakes_both_cards_normal_and_closed': True, 'human_failure_absent_and_trash_icon_seen': True,
        'no_answer_before_explicit_phone_submit': True, 'final_answer': draft['text'], 'answer_input_source': 'glasses_semantic',
        'wire_gesture_source_claimed': False, 'one_native_answer_server_stored': True,
        'original_request_task_revision_and_route_matched': True,
        'agent_received': True, 'task_resumed': True, 'task_completed': True,
        'result_text': result['text'], 'normal_phone_result_ui_verified': True,
        'capture_journal_unchanged_from_install': True, 'new_capture_started_by_test': False,
        'phone_test_profile_paused': True, 'observer_stopped': True, 'test_credentials_revoked_401': True,
        'two_stage_decline_subset_end_to_end_passed': True, 'voice_tested': False, 'full_ac_ask_passed': False,
        'limits': 'Normal phone explicit final submit remains part of this subset. No voice, adoption branch, result back to lens, 3–4 choices, cold pending recovery or complete replacement acceptance.'
    }
    target = PHASE / 'suggestion080-joint-2026-10-15.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'two_stage_decline_subset_passed': True, 'full_ac_ask_passed': False}))


if __name__ == '__main__':
    main()
