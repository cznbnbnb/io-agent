"""Whitelist native 0.1.57 cold-view/no-op evidence; no PIN or raw voice JSON."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'rebuild/phase1/device-private'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((PRIVATE / name).read_text(encoding='utf-8-sig'))


def texts(node):
    yield node.get('attributes', {}).get('text', '')
    for child in node.get('children', []):
        yield from texts(child)


def main():
    version = read('speaker057-version-readback.json')
    assert version['version'] == '0.1.57' and version['version_code'] == 10057
    cold = set(texts(read('speaker057-cold-r10-view.json')))
    result = set(texts(read('speaker057-same-version-confirm-result.json')))
    assert '资料 v10 · 文字 v9 · 原音保留' in cold
    assert '已保存资料 v10；服务器同步结果另行显示' in result
    assert sha(PRIVATE / 'speaker057-revision-000000010.json') == sha(PRIVATE / 'speaker056-mat-r10.json')
    assert sha(PRIVATE / 'speaker057-audio.ogg') == 'cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1'
    assert sha(PRIVATE / 'speaker057-transcript.json') == sha(PRIVATE / 'manual054-native-transcript.json')
    editor = ROOT / 'rebuild/harmony-sdk/entry/src/main/ets/pages/MaterialSpeakerEditor.ets'
    assert sha(editor) == 'ef5505258ce366773ef6a14e85064fe711fbe0198788971288de9ce697275603'
    hap = ROOT / 'rebuild/phase1/artifacts/entry-default-signed.hap'
    assert sha(hap) == '58fed100fd3714a0095a325b21bb87547d16e2ed7bd2bd3a7c2a31eb50a08a89'
    state = json.loads((ROOT / 'rebuild/phase1/candidate-run-status.json').read_text(encoding='utf-8-sig'))
    assert state['versionName'] == '0.1.57' and state['phase'] == 'complete' and state['compileSucceeded']
    report = {
        'kind': 'native_speaker_confirmation_guard_candidate', 'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'actual Harmony normal Journal UI; retained synthetic fixture; no real task execution',
        'synthetic': True, 'version': version['version'], 'version_code': version['version_code'],
        'device_version_observed_at': version['at'], 'build_run': state['runId'],
        'compiler_succeeded': True, 'dependency_fallback_used': state['fallbackUsed'],
        'signed_hap_bytes': hap.stat().st_size, 'signed_hap_sha256': sha(hap),
        'editor_source_sha256': sha(editor), 'source_manifest_sha256': state['sourceHashManifestSha256'].lower(),
        'material_id': 'mat-lifelog-042bb7365e004cbb837949173a59f754',
        'latest_r10_normal_cold_view': True, 'same_revision_self_confirmation_completed': True,
        'confirmation_noop_preserved_revision_bytes': True, 'highest_revision_observed': 10, 'text_revision': 9,
        'preserved_r10_sha256': sha(PRIVATE / 'speaker057-revision-000000010.json'),
        'original_audio_bytes': (PRIVATE / 'speaker057-audio.ogg').stat().st_size,
        'original_audio_sha256': sha(PRIVATE / 'speaker057-audio.ogg'),
        'original_asr_sha256': sha(PRIVATE / 'speaker057-transcript.json'),
        'self_scope': 'synthetic explicit per-material flag mechanism; does not prove personal voice identity',
        'stale_dialog_source_review': 'independent review closed old-choice/new-base P2 after frozen identity/revision/kind/name guard',
        'stale_dialog_race_native_reproduced': False,
        'not_verified': ['native stale-dialog revision-change race', 'normal phone material 1.2 public sync',
                         'real two-speaker accuracy', 'automatic self identity', 'eight-hour stability'],
        'related_open_issue': '0.1.56 connection texts were ready while capture buttons remained disabled; entering Journal after ready on 0.1.57 enabled them. Nonreactive child connection dependency is a candidate root cause, not proof of firmware/recording failure.',
        'raw_asr_embeddings_or_unlock_config_published': False,
    }
    path = ROOT / 'rebuild/phase1/speaker057-native-device-2026-10-14.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'compiled_signed_installed_native_cold_view_and_noop_confirmed',
                      'revision': 10, 'stale_dialog_native_race': 'not_tested'}))


if __name__ == '__main__':
    main()
