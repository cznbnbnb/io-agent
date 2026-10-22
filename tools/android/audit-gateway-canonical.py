"""Record signer provenance without exporting embedded signing constants.

The old Dart snapshot proves its own regional selection, not current Dart
control flow. Exact occurrence in the pinned current library is a candidate
binding, not proof of lifelog authentication. No device or network access.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'rebuild/android-app'
old = ROOT / 'reverse/libapp/libapp.so'
old_hash = hashlib.sha256(old.read_bytes()).hexdigest()
assert old_hash == 'eba61c2b6c161b05da0c68018d81240257eb4986037f746f8646f40f641be6dc'
apk = BASE / '.private/hosts/RayNeo-1.0.7-230-original.apk'
with apk.open('rb') as stream:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1048576), b''):
        digest.update(chunk)
assert digest.hexdigest() == '30239f65d910cf7008cfdf6cfacd5c068c5877068b4a637027786377a9ce4f91'
with zipfile.ZipFile(apk) as archive:
    raw = archive.read('lib/arm64-v8a/libapp.so')
pool = dict(re.findall(r'^\[pp\+0x([0-9a-f]+)\] String: "(.*)"$', (ROOT / 'reverse/blutter-out/pp.txt').read_text(encoding='utf-8'), re.M))
exe = Path('D:/APP/DevEcoStudio/sdk/default/openharmony/native/llvm/bin/llvm-objdump.exe')
run = subprocess.run([str(exe), '-D', '--triple=aarch64', '--start-address=0x1f31650', '--stop-address=0x1f316a0', str(old)], capture_output=True, text=True, check=True, timeout=40)
# Both selectors compare the same overseas enum at pp+0x5cc68.
# Equality returns key pp+0x5d190 / app pp+0x5d1a0; inequality returns
# key pp+0x5d198 / app pp+0x5d1a8. Preserve instructions only, never pool values.
instructions = [line.strip() for line in run.stdout.splitlines() if re.match(r'\s*[0-9a-f]+:\s+[0-9a-f]{8}\s', line)]
for word in ('f9463610', '54000081', 'f940c800', 'f940cc00', 'f940d000', 'f940d400'):
    assert any(word in line for line in instructions)
assert 'off_10: "overseas"' in (ROOT / 'reverse/blutter-out/pp.txt').read_text(encoding='utf-8').split('[pp+0x5cc68]')[1].split('[pp+')[0]
bindings = []
for region, app_slot, key_slot in [('domestic', '5d1a8', '5d198'), ('overseas', '5d1a0', '5d190')]:
    app, key = pool[app_slot], pool[key_slot]
    assert re.fullmatch(r'\d{17}', app) and re.fullmatch(r'[a-fA-F0-9]{64}', key)
    assert raw.count(app.encode()) == 1 and raw.count(key.encode()) == 1
    bindings.append({'historical_region': region, 'historical_app_pool': app_slot,
                     'historical_key_pool': key_slot, 'app_length': len(app), 'key_length': len(key),
                     'current_app_file_offset': raw.index(app.encode()), 'current_key_file_offset': raw.index(key.encode()),
                     'both_exactly_once_in_current_pinned_aot': True,
                     'current_region_control_flow_verified': False})
phone = json.loads((BASE / 'phone-gateway-canonical-2026-10-21.json').read_text(encoding='utf-8'))
assert len(phone['audit']['vectors']) == 5 and all(v['host_signature_matches'] for v in phone['audit']['vectors'])
report = {'schema': 1, 'kind': 'Synthetic installed-host signer verification and static candidate provenance',
          'official_apk_sha256': digest.hexdigest(), 'current_aot_sha256': hashlib.sha256(raw).hexdigest(),
          'historical_aot_sha256': old_hash, 'historical_selector_instructions': instructions,
          'candidate_bindings': bindings, 'installed_host_verification': 'phone-gateway-canonical-2026-10-21.json',
          'canonical': {'request': 'METHOD\\nPATH\\nRAW_QUERY\\nxtcl-nonce:NONCE;xtcl-timestamp:SECONDS;\\nBASE64_SHA256_EMPTY',
                        'string_to_sign': 'TCL1-HMAC-SHA256\\nSECONDS\\nBASE64_SHA256_CANONICAL',
                        'signature': 'standard Base64(HMAC-SHA256(key UTF-8 bytes, string_to_sign UTF-8 bytes))'},
          'production_apk_changed': False, 'credentials_exported': False, 'network_requests': 0,
          'lifelog_authentication_verified': False,
          'next': 'Confirm current lifelog signing binding with one bounded current-account read-only request; do not reuse dictionary-service app credentials or infer deletion from cache absence.'}
(BASE / 'gateway-canonical-2026-10-21.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'synthetic_host_vectors': 5, 'historical_regional_pairs_found_in_current_library': len(bindings), 'lifelog_authentication_verified': False, 'secrets_exported': False}))
