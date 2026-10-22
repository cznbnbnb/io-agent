"""Publish actual native scheduling times without source paths, IDs or words."""
import argparse
import hashlib
import json
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--log', required=True, type=Path)
p.add_argument('--journal', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--version', required=True)
a = p.parse_args()
assert re.fullmatch(r'0\.1\.\d+', a.version)
j = json.loads(a.journal.read_text(encoding='utf-8-sig'))
assert j['kind'] == 'p22_actual_daily_coordinator' and j['phase'] == 'completed'
raw = a.log.read_bytes()
rows = [json.loads(line) for line in raw.decode('utf-8-sig').splitlines() if line.strip()]
rows = [r for r in rows if j['attemptStarted'] <= r['t'] <= j['finished']]
fields = {
    'window-deferred': ['at', 'retryAt', 'reason'],
    'queue-wake-scheduled': ['at', 'dueAt', 'delayMs'],
    'queue-wake-fired': ['at', 'dueAt', 'lateMs', 'remainingMs'],
    'run-timing': ['worker', 'frames', 'prefixFrames', 'modelsMs', 'elapsedMs', 'recognitionMs', 'embeddingMs', 'timerYields', 'timerWaitMs'],
    'pcm-window': ['decodedFrames', 'reusedFrames', 'replayedFrames', 'retainedFrames', 'reset', 'capacityFrames'],
}
events = []
for r in rows:
    if r['ev'] not in fields:
        continue
    detail = json.loads(r['x'])
    events.append({'logged_at': r['t'], 'event': r['ev'], **{key: detail[key] for key in fields[r['ev']] if key in detail}})
scheduled = [e for e in events if e['event'] == 'queue-wake-scheduled']
fired = [e for e in events if e['event'] == 'queue-wake-fired']
assert fired, 'No actual timer wake observed'
starts = [r['t'] for r in rows if r['ev'] == 'run-start']
wakes = []
for e in fired:
    assert any(s['dueAt'] == e['dueAt'] and s['at'] <= e['at'] for s in scheduled), 'Unmatched wake'
    assert e['lateMs'] == max(0, e['at'] - e['dueAt'])
    assert e['remainingMs'] == max(0, e['dueAt'] - e['at'])
    following = next((at for at in starts if at >= e['at']), None)
    wakes.append({'due_at': e['dueAt'], 'fired_at': e['at'], 'late_ms': e['lateMs'],
                  'remaining_ms': e['remainingMs'], 'next_inference_after_ms': None if following is None else following - e['at']})
out = {'kind': 'p22_actual_native_due_schedule', 'version': a.version,
       'attempt_elapsed_ms': j['finished'] - j['attemptStarted'],
       'private_log_sha256': hashlib.sha256(raw).hexdigest(), 'wakes': wakes, 'events': events,
       'scope': {'same_source_replay': bool(j.get('replaySourceSha256')), 'new_acquisition': False,
                 'power_or_accuracy_accepted': False, 'general_timer_precision_guaranteed': False}}
a.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'wakes': wakes, 'attempt_elapsed_ms': out['attempt_elapsed_ms']}))
