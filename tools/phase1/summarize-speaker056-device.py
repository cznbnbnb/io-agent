"""Record real normal-UI synthetic correction results; no voice embeddings copied."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'rebuild/phase1/device-private'
MID = 'mat-lifelog-042bb7365e004cbb837949173a59f754'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    return json.loads((PRIVATE / name).read_text(encoding='utf-8-sig'))


def texts(node):
    yield node.get('attributes', {}).get('text', '')
    for child in node.get('children', []):
        yield from texts(child)


def main():
    revisions = {r: read('speaker056-mat-r' + str(r) + '.json') for r in range(4, 11)}
    for r, row in revisions.items():
        assert row['material_id'] == MID and row['revision'] == r and row['text_revision'] == r - 1
        assert row['source']['complete'] and row['source']['audioAvailable'] and row['user_edited']
        assert row['covered_ms'] == row['transcription_source_ms'] == 13200
        assert row['speaker_correction']['base_revision'] == r - 1
    assert revisions[4]['speakers'][0]['label'] == 'SyntheticB'
    assert '选择 · SyntheticB · 模型聚类' in set(texts(read('speaker056-r4-save-immediate.json')))
    assert revisions[5]['utterances'][0]['text'] == 'SyntheticOnlyAlphaBeta'
    assert 'SyntheticOnlyAlphaBeta' in set(texts(read('speaker056-text-r5-immediate.json')))
    children = revisions[6]['utterances']
    assert [u['text'] for u in children] == ['SyntheticOnly', 'AlphaBeta']
    assert [(u['start_ms'], u['end_ms']) for u in children] == [(None, None), (None, None)]
    assert [u['source_range']['parent_revision'] for u in children] == [5, 5]
    assert [(u['source_range']['text_start'], u['source_range']['text_end']) for u in children] == [(0, 13), (13, 22)]
    assert revisions[7]['utterances'][0]['speaker_id'] == '' and revisions[7]['utterances'][0]['speaker_basis'] == 'unknown'
    assert revisions[7]['utterances'][1]['speaker_id'] == revisions[6]['utterances'][1]['speaker_id']
    assert len(revisions[8]['speakers']) == 2 and revisions[8]['utterances'][0]['speaker_basis'] == 'user'
    assert len(revisions[9]['speakers']) == 1 and revisions[9]['utterances'][0]['speaker_id'] == revisions[9]['utterances'][1]['speaker_id']
    assert revisions[10]['speakers'][0]['is_self'] is True and revisions[10]['speakers'][0]['label'] == '我'
    assert '我 · 本人已确认' in set(texts(read('speaker056-r10-self-immediate.json')))
    cold_ui = set(texts(read('speaker056-cold-r3-text-open.json')))
    assert '资料 v3 · 文字 v2 · 原音保留' in cold_ui
    backup = ROOT / 'rebuild/phase1/artifacts/entry-default-signed-0.1.56.hap'
    assert sha(backup) == '95750a9818ce3319da081205580715faa1ed1e238e5d1cf64f2b9a16e47711bf'
    report = {
        'kind': 'native_synthetic_speaker_revision_ui', 'at': datetime.now(timezone.utc).isoformat(),
        'version': '0.1.56', 'version_code': 10056, 'synthetic': True, 'material_id': MID,
        'scope': 'actual Harmony normal Journal UI and immutable phone revisions; one retained single-speaker synthetic fixture',
        'signed_hap_sha256': sha(backup), 'signed_hap_bytes': backup.stat().st_size,
        'build_run': '20261014-011528025-9e3e5f29',
        'old_correction_r3_normal_cold_view': True,
        'rename_r4_immediate_sentence_label': True, 'text_r5_immediate_sentence_body': True,
        'split_r6_immediate_unknown_time_and_parent_range': True,
        'single_child_unknown_r7': True, 'new_label_single_child_assignment_r8': True,
        'confirmed_label_merge_r9': True, 'explicit_per_material_self_flag_r10': True,
        'automatic_self_identity_verified': False, 'real_speaker_accuracy_verified': False,
        'highest_revision': 10, 'highest_text_revision': 9, 'coverage_ms': 13200,
        'split_parent_revision': 5, 'split_text_ranges': [[0, 13], [13, 22]],
        'split_children_times_ms': [[None, None], [None, None]],
        'revision_sha256': {str(r): sha(PRIVATE / ('speaker056-mat-r' + str(r) + '.json')) for r in revisions},
        'remaining_known_review_issue': 'Merge/self dialogs originally captured the choice before confirming but selected the current UI base at save time. Static review found a stale-confirmation P2; frozen identity/revision guard is prepared in 0.1.57 and not covered by these 0.1.56 native results.',
        'not_verified': ['0.1.57 stale-dialog guard native behavior', 'phone material 1.2 public sync',
                         'latest r10 cold-restart normal view', 'real two-speaker accuracy',
                         'automatic self identity', 'eight-hour stability'],
        'raw_private_voice_metadata_published': False,
    }
    output = ROOT / 'rebuild/phase1/speaker056-native-device-2026-10-14.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'native_ui_and_revisions_verified', 'highest_revision': 10,
                      'operations': ['rename', 'text', 'split', 'unknown', 'assign', 'merge', 'self'],
                      'self_test_is_synthetic_explicit_flag_only': True}))


if __name__ == '__main__':
    main()
