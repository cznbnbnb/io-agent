"""Summarize retained synthetic-only phone evidence without exposing ASR metadata."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'rebuild/phase1/device-private'
MID = 'mat-lifelog-042bb7365e004cbb837949173a59f754'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((PRIVATE / name).read_text(encoding='utf-8-sig'))


def texts(node):
    yield node.get('attributes', {}).get('text', '')
    for child in node.get('children', []):
        yield from texts(child)


def main():
    row = read('speaker055-mat-r3.json')
    exported = read('speaker055-' + MID + '-r3.json')
    assert row['material_id'] == MID and row['revision'] == 3 and row['text_revision'] == 2
    assert row['speakers'][0]['label'] == 'SyntheticA' and row['speakers'][0]['is_self'] is False
    assert exported == row
    assert row['source']['complete'] and row['source']['audioAvailable']
    assert row['covered_ms'] == row['transcription_source_ms'] == 13200
    audio_sha = digest(PRIVATE / 'speaker055-audio.ogg')
    assert audio_sha == 'cd2ba1e3a85dfb445fed45ec8bf5c0d29acd261a579349c9bcedc5462e0477e1'
    original_asr_sha = digest(PRIVATE / 'manual054-native-transcript.json')
    assert digest(PRIVATE / 'speaker055-transcript.json') == original_asr_sha
    r2_sha = digest(PRIVATE / 'manual054-native-revision2.json')
    assert digest(PRIVATE / 'speaker055-preserved-mat-r2.json') == r2_sha
    for kind in ('md', 'json'):
        assert '已导出当前资料修订' in set(texts(read('speaker055-export' + kind + '-save-result.json')))
    assert '已连接' in set(texts(read('speaker055-feature-after.json')))
    stale = '选择 · 未确定 · 模型聚类' in set(texts(read('speaker055-exportmd-click-before.json')))
    assert stale  # Preserve the observed failure; never close it with model tests.
    backup = ROOT / 'rebuild/phase1/artifacts/entry-default-signed-0.1.55.hap'
    assert digest(backup) == '882f65acd1f5befff97a99478ee645d739279408e54ba3f73bc7be9947545e9b'
    report = {
        'kind': 'native_synthetic_speaker_correction_and_export',
        'summarized_at': datetime.now(timezone.utc).isoformat(),
        'observation_date_local': '2026-10-14',
        'version': '0.1.55', 'version_code': 10055,
        'signed_hap_sha256': digest(backup), 'signed_hap_bytes': backup.stat().st_size,
        'build_run': '20261013-225533500-4c519ab4',
        'material_id': MID, 'synthetic': True,
        'scope': 'actual installed Harmony app normal Journal UI; one synthetic single-speaker fixture; no task execution',
        'phone_usb_connected': True, 'glasses_ready_seen_in_normal_app': True,
        'old_record_opened_from_normal_calendar': True,
        'rename_persisted_revision': row['revision'], 'text_revision': row['text_revision'],
        'speaker_id': row['speakers'][0]['speaker_id'], 'speaker_label': 'SyntheticA',
        'name_confirmed_not_self_identity': True,
        'operation_receipt': row['speaker_correction'],
        'old_revision_sha256': r2_sha, 'old_revision_byte_preserved': True,
        'original_audio_sha256': audio_sha, 'original_audio_byte_preserved': True,
        'original_asr_sha256': original_asr_sha, 'original_asr_byte_preserved': True,
        'coverage_ms': 13200, 'export_cache_equals_canonical_json': True,
        'immutable_md_sha256': digest(PRIVATE / ('speaker055-' + MID + '-r3.md')),
        'immutable_json_sha256': digest(PRIVATE / ('speaker055-' + MID + '-r3.json')),
        'normal_system_picker_md_save_completed': True,
        'normal_system_picker_json_save_completed': True,
        'system_public_output_byte_readback': False,
        'known_failure': 'ForEach reused an old utterance closure after first legacy speaker normalization; sentence label displayed unknown despite correct persisted dictionary. Fix requires 0.1.56 native validation.',
        'not_verified': ['phone material 1.2 HTTPS sync', 'real two-speaker accuracy',
                         'automatic self identity', 'split/merge/text edits in native UI',
                         'post-correction cold restart normal text view', 'public picker output byte readback'],
        'private_raw_asr_or_layout_published': False,
    }
    target = ROOT / 'rebuild/phase1/speaker055-native-device-2026-10-14.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'evidence_recorded_with_known_ui_failure', 'revision': 3,
                      'source_originals_preserved': True, 'picker_md_json_completed': True}))


if __name__ == '__main__':
    main()
