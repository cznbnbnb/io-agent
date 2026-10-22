"""Publish only build/upgrade protection facts; no draft, credential or peer identity."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
PRIVATE = PHASE / 'device-private/reply078-evidence'
RUN = '20261015-130939878-131cfce2'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    install = read(PRIVATE / 'install-ledger.json')
    upgrade = read(PRIVATE / 'recovery-upgrade-ledger.json')
    before = read(PRIVATE / 'capture-before-install.json')
    after = read(PRIVATE / 'capture-after-install.json')
    audit = read(PHASE / 'reply078-source-audit-after-device-2026-10-15.json')
    sign = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    assert install['installed'] is True and install['version'] == '0.1.78' and install['version_code'] == 10078
    assert install['pid_before'] != install['pid_after']
    assert upgrade['version'] == '0.1.78' and upgrade['previous_schema'] == upgrade['current_schema'] == 2
    assert upgrade['binding_text_validity_preserved'] and upgrade['task_mailbox_bytes_unchanged']
    for field in ('schema', 'binding', 'text', 'draft_valid'):
        assert before[field] == after[field]
    assert before['cleanup_peer'] and not before['draft_valid'] and before['text'] == ''
    assert before == after or (not after['cleanup_peer'] and after['exit_evidence'] == 'device_event')
    assert after['exit_evidence'] in ('none', 'device_event')  # Never invokes human confirmation.
    for key, expected in install['retained_hashes'].items():
        assert sha(PRIVATE / f'before-{key}.bin') == sha(PRIVATE / f'after-{key}.bin') == expected
        assert install['retained_bytes_unchanged'][key] is True
    mailbox_unchanged = sha(PRIVATE / 'task-mailbox-before-install.json') == sha(PRIVATE / 'task-mailbox-after-install.json')
    assert mailbox_unchanged and install['recording_idle'] and install['lifelog_idle'] and install['asr_idle']
    assert audit['passed'] and audit['runId'] == RUN
    assert audit['baselineFiles'] == audit['checkoutFiles'] == audit['stagedSourceFiles']
    assert sign['verified'] and sign['nativeSignature']['verified']
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.78.hap') == install['hap_sha256'] == sign['nativeSignature']['hapSha256'].lower()
    ui = read(PRIVATE / 'ui-open.json')
    start = [b for b in ui['buttons'] if b['text'] == '开始15秒收音自检']
    assert len(start) == 1 and start[0]['enabled'] == 'false'
    output = {
        'kind': 'reply_binding_candidate_upgrade_protection', 'version': '0.1.78', 'version_code': 10078,
        'run_id': RUN, 'verified_at': audit['verifiedUtc'], 'installed': True,
        'hap_sha256': install['hap_sha256'], 'native_signature_verified': True,
        'source_files_verified': audit['baselineFiles'], 'process_changed': True,
        'pid_before': install['pid_before'], 'pid_after': install['pid_after'],
        'protected_hashes': install['retained_hashes'], 'protected_file_bytes_unchanged': True,
        'task_mailbox_bytes_unchanged': mailbox_unchanged,
        'capture_schema': after['schema'], 'capture_binding_text_validity_preserved': True,
        'capture_journal_bytes_unchanged': sha(PRIVATE / 'capture-before-install.json') == sha(PRIVATE / 'capture-after-install.json'),
        'capture_cleanup_pending': bool(after['cleanup_peer']), 'capture_exit_evidence': after['exit_evidence'],
        'new_capture_blocked_in_normal_ui': True, 'new_capture_requested_by_test': False,
        'human_exit_confirmation_invoked': False,
        'normal_phone_bound_answer_native_tested': False,
        'two_stage_glasses_or_voice_end_to_end_tested': False,
        'scope': 'Install/start/protected files/pending cleanup only; gesture and transcript tests are simulated local inputs.'
    }
    target = PHASE / 'reply078-native-2026-10-15.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'source_files': audit['baselineFiles'],
                      'capture_cleanup_pending': output['capture_cleanup_pending']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
