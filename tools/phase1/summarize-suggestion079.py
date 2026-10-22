"""Publish whitelisted failed native card evidence, preserving its exact limits."""
import hashlib
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
PRIVATE = PHASE / 'device-private'
RUN = '20261015-133534423-35955a25'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def main():
    base = PRIVATE / 'suggestion079-evidence'
    joint = PRIVATE / 'task079b-evidence'
    install = read(base / 'install-ledger.json')
    audit = read(PHASE / 'suggestion079-source-audit-after-device-2026-10-15.json')
    sign = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    assert install['version_code'] == 10079 and install['installed']
    assert audit['passed'] and audit['runId'] == RUN and audit['baselineFiles'] == 788
    assert sign['verified'] and sign['nativeSignature']['verified']
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.79.hap') == install['hap_sha256'] == sign['nativeSignature']['hapSha256'].lower()
    for key, expected in install['retained_hashes'].items():
        assert sha(base / f'before-{key}.bin') == sha(base / f'after-{key}.bin') == expected
    assert sha(base / 'task-mailbox-before-install.json') == sha(base / 'task-mailbox-after-install.json')
    confirmation = read(base / 'human-exit-confirmation-ledger.json')
    capture = read(base / 'capture-after-user-confirm.json')
    assert confirmation['basis'] == 'direct_user_confirmation' and confirmation['normal_ui_used']
    assert not confirmation['device_event'] and not confirmation['microphone_started'] and not confirmation['answer_submitted']
    assert capture['exit_evidence'] == 'user_confirmation' and not capture['cleanup_peer'] and not capture['draft_valid'] and not capture['text']
    before = read(joint / 'draft-after-first-send.json')
    after = read(joint / 'draft-after-resume-once.json')
    assert before['binding'] == after['binding'] and before['stage'] == 'proposal' and after['stage'] == 'supplement_offer'
    assert before['cleanup_uid'] != after['cleanup_uid'] and len(after['used_uids']) == 3
    assert not after['text'] and after['option_id'] is None
    cloud = read(joint / 'cloud-before-observer-stop.json')
    task, request = cloud['task'], cloud['request']
    assert request['object_id'] == after['binding']['request_id'] and request['body']['task_id'] == task['object_id'] == after['binding']['task_id']
    assert request['body']['route'] == task['body']['route'] == after['binding']['route']
    assert task['state'] == 'waiting_answer' and request['state'] == 'pending' and request['answer'] is None
    elapsed = (stamp(cloud['at']) - stamp(request['stored_at'])).total_seconds()
    assert elapsed >= 600 and stamp(cloud['at']) < stamp(request['expires_at'])
    paused = read(joint / 'pause-ledger.json')
    observer = read(PHASE / 'phone079-20261015-b-live-observation.json')
    revoked = read(PHASE / 'cloud-phone079-20261015-b-credentials-revoke.json')
    assert paused['disabled_confirmed'] and observer['status'] == 'stopped' and observer['bridgeStopped']
    assert observer['phoneRoleSubmissionsByThisTool'] == 0 and set(revoked['public_identity_status'].values()) == {401}
    output = {
        'kind': 'native_staged_suggestion_failed_joint_test', 'version': '0.1.79', 'version_code': 10079,
        'run_id': RUN, 'hap_sha256': install['hap_sha256'], 'native_signature_verified': True,
        'source_files_verified_after_install': 788, 'protected_files_and_prior_mailbox_unchanged_on_upgrade': True,
        'capture_exit_evidence': 'direct_user_confirmation', 'device_exit_event_received': False,
        'normal_phone_sole_command_and_answer_producer': True, 'synthetic_real_Hermes_task': True,
        'human_first_card_visible': True, 'human_first_card_too_short_without_action': True,
        'normal_ui_resumed_same_original_draft': True, 'human_first_shake_received': True,
        'human_native_operation_failure_seen': True, 'human_second_card_visible_but_disappeared_before_action': True,
        'draft_stage': 'supplement_offer', 'original_binding_preserved': True,
        'cloud_request_pending_without_answer_before_stop': True, 'cloud_task_waiting_before_stop': True,
        'real_wait_lower_bound_seconds': int(elapsed), 'microphone_started': False,
        'second_rejection_tested': False, 'final_answer_submitted': False, 'end_to_end_passed': False,
        'phone_profile_paused': True, 'observer_stopped': True, 'all_three_synthetic_credentials_revoked_401': True,
        'limits': 'Human observations close only card visibility and the first semantic rejection. Native failure/short second display remain failures. No second answer, voice, Agent continuation, or task completion passed.'
    }
    target = PHASE / 'suggestion079-native-2026-10-15.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'real_wait_lower_bound_seconds': int(elapsed), 'end_to_end_passed': False}))


if __name__ == '__main__':
    main()
