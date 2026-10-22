"""Publish a whitelist of actual HDC/App control facts; never infer lens visibility."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
BASE = PHASE / 'device-private/card-cli082-evidence'
RUN = '20261015-155726672-6f13c5fe'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    install = read(BASE / 'install-ledger.json')
    signed = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    audit = read(PHASE / 'card-cli082-source-audit-after-device-2026-10-15.json')
    assert install['installed'] and install['version_code'] == 10082 and install['pid_before'] != install['pid_after']
    assert sha(PHASE / 'artifacts/entry-default-signed-0.1.82.hap') == install['hap_sha256'] == signed['nativeSignature']['hapSha256'].lower()
    assert signed['verified'] and signed['nativeSignature']['verified'] and signed['originalFailedSigningPreserved']
    assert audit['passed'] and audit['runId'] == RUN and audit['baselineFiles'] == audit['checkoutFiles'] == audit['stagedSourceFiles'] == 792
    assert len(signed['payload']['sourceMapOrderProofs']) == 1 and signed['payload']['sourceMapOrderProofs'][0]['path'] == 'ets/sourceMaps.map'
    for key, value in install['retained_hashes'].items():
        assert sha(BASE / ('before-' + key + '.bin')) == sha(BASE / ('after-' + key + '.bin')) == value
    for name in ('capture', 'decision', 'task-d'):
        assert sha(BASE / (name + '-before-install.json')) == sha(BASE / (name + '-after-install.json')) == sha(BASE / (name + '-after-cli.json'))
    for name in ('task-mailbox', 'task-b'):
        assert sha(BASE / (name + '-before-install.json')) == sha(BASE / (name + '-after-install.json'))
    ledger = read(BASE / 'cli-case-ledger.json')
    assert ledger['phase'] == 'complete' and not ledger['lens_display_verified'] and ledger['capture_and_task_bytes_preserved']
    cases = ledger['cases']
    assert len(cases) == 7
    assert all(case['exit_code'] == (1 if name == 'wrong-uid' else 0) for name, case in cases.items())
    assert all(case['result']['state'] == ('error' if name == 'wrong-uid' else 'complete') for name, case in cases.items())
    show, replay = cases['show']['result'], cases['reconcile']['result']
    assert show == replay and show['snapshot']['phase'] == 'waiting' and show['snapshot']['active']
    assert show['snapshot']['cardOccupied'] and 0 < show['snapshot']['remainingMs'] <= 120000
    uid = show['snapshot']['uid']
    assert uid.startswith('p10-') and cases['status-active']['result']['snapshot']['uid'] == uid
    wrong = cases['wrong-uid']['result']
    assert wrong['snapshot']['uid'] == uid and wrong['snapshot']['active']
    for name in ('remove', 'status-after'):
        state = cases[name]['result']['snapshot']
        assert not state['uid'] and not state['active'] and not state['cardOccupied'] and not state['captureActive']
    journal = read(BASE / 'suggestion-after-cli.json')
    assert not journal['cleanupUid'] and not journal['cleanupPeer']
    events = [json.loads(event) for event in journal['events']]
    current = [event for event in events if event['uid'] == uid]
    assert sum(event['event'] == 'send-intent' for event in current) == 1
    assert sum(event['event'] == 'transport-submitted' for event in current) == 1
    assert sum(event['event'] == 'remove-submitted' for event in current) == 1
    regression = (PHASE / 'card-cli-release-full-app-native.log').read_text(encoding='utf-8-sig')
    assert re.search(r'^# tests 1027\s*$', regression, re.M) and re.search(r'^# pass 1027\s*$', regression, re.M) and re.search(r'^# fail 0\s*$', regression, re.M)
    result = {'kind': 'actual_phone_hdc_debug_card_cli', 'version': '0.1.82', 'version_code': 10082,
              'run_id': RUN, 'hap_sha256': install['hap_sha256'], 'source_files_verified': 792,
              'app_host_tests_passed': 1027, 'native_signature_verified': True,
              'debug_map_strict_json_identity_proof_recorded': True,
              'normal_data_and_task_drafts_bytes_preserved': True,
              'native_cli_status_show_reconcile_wrong_uid_remove_status_passed': True,
              'single_send_intent_and_transport_submission': True, 'shared_card_lease_claimed_and_released': True,
              'app_cleanup_window_ms': 120000, 'final_cleanup_obligation_empty': True,
              'new_capture_started': False, 'agent_task_or_answer_submitted_by_cli': False,
              'lens_display_verified': False, 'lens_duration_verified': False,
              'scope': 'Debug HDC local private-file diagnostics, fixed synthetic card only; full daily Agent CLI and original-request command coverage remain open.'}
    target = PHASE / 'card-cli082-native-2026-10-15.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'native_cli_passed': True, 'lens_duration_verified': False}))


if __name__ == '__main__':
    main()
