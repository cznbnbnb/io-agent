"""Verify install/protection facts separately from the still-required lens test."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
BASE = PHASE / 'device-private/suggestion080-evidence'
RUN = '20261015-141533036-5a771d97'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    install = read(BASE / 'install-ledger.json')
    recovery = read(BASE / 'recovery-upgrade-ledger.json')
    sign = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    audit = read(PHASE / 'suggestion080-source-audit-after-device-2026-10-15.json')
    assert install['installed'] and install['version_code'] == 10080 and install['pid_before'] != install['pid_after']
    assert sign['verified'] and sign['nativeSignature']['verified'] and audit['passed'] and audit['runId'] == RUN
    assert audit['baselineFiles'] == audit['checkoutFiles'] == audit['stagedSourceFiles'] == 788
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.80.hap') == install['hap_sha256'] == sign['nativeSignature']['hapSha256'].lower()
    for key, value in install['retained_hashes'].items():
        assert sha(BASE / f'before-{key}.bin') == sha(BASE / f'after-{key}.bin') == value
    for pair in ('task-mailbox', 'task-b', 'decision'):
        assert sha(BASE / f'{pair}-before-install.json') == sha(BASE / f'{pair}-after-install.json')
    assert read(BASE / 'capture-before-install.json') == read(BASE / 'capture-after-install.json')
    assert recovery['exit_evidence'] == 'user_confirmation' and not recovery['cleanup_pending']
    for log, count in [('suggestion080-targeted-native.log', 14), ('suggestion080-full-app-native.log', 1014)]:
        text = (PHASE / log).read_text(encoding='utf-8-sig')
        assert f'# tests {count}' in text and f'# pass {count}' in text and '# fail 0' in text
    joint = PHASE / 'device-private/task080-evidence'
    first = read(joint / 'draft-after-card-send.json')
    last = read(joint / 'draft-observation-3.json')
    cloud = read(joint / 'cloud-after-cards.json')
    assert first['binding'] == last['binding'] and first['stage'] == last['stage'] == 'proposal'
    assert first['cleanup_uid'] and not last['cleanup_uid'] and first['used_uids'] == last['used_uids'] and len(last['used_uids']) == 1
    assert not last['text'] and cloud['request']['object_id'] == last['binding']['request_id']
    assert cloud['task']['state'] == 'waiting_answer' and cloud['request']['state'] == 'pending' and cloud['request']['answer'] is None
    assert read(joint / 'pause-ledger.json')['disabled_confirmed']
    observer = read(PHASE / 'phone080-20261015-a-live-observation.json')
    revoked = read(PHASE / 'cloud-phone080-20261015-a-credentials-revoke.json')
    assert observer['status'] == 'stopped' and observer['bridgeStopped'] and observer['phoneRoleSubmissionsByThisTool'] == 0
    assert set(revoked['public_identity_status'].values()) == {401}
    output = {
        'kind': 'staged_suggestion_receipt_candidate_upgrade', 'version': '0.1.80', 'version_code': 10080,
        'run_id': RUN, 'installed': True, 'hap_sha256': install['hap_sha256'], 'hap_bytes': sign['hap']['bytes'],
        'native_signature_verified': True, 'source_files_verified_after_install': 788,
        'pid_before': install['pid_before'], 'pid_after': install['pid_after'],
        'protected_file_bytes_unchanged': True, 'prior_and_failed_test_mailboxes_unchanged': True,
        'unsubmitted_decision_journal_unchanged': True, 'capture_journal_unchanged': True,
        'capture_exit_evidence': 'prior_direct_user_confirmation', 'new_device_exit_event_claimed': False,
        'full_app_checks': 1014, 'targeted_checks': 14,
        'joint_window_matched_operation_received': False, 'joint_window_answer_submitted': False,
        'joint_window_card_cleanup_submitted': True, 'joint_window_original_cloud_task_waiting': True,
        'candidate_lens_effect': 'awaiting_direct_user_verification', 'end_to_end_passed': False,
        'phone_test_profile_paused': True, 'observer_stopped': True, 'all_three_test_credentials_revoked_401': True,
        'scope': 'Install/protection/build/host validation only; a separate joint record must establish actual lens timing and Agent answer continuation.'
    }
    target = PHASE / 'suggestion080-native-2026-10-15.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'installed': True, 'source_files': 788}))


if __name__ == '__main__':
    main()
