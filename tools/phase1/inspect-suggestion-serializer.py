"""Read-only static inspection of the cached official Android suggestion serializer.

This reads local files and disassembles a bounded address range. It does not
connect to glasses, infer a runtime timeout, or build/flash firmware.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
START, END = 0x1554A78, 0x1554C60
EXPECTED = ['suggestUID', 'suggestType', 'type', 'title', 'source', 'content', 'timeRange']


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--objdump', default='D:/APP/DevEcoStudio/sdk/default/openharmony/native/llvm/bin/llvm-objdump.exe')
    args = parser.parse_args()
    library = ROOT / 'reverse/libapp/libapp.so'
    model = ROOT / 'reverse/blutter-out/asm/venus_flutter_app/common_services/glasses_service/notification/notification_ble_model.dart'
    pool = ROOT / 'reverse/blutter-out/pp.txt'
    symbols = ROOT / 'ref/Turbo-IO/firmware-research/strix-1.0.4.12/native-navigation/focus/symbols.json'
    # The model's RecvSuggestMsg.toJson delegates to this generated serializer.
    model_text = model.read_text(encoding='utf-8')
    section = model_text.split('class RecvSuggestMsg extends Object {', 1)[1].split('// class id:', 1)[0]
    assert 'addr: 0x23e9a64' in section and 'bl              #0x1554a78' in section
    result = subprocess.run([args.objdump, '-D', '--triple=aarch64', '--no-show-raw-insn',
                             f'--start-address={hex(START)}', f'--stop-address={hex(END)}', str(library)],
                            capture_output=True, text=True, encoding='utf-8', errors='strict', timeout=30, check=True)
    instructions = []
    for line in result.stdout.splitlines():
        match = re.match(r'\s*([0-9a-f]+):\s+(.*)', line)
        if match:
            instructions.append((int(match[1], 16), re.sub(r'\s+', ' ', match[2]).strip()))
    assert len(instructions) == (END - START) // 4
    assert instructions[0] == (START, 'stp x29, x30, [x15, #-16]!')
    assert instructions[-3][1] == 'ret'
    assert instructions[-1][1].startswith('b 0x1554a94 ')
    entries = {}
    with pool.open(encoding='utf-8') as handle:
        for line in handle:
            match = re.fullmatch(r'\[pp\+0x([0-9a-f]+)\] String: "([A-Za-z][A-Za-z0-9_]*)"\s*', line)
            if match:
                entries[int(match[1], 16)] = match[2]
    keys, base = [], None
    for address, instruction in instructions:
        add = re.match(r'add x2, x27, #(\d+), lsl #12', instruction)
        direct = re.fullmatch(r'ldr x2, \[x27, #(\d+)\]', instruction)
        indirect = re.fullmatch(r'ldr x2, \[x2, #(\d+)\]', instruction)
        if add:
            base = int(add[1]) << 12
        elif direct or (indirect and base is not None):
            offset = int(direct[1]) if direct else base + int(indirect[1])
            assert offset in entries, f'unresolved pool key at {address:x}'
            keys.append({'instruction': hex(address), 'pool_offset': hex(offset), 'key': entries[offset]})
            base = None
    assert [key['key'] for key in keys] == EXPECTED
    names = ['startDisplayTimer', 'restartSuggestDisplayTimer', 'onDisplayTimerCallback',
             'scheduleCurrentItemScreenOffClear']
    table = json.loads(symbols.read_text(encoding='utf-8'))['entries']
    candidates = [{'name': row['name'], 'address': hex(row['address'])}
                  for row in table if any(row['name'] == 'rayneo::service::notification::NotificationService::' + name for name in names)]
    assert len(candidates) == len(names)
    report = {'kind': 'local_official_serializer_static_inspection',
              'inputs': {str(path.relative_to(ROOT)).replace('\\', '/'): digest(path) for path in (library, model, pool, symbols)},
              'model_to_json': '0x23e9a64', 'generated_serializer_start': hex(START),
              'generated_serializer_end_exclusive': hex(END), 'json_keys': keys,
              'duration_field_found_in_this_serializer': False,
              'timeRange_is_display_text_not_timeout_evidence': True,
              'reference_firmware_symbol_candidates_only': candidates,
              'reference_firmware_function_bodies_inspected': False,
              'reference_symbols_match_current_device_verified': False,
              'runtime_duration_or_sleep_cause_verified': False,
              'device_access_or_setting_change': False}
    target = ROOT / 'rebuild/phase1/card-duration082-static-2026-10-15.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'artifact': target.name, 'keys': EXPECTED, 'runtime_timeout_verified': False}))


if __name__ == '__main__':
    main()
