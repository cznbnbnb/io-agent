"""Reduce one isolated capture's private wire log to public handshake metadata."""
import argparse
import hashlib
import json
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--journal', required=True, type=Path)
p.add_argument('--log', required=True, type=Path)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--version', required=True)
p.add_argument('--hap-sha256', required=True)
a = p.parse_args()
assert re.fullmatch(r'0\.1\.\d+', a.version)
assert re.fullmatch(r'[a-f0-9]{64}', a.hap_sha256)
r = json.loads(a.journal.read_text(encoding='utf-8-sig'))
assert r['schema'] == 1 and r['kind'] == 'p22_actual_daily_coordinator'
assert re.fullmatch(r'/data/storage/el2/base/haps/entry/files/p22-daily-lab/run-[0-9]{13}', r['root'])
assert r['created'] == int(r['root'].rsplit('-', 1)[1])
raw = a.log.read_bytes()
assert len(raw) < 2_000_000
rows = [json.loads(line) for line in raw.decode('utf-8-sig').splitlines() if line.strip()]
assert rows and all(isinstance(x.get('t'), int) and x['t'] >= r['created'] for x in rows)
starts = [x for x in rows if x.get('ev') == 'start']
assert len(starts) == 1, 'Expected one fresh capture, not merged logs'
start = starts[0]['t']
first = lambda ev: next((x['t'] for x in rows if x.get('ev') == ev), None)
a1 = next((x['t'] for x in rows if x.get('ev') == 'pkt' and re.match(r'^t161(?:\s|$)', x.get('x', ''))), None)
a2, audio = first('a2-sent'), first('audio')
launcher = []
for row in rows:
    if row.get('ev') != 'launcher-rx':
        continue
    wire = json.loads(row['x'])
    if wire.get('cmd') == 'life_log_switch_result':
        value = wire.get('payload', {}).get('value')
        assert isinstance(value, int)
        launcher.append({'cmd': 'life_log_switch_result', 'value': value})
samples = r['samples']
assert samples
payload = max(x['bytes'] for x in samples)
out = {
    'kind': 'p22_isolated_capture_handshake', 'version': a.version,
    'signed_hap_sha256': a.hap_sha256, 'phase': r['phase'],
    'observed_launcher_results': launcher, 'a1_observed': a1 is not None,
    'a2_submitted': a2 is not None, 'audio_packet_observed': audio is not None,
    'audio_payload_bytes': payload,
    'a1_after_start_ms': None if a1 is None else a1 - start,
    'first_audio_after_a2_ms': None if audio is None or a2 is None else audio - a2,
    'stop_requested': first('stop-req') is not None,
    'archive_finalize_observed': first('finish-ok') is not None,
    'private_log_sha256': hashlib.sha256(raw).hexdigest(),
    'switch_success_is_audio_evidence': False,
    'intermittent_missing_wake_resolved': False,
    'wearer_or_microphone_hardware_cause_proven': False,
    'eight_hour_acceptance_passed': False,
}
a.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(out, ensure_ascii=False))
