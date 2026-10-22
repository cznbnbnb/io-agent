"""Summarize the existing-round cleanup probe; never publish private identities or drafts."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
PRIVATE = PHASE / 'device-private/capture077-evidence'
RUN = '20261015-123116805-f7de9e41'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def one(pattern, rows):
    matches = [re.fullmatch(pattern, row) for row in rows]
    matches = [item for item in matches if item]
    assert len(matches) == 1, pattern
    return matches[0].groups()


def main():
    install = read(PRIVATE / 'install-ledger.json')
    upgrade = read(PRIVATE / 'recovery-upgrade-ledger.json')
    cold_root = PRIVATE.parent / 'capture077-cold-evidence'
    cold = read(cold_root / 'cold-ledger.json')
    cold_before, cold_after = read(cold_root / 'capture-before.json'), read(cold_root / 'capture-after.json')
    before = read(PRIVATE / 'capture-before-install.json')
    after = read(PRIVATE / 'capture-after-cleanup.json')
    ui = read(PRIVATE / 'ui-status.json')
    restored = read(PRIVATE / 'ui-open.json')
    audit = read(PHASE / 'capture077-source-audit-after-cold-2026-10-15.json')
    sign = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    assert install['installed'] is True and install['version'] == '0.1.77' and install['version_code'] == 10077
    assert install['pid_before'] != install['pid_after']
    assert upgrade['version'] == cold['version'] == '0.1.77'
    assert cold['pid_before'] == install['pid_after'] and cold['pid_after'] != cold['pid_before']
    assert cold_before == after
    for field in ('schema', 'binding', 'text', 'draft_valid'):
        assert cold_before[field] == cold_after[field]
    assert cold_after['exit_evidence'] in ('none', 'device_event')
    assert cold_before == cold_after or (not cold_after['cleanup_peer'] and cold_after['exit_evidence'] == 'device_event')
    assert audit['passed'] is True and audit['runId'] == RUN
    assert audit['baselineFiles'] == audit['checkoutFiles'] == audit['stagedSourceFiles'] == 782
    assert sign['verified'] is True and sign['nativeSignature']['verified'] is True
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.77.hap') == install['hap_sha256'] == sign['nativeSignature']['hapSha256'].lower()
    assert before['schema'] == 1 and after['schema'] == 2 and bool(before['cleanup_peer'])
    for field in ('binding', 'text', 'draft_valid'):
        assert before[field] == after[field]
    assert before['text'] == '' and before['draft_valid'] is False
    assert re.fullmatch('capture-lab-[a-z0-9]+', before['binding'])
    assert after['exit_evidence'] in ('none', 'device_event')  # No human confirmation was supplied or invoked.
    assert after['cleanup_peer'] == before['cleanup_peer'] or (not after['cleanup_peer'] and after['exit_evidence'] == 'device_event')
    for key, expected in install['retained_hashes'].items():
        assert sha(PRIVATE / f'before-{key}.bin') == sha(PRIVATE / f'after-{key}.bin') == expected
        assert sha(cold_root / f'before-{key}.bin') == sha(cold_root / f'after-{key}.bin') == expected
    assert sha(PRIVATE / 'task-mailbox-before-install.json') == sha(PRIVATE / 'task-mailbox-after-cleanup.json')
    assert sha(PRIVATE / 'task-mailbox-before-install.json') == sha(PRIVATE / 'task-mailbox-after-cold.json')
    stop, exit_write = one(r'关麦：(.+) · 退出：(.+)', ui['notes'])
    worker, late, evidence = one(r'当前识别线程 (已释放|未释放) · 停止后音频包 (\d+) · 退出依据 (.+)', ui['notes'])
    packets, nonzero, event = one(r'音频包 (\d+) · 非全零包 (\d+) · 退出通知 (已观察|未观察)', ui['notes'])
    assert int(packets) == int(nonzero) == 0
    if after['cleanup_peer']:
        assert event == '未观察' and evidence == '尚未确认'
        assert next(row['enabled'] for row in ui['buttons'] if row['text'] == '开始15秒收音自检') == 'false'
    if cold_after['cleanup_peer']:
        assert next(row['enabled'] for row in restored['buttons'] if row['text'] == '开始15秒收音自检') == 'false'
    labels = {'写入完成（非设备确认）': 'submitted', '写入失败': 'failed', '正在写入': 'pending', '未尝试': 'not_attempted'}
    paths = [PRIVATE / 'install-ledger.json', PRIVATE / 'recovery-upgrade-ledger.json', PRIVATE / 'capture-before-install.json',
             PRIVATE / 'capture-after-cleanup.json', PRIVATE / 'ui-status.json', PRIVATE / 'task-mailbox-before-install.json',
             PRIVATE / 'task-mailbox-after-cleanup.json', PRIVATE / 'task-mailbox-after-cold.json', PRIVATE / 'ui-open.json', cold_root / 'cold-ledger.json',
             cold_root / 'capture-before.json', cold_root / 'capture-after.json', PHASE / 'capture077-source-audit-after-cold-2026-10-15.json']
    report = {
        'kind': 'p53_existing_capture_exit_recovery_probe', 'version': '0.1.77', 'version_code': 10077, 'run_id': RUN,
        'installed': True, 'hap_sha256': install['hap_sha256'], 'official_signature_verified': True, 'verified_source_files': 782,
        'journal_upgrade': {'before_schema': 1, 'after_schema': 2, 'original_binding_text_validity_preserved': True,
                            'cleanup_pending': bool(after['cleanup_peer']), 'exit_evidence': after['exit_evidence']},
        'native_cleanup': {'recorder_stop_transport_write': labels[stop], 'exit_transport_write': labels[exit_write],
                            'current_worker_released': worker == '已释放', 'post_stop_audio_packets': int(late),
                            'device_exit_event_observed': event == '已观察', 'new_capture_started': False,
                            'user_exit_confirmation_invoked': False},
        'v2_cold_restore': {'pid_before': cold['pid_before'], 'pid_after': cold['pid_after'],
                            'journal_bytes_unchanged': sha(cold_root / 'capture-before.json') == sha(cold_root / 'capture-after.json'),
                            'cleanup_pending': bool(cold_after['cleanup_peer']), 'exit_evidence': cold_after['exit_evidence'],
                            'binding_text_validity_preserved': True},
        'protected_files_bytes_unchanged': install['retained_bytes_unchanged'], 'task_mailbox_bytes_unchanged': True,
        'glasses_exit_visually_confirmed': False, 'new_voice_recognition_verified': False, 'two_stage_agent_loop_verified': False,
        'limits': 'Only cleans the old round. Submitted GATT writes and no observed late packets do not prove physical mic/window exit. '
                  'Manual confirmation remains available for a real user observation; it was not invoked. '
                  'No task answer, raw speech, identity or credential is published.',
        'private_evidence_sha256': {str(path.relative_to(ROOT)).replace('\\', '/'): sha(path) for path in paths},
    }
    target = PHASE / 'capture077-native-2026-10-15.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'report': str(target), 'stop_write': labels[stop], 'exit_write': labels[exit_write],
                      'cleanup_pending': bool(after['cleanup_peer']), 'user_confirm_invoked': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
