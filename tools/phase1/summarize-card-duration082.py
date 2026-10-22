"""Keep direct lens feedback separate from the App's measured expiry/removal."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHASE = ROOT / 'rebuild/phase1'
BASE = PHASE / 'device-private/duration082-evidence'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def last(name):
    return json.loads((BASE / name).read_text(encoding='utf-8-sig').splitlines()[-1])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    sent = last('send.ndjson')
    middle = last('status-after-five-second-feedback.ndjson')
    after = last('status-after-deadline.ndjson')
    assert all(item['state'] == 'complete' for item in (sent, middle, after))
    uid = sent['snapshot']['uid']
    assert middle['snapshot']['uid'] == uid and middle['snapshot']['active'] and middle['snapshot']['foreground']
    assert middle['snapshot']['remainingMs'] > 60000 and middle['snapshot']['command'] == 0
    assert not after['snapshot']['active'] and not after['snapshot']['uid'] and not after['snapshot']['cardOccupied']
    human = read(BASE / 'human-feedback.json')
    assert human['source'] == 'direct_user_confirmation' and human['visible_duration_feedback'] == '5秒就消失了' and human['after_disappearance_feedback'] == '没注意'
    journal = read(BASE / 'journal-after-deadline.json')
    events = [json.loads(event) for event in journal['events']]
    current = [event for event in events if event['uid'] == uid and event['event'] != 'other-type']
    assert [event['event'] for event in current] == ['send-intent', 'transport-submitted', 'expired', 'remove-submitted']
    assert all(event['cmd'] == 0 for event in current) and not journal['cleanupUid']
    expiry = current[2]['at'] - current[0]['at']
    removal = current[3]['at'] - current[0]['at']
    assert 119500 <= expiry <= removal <= 122000
    for name in ('capture', 'decision'):
        assert sha(BASE / (name + '-after-duration.json')) == sha(PHASE / 'device-private/card-cli082-evidence' / (name + '-after-cli.json'))
    result = {'kind': 'native_card_duration_joint_observation', 'version': '0.1.82',
              'human_lens_visible_seconds_approx': 5, 'human_after_disappearance': 'unobserved',
              'app_window_ms': 120000, 'app_expiry_after_send_ms': expiry, 'app_removal_after_send_ms': removal,
              'intermediate_same_uid_waiting_with_over_60_seconds_left': True,
              'semantic_user_operations_received': 0, 'single_send_no_refresh': True,
              'final_cleanup_obligation_empty': True, 'capture_and_original_task_draft_unchanged': True,
              'two_minute_continuous_lens_visibility_verified': False,
              'early_app_removal_observed': False,
              'root_cause': 'Unresolved native notification dismissal versus display/sleep behavior; no firmware timeout capability claimed.'}
    target = PHASE / 'card-duration082-native-2026-10-15.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'verified': True, 'artifact': target.name, 'human_visible_seconds_approx': 5, 'app_removal_after_send_ms': removal}))


if __name__ == '__main__':
    main()
