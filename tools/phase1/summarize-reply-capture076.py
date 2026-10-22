"""Publish bounded metadata from private 0.1.76 native evidence; no raw speech or identity."""
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
PRIVATE = PHASE / 'device-private'
EVIDENCE = PRIVATE / 'capture076-evidence'
COLD = PRIVATE / 'capture076-cold-evidence'
RUN = '20261015-120328154-1261d950'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    install = read(EVIDENCE / 'install-ledger.json')
    cold = read(COLD / 'cold-ledger.json')
    before = read(COLD / 'capture-before.json')
    after = read(COLD / 'capture-after.json')
    status = read(EVIDENCE / 'ui-status.json')
    restored = read(EVIDENCE / 'ui-open.json')
    finalization = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    source = read(PHASE / 'capture076-source-audit-after-device-2026-10-15.json')
    speaker = read(PHASE / 'capture076-speaker.json')
    intent = read(EVIDENCE / 'capture-intent.json')
    assert install['version'] == cold['version'] == '0.1.76'
    assert install['version_code'] == 10076 and install['installed'] is True
    assert install['pid_before'] != install['pid_after'] == cold['pid_before']
    assert cold['pid_before'] != cold['pid_after']
    assert all(install['retained_bytes_unchanged'].values())
    assert all(cold['retained_bytes_unchanged'].values())
    assert source['passed'] is True and source['runId'] == RUN
    assert source['baselineFiles'] == source['checkoutFiles'] == source['stagedSourceFiles'] == 782
    assert finalization['verified'] is True and finalization['nativeSignature']['verified'] is True
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.76.hap') == install['hap_sha256']
    assert finalization['nativeSignature']['hapSha256'].lower() == install['hap_sha256']
    assert intent['synthetic'] is True and intent['seconds'] == 15 and intent['task_submission'] is False
    counters = [re.fullmatch(r'音频包 (\d+) · 非全零包 (\d+) · 退出通知 (未观察|已观察)', row) for row in status['notes']]
    counters = [match for match in counters if match]
    assert len(counters) == 1
    packets, nonzero, exited = counters[0].groups()
    assert 0 < int(packets) and 0 <= int(nonzero) <= int(packets)
    assert exited == '未观察'
    assert before == after and sha(COLD / 'capture-before.json') == sha(COLD / 'capture-after.json')
    assert before['schema'] == 1 and bool(before['cleanup_peer']) and before['draft_valid'] is False
    assert before['text'] == '' and re.fullmatch('capture-lab-[a-z0-9]+', before['binding'])
    restored_buttons = {row['text']: row['enabled'] for row in restored['buttons']}
    assert restored_buttons['开始15秒收音自检'] == 'false'
    assert restored_buttons['清理上次收音'] == 'true'
    mailbox = EVIDENCE / 'task-mailbox-after-capture.json'
    mailbox_before = PRIVATE / 'task075-cold-evidence/after-task-mailbox.json'
    old_mailbox, current_mailbox = read(mailbox_before), read(mailbox)
    old_core, current_core = json.loads(json.dumps(old_mailbox)), json.loads(json.dumps(current_mailbox))
    for value in (old_core, current_core):
        value.pop('cursor')
        for row in value['objects']:
            row.pop('detail_at')
    assert old_core == current_core  # Exact principal, object bodies, answers, receipts and serialized outbox.
    capture_started = datetime.fromisoformat(intent['at'].replace('Z', '+00:00')).timestamp() * 1000
    assert all(row['detail_at'] < capture_started for row in current_mailbox['objects'])
    assert speaker['syntheticScriptId'] == 'reply-7601'
    assert speaker['mutePreserved'] is True and abs(speaker['originalVolume'] - speaker['restoredVolume']) <= .001
    paths = [EVIDENCE / 'install-ledger.json', EVIDENCE / 'capture-intent.json', EVIDENCE / 'ui-status.json',
             EVIDENCE / 'ui-open.json', COLD / 'cold-ledger.json', COLD / 'capture-before.json', COLD / 'capture-after.json',
             mailbox, PHASE / 'capture076-source-audit-after-device-2026-10-15.json', PHASE / 'capture076-speaker.json']
    report = {
        'kind': 'p53_capture_only_native_probe', 'version': '0.1.76', 'version_code': 10076, 'run_id': RUN,
        'hap_sha256': install['hap_sha256'], 'installed': True, 'official_signature_verified': True,
        'source_and_stage_files_verified': 782,
        'native_observation': {'audio_packets': int(packets), 'nonzero_packets': int(nonzero),
                               'transcript_characters': 0, 'draft_valid': False, 'exit_notification_observed': False,
                               'cleanup_pending': True, 'speech_input_and_asr_success': False,
                               'acoustic_coupling_from_pc_to_glasses_verified': False},
        'cold_restore': {'pid_before': cold['pid_before'], 'pid_after': cold['pid_after'],
                         'cleanup_journal_bytes_unchanged': True, 'new_capture_disabled_on_restored_normal_page': True},
        'protected_files_unchanged_after_install_and_cold': install['retained_bytes_unchanged'],
        'previous_phone_task_objects_and_outbox_unchanged': True,
        'previous_phone_task_mailbox_bytes_unchanged': sha(mailbox) == sha(mailbox_before),
        'cache_cursor_differs_from_previous_snapshot': old_mailbox['cursor'] != current_mailbox['cursor'],
        'all_current_detail_refresh_times_precede_capture': True,
        'speaker_volume_restored': True,
        'manual_observation': {'item': 'H07-V01', 'record': 'docs/product/USER-VERIFICATION-TODO.md',
                               'recording_indicator_confirmed_by_user': True, 'glasses_exit_confirmed_by_user': False},
        'two_stage_cards_connected': False, 'task_answer_submitted': False, 'end_to_end_passed': False,
        'limits': 'Capture-only negative result. Nonzero PCM is not proof of speech or speaker identity. '
                  'Phone process exit and unchanged journal do not prove physical microphone/window exit. '
                  'Prior 0.1.75 cold snapshot has older cache cursor/detail timestamps; whole-mailbox byte preservation is not claimed. '
                  'Manual feedback must be read with H07-V01; no transcript, identity or credential is published.',
        'private_evidence_sha256': {str(path.relative_to(ROOT)).replace('\\', '/'): sha(path) for path in paths},
    }
    target = PHASE / 'capture076-native-2026-10-15.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'report': str(target), 'capture_audio_packets': int(packets), 'usable_voice_answer': False,
                      'cleanup_pending': True, 'protected_files_unchanged': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
