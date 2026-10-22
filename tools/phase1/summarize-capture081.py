"""Verify the card/capture gate candidate without claiming a hardware result."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
RUN = '20261015-144952218-6c7d21cd'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def main():
    red = (PHASE / 'capture081-card-gate-red.log').read_text(encoding='utf-8-sig')
    assert 'Missing expected rejection.' in red and '# tests 1' in red and '# fail 1' in red
    for name, count in [('capture081-card-gate-green.log', 40), ('capture081-full-app-native.log', 1015)]:
        text = (PHASE / name).read_text(encoding='utf-8-sig')
        assert f'# tests {count}' in text and f'# pass {count}' in text and '# fail 0' in text
    build = read(PHASE / 'candidate-runs' / RUN / 'status.json')
    sign = read(PHASE / 'candidate-runs' / RUN / 'sign-finalization-status.json')
    audit = read(PHASE / 'capture081-source-audit-2026-10-15.json')
    assert build['compileSucceeded'] and build['versionCode'] == 10081 and build['versionName'] == '0.1.81'
    assert sign['verified'] and sign['nativeSignature']['verified'] and sign['hap']['versionCode'] == 10081
    assert audit['passed'] and audit['runId'] == RUN and audit['baselineFiles'] == audit['checkoutFiles'] == audit['stagedSourceFiles']
    with Path(sign['hap']['path']).open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    assert digest == sign['hap']['sha256'].lower() == sign['nativeSignature']['hapSha256'].lower()
    output = {
        'kind': 'capture_card_exclusion_candidate', 'version': '0.1.81', 'version_code': 10081,
        'baseline_commit': '3403f11', 'run_id': RUN, 'hap_sha256': digest, 'hap_bytes': sign['hap']['bytes'],
        'dev_eco_compile_passed': True, 'official_signature_and_payload_verified': True,
        'source_files_verified': audit['baselineFiles'], 'targeted_checks': 40, 'full_app_checks': 1015,
        'prior_service_gate_defect_reproduced': True,
        'real_service_and_capture_class_tested_with_synthetic_ports': True,
        'preparing_during_card_claim_does_not_open_mic_in_host_test': True,
        'card_release_does_not_auto_start_in_host_test': True,
        'installed_on_phone': False, 'device_or_glasses_operated_this_batch': False,
        'physical_microphone_or_end_to_end_tested': False,
        'scope': 'One availability predicate plus actual service/capture integration regression. ASR, audio decoder and hardware sender are synthetic; no voice handoff or lens outcome is accepted.'
    }
    target = PHASE / 'capture081-candidate-2026-10-15.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'candidate_only': True, 'installed': False}))


if __name__ == '__main__':
    main()
