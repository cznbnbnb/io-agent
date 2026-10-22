"""Summarize app-generated diagnostic metadata without turning it into acceptance."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('input', type=Path)
p.add_argument('output', type=Path)
args = p.parse_args()
raw = args.input.read_bytes()
trial = json.loads(raw)
assert trial['kind'] == 'p12_readonly_diagnostics' and trial['completedAt'] > 0
samples = trial['samples']
bg = [s for s in samples if not s['foreground'] and s['screenKnown'] and not s['screenActive']]
out = {
    'kind': 'p12_device_summary', 'app_version': '0.1.20',
    'hap_sha256': '29db1063755287f4d40fcaed362276e94fc4350d2682d48b1d785a7e1979eb7f',
    'input_sha256': hashlib.sha256(raw).hexdigest(),
    'started_at': trial['startedAt'], 'completed_at': trial['completedAt'],
    'duration_ms': trial['completedAt'] - trial['startedAt'], 'finish_reason': trial['reason'],
    'sample_count': len(samples), 'screen_off_background_samples': len(bg),
    'background_lease_all_samples': all(s['lease'] for s in samples),
    'connection_ready_all_samples': all(s['phase'] == 'ready' for s in samples),
    'status_replies_start_end': [samples[0]['statusReplies'], samples[-1]['statusReplies']],
    'screen_off_status_replies_start_end': [bg[0]['statusReplies'], bg[-1]['statusReplies']] if bg else [],
    'screen_off_rx_bytes_start_end': [bg[0]['rxBytes'], bg[-1]['rxBytes']] if bg else [],
    'worker_queue_ms': [s['workerMs'] for s in samples],
    'network_sequence': [s['network'] for s in samples],
    'charging_all_samples': all(s['charging'] for s in samples),
    'battery_start_end': [samples[0]['battery'], samples[-1]['battery']],
    'thermal_levels': sorted({s['thermal'] for s in samples}),
    'max_sample_gap_ms': max((b['t']-a['t'] for a,b in zip(samples, samples[1:])), default=0),
    'limits': ['90-second charging diagnostic; not all-day stability',
               'ASR queue health only; no model inference, audio or speaker accuracy',
               'Loopback HTTP polling via hdc rport; not production push or durable inbox',
               'Screen inactive plus Ability background; no password-locked security test',
               'No recording, user audio, real todo or Agent execution'],
}
args.output.write_text(json.dumps(out, indent=2)+'\n', encoding='utf-8')
print(json.dumps(out))
