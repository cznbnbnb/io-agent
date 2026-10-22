"""Pinned StrixOS suggestion timer experiments; OFFLINE, NEVER FLASHES.

Default: validate/build in memory and print metadata. --output-dir writes one
new UNFLASHED ZIP and its report under device-private, refusing any overwrite.
There is no HDC/BLE/network/installation code. Not a boot or recovery guarantee.
"""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import zipfile

SPEC = importlib.util.spec_from_file_location('stock_firmware', Path(__file__).with_name('inspect-stock-firmware.py'))
stock = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stock)
BASE = 0x10190000
EXPERIMENT = 'SUGGEST60-OFFLINE-01'
FILENAME = 'StrixOS-1.0.4.12-SUGGEST60-OFFLINE-01-UNFLASHED.zip'
# Encodings independently assembled by DevEco LLVM from suggestion60-instructions.S.
# The conditional MOVW remains inside the original IT NE block; no flags change.
PATCHES = (
    ('initial_default', 0x106f94ec, '41f28831', '4ef66021', 'r1'),
    ('initial_gesture_hint', 0x106f94f4, '4ff4fa51', '4ef66021', 'r1'),
    ('focus_change_restart', 0x106f39d4, '41f28831', '4ef66021', 'r1'),
    ('restart_log_value', 0x106f39de, '41f28833', '4ef66023', 'r3'),
)
PATCHES_1055 = (
    ('initial_default', 0x1058f028, '41f28831', '4ef66021', 'r1'),
    ('initial_gesture_hint', 0x1058f030, '4ff4fa51', '4ef66021', 'r1'),
    ('focus_change_restart', 0x105866b0, '41f28831', '4ef66021', 'r1'),
    ('restart_log_value', 0x105866ba, '41f28833', '4ef66023', 'r3'),
)
PROFILES = {
    '1.0.4.12': dict(archive=stock.ARCHIVE, zip_sha=stock.ZIP_SHA, ap_sha=stock.AP_SHA,
                     payloads=14, patches=PATCHES, initial_block=(0x106f94ea, 0x106f94f8)),
    '1.0.5.5': dict(archive=stock.ROOT/'rebuild/phase1/device-private/stock-firmware-1.0.5.5/Strix-OS-1.0.5.5-original.zip',
                    zip_sha='2927917f976ef3c9b183253e2342a7a0c85a3e454e973876100f3158da5ec367',
                    ap_sha='b3d6d9d7a4ece97e1dbaa64fc080eb5db8a5f7c9fecf340888ebb97a9112cc6c',
                    payloads=15, patches=PATCHES_1055, initial_block=(0x1058f026, 0x1058f034)),
}


def patch_ap(original, version='1.0.4.12'):
    profile = PROFILES[version]
    if stock.sha(original) != profile['ap_sha']:
        raise ValueError('AP identity mismatch; modified/other-version inputs refused')
    patched = bytearray(original)
    for _, va, before, after, _ in profile['patches']:
        off = va-BASE
        old, new = bytes.fromhex(before), bytes.fromhex(after)
        if len(old) != 4 or len(new) != 4 or original[off:off+4] != old:
            raise ValueError('Pinned four-byte instruction mismatch')
        patched[off:off+4] = new
    return bytes(patched)


def verify_ap(original, candidate, version='1.0.4.12'):
    profile = PROFILES[version]
    if stock.sha(original) != profile['ap_sha'] or len(candidate) != len(original):
        raise ValueError('AP baseline/length mismatch')
    cursor = 0
    changes = []
    reverse = bytearray(candidate)
    for name, va, before, after, register in sorted(profile['patches'], key=lambda p: p[1]):
        off = va-BASE
        if candidate[cursor:off] != original[cursor:off]:
            raise ValueError('Unexpected modification outside instruction whitelist')
        if candidate[off:off+4] != bytes.fromhex(after) or original[off:off+4] != bytes.fromhex(before):
            raise ValueError('Instruction patch mismatch')
        reverse[off:off+4] = bytes.fromhex(before)
        changes.append(dict(name=name, address=hex(va), offset=hex(off), before=before, after=after,
                            register=register, milliseconds=60000))
        cursor = off+4
    if candidate[cursor:] != original[cursor:] or stock.sha(reverse) != profile['ap_sha']:
        raise ValueError('Unexpected tail modification or reverse mismatch')
    return changes


def verify_instructions(original, candidate, version='1.0.4.12'):
    profile = PROFILES[version]
    import capstone
    from capstone.arm import ARM_CC_NE, ARM_OP_IMM, ARM_OP_REG
    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    md.detail = True
    for _, va, _, _, register in profile['patches']:
        off = va-BASE
        decoded = list(md.disasm(candidate[off:off+4], va))
        if len(decoded) != 1:
            raise ValueError('Not one complete instruction')
        ins = decoded[0]
        # Some Capstone versions expose MOVW under ARM_INS_MOV. Check the
        # decoded encoding name plus operand/flag semantics, not that enum ID.
        if (ins.mnemonic != 'movw' or ins.size != 4 or ins.update_flags or
                ins.operands[0].type != ARM_OP_REG or md.reg_name(ins.operands[0].reg) != register or
                ins.operands[1].type != ARM_OP_IMM or ins.operands[1].imm != 60000):
            raise ValueError('Unexpected patch instruction semantics')
    start, end = profile['initial_block']
    changed_addresses = {p[1] for p in profile['patches'][:2]}
    old = list(md.disasm(original[start-BASE:end-BASE], start))
    new = list(md.disasm(candidate[start-BASE:end-BASE], start))
    if ([i.address for i in old] != [i.address for i in new] or
            new[-1].cc != ARM_CC_NE or new[-1].update_flags or
            [i.bytes for i in old if i.address not in changed_addresses] !=
            [i.bytes for i in new if i.address not in changed_addresses]):
        raise ValueError('CMP/IT NE block or instruction boundaries changed')
    return [f'{i.address:08x} {i.bytes.hex()} {i.mnemonic} {i.op_str}' for i in new]


def verify_archive(candidate, originals, patched_ap):
    expected_manifest = json.loads(originals['OtaFileInfo.json'])
    ap_row = next(r for r in expected_manifest if r['Name'] == 'nuttx_ap.bin')
    ap_row['Md5'] = hashlib.md5(patched_ap).hexdigest()
    with zipfile.ZipFile(io.BytesIO(candidate)) as z:
        if z.namelist() != list(originals):
            raise ValueError('Archive member order/set/duplicates changed')
        members = []
        for entry in z.infolist():
            name = entry.filename
            if entry.file_size != len(originals[name]):
                raise ValueError('Unexpected member length')
            data = z.read(entry)  # CRC checked by ZipFile.
            if name == 'OtaFileInfo.json':
                if json.loads(data) != expected_manifest:
                    raise ValueError('Manifest changed beyond AP MD5')
            elif name == 'nuttx_ap.bin':
                if data != patched_ap:
                    raise ValueError('Packaged AP differs from validated candidate')
            elif data != originals[name]:
                raise ValueError('Other payload changed: '+name)
            members.append(dict(name=name, bytes=len(data), sha256=stock.sha(data),
                                content_changed=data != originals[name]))
        for row in expected_manifest:
            data = z.read(row['Name'])
            if row['Size'] != len(data) or row['Md5'].lower() != hashlib.md5(data).hexdigest():
                raise ValueError('Candidate manifest checksum mismatch')
    return members


def load_source(version):
    profile = PROFILES[version]
    raw = profile['archive'].read_bytes()
    if stock.sha(raw) != profile['zip_sha']:
        raise ValueError('Source archive identity mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        entries = source.infolist()
        names = source.namelist()
        if (len(names) != profile['payloads']+1 or len(set(names)) != len(names) or
                any(n != Path(n).name or n.startswith('.') for n in names) or
                any(e.file_size > 32*1024*1024 for e in entries) or
                sum(e.file_size for e in entries) > 32*1024*1024):
            raise ValueError('Unexpected source member set or sizes')
        originals = {e.filename: source.read(e) for e in entries}
    rows = json.loads(originals['OtaFileInfo.json'])
    if (len(rows) != profile['payloads'] or len({r['Name'] for r in rows}) != len(rows) or
            set(originals) != {r['Name'] for r in rows} | {'OtaFileInfo.json'}):
        raise ValueError('Source manifest member mismatch')
    for row in rows:
        data = originals[row['Name']]
        if len(data) != row['Size'] or hashlib.md5(data).hexdigest() != row['Md5'].lower():
            raise ValueError('Source payload checksum mismatch')
    if stock.sha(originals['nuttx_ap.bin']) != profile['ap_sha']:
        raise ValueError('Source AP identity mismatch')
    return raw, originals


def build(version='1.0.4.12'):
    profile = PROFILES[version]
    archive_bytes, originals = load_source(version)
    original = originals['nuttx_ap.bin']
    patched = patch_ap(original, version)
    changes = verify_ap(original, patched, version)
    block = verify_instructions(original, patched, version)
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as source:
        manifest = originals['OtaFileInfo.json']
        old_md5 = next(r['Md5'] for r in json.loads(manifest) if r['Name'] == 'nuttx_ap.bin').encode('ascii')
        if manifest.count(old_md5) != 1:
            raise ValueError('AP MD5 is not uniquely replaceable')
        new_manifest = manifest.replace(old_md5, hashlib.md5(patched).hexdigest().encode('ascii'))
        with zipfile.ZipFile(buf, 'w') as dest:
            dest.comment = source.comment
            for entry in source.infolist():
                data = patched if entry.filename == 'nuttx_ap.bin' else new_manifest if entry.filename == 'OtaFileInfo.json' else originals[entry.filename]
                dest.writestr(copy.copy(entry), data)
    candidate = buf.getvalue()
    members = verify_archive(candidate, originals, patched)
    filename = FILENAME if version == '1.0.4.12' else f'StrixOS-{version}-SUGGEST60-OFFLINE-01-UNFLASHED.zip'
    report = dict(schema=1, experiment=EXPERIMENT, firmware_baseline=version, status='OFFLINE_VALIDATED_UNFLASHED',
                  source_zip_sha256=profile['zip_sha'], original_ap_sha256=profile['ap_sha'],
                  candidate_filename=filename, candidate_bytes=len(candidate), candidate_sha256=stock.sha(candidate),
                  candidate_ap_sha256=stock.sha(patched), ap_bytes=len(patched),
                  changed_ap_bytes=sum(a != b for _, _, before, after, _ in profile['patches'] for a, b in zip(bytes.fromhex(before), bytes.fromhex(after))),
                  patches=changes, initial_conditional_disassembly=block, members=members,
                  checks=dict(exact_baseline=True, instruction_whitelist=True, equal_ap_length=True,
                              original_cmp_it_preserved=True, patch_instructions_do_not_write_flags=True,
                              offline_reverse_restores_original_hash=True, unchanged_other_payloads=profile['payloads']-1,
                              manifest_only_ap_md5_changed=True, zip_readback_crc_and_checksums=True),
                  scope='Global original suggestion timers, including calendar and todo suggestions; not limited to this App. Focus change restarts a new 60 seconds.',
                  not_verified=['current-device binary match', 'boot/signature acceptance', 'OTA transfer/install',
                                'one-minute lens visibility', 'gesture/animation/exit regression',
                                'power/stability', 'same-version rollback or dead-device recovery'],
                  flash_authorized=False, device_contacted=False)
    return candidate, report


def write_candidate(directory, candidate, report):
    if stock.sha(candidate) != report['candidate_sha256']:
        raise ValueError('Candidate does not match report')
    directory = directory.resolve()
    allowed = (stock.ROOT/'rebuild/phase1/device-private').resolve()
    if not directory.is_relative_to(allowed) or directory == allowed:
        raise ValueError('Output must be a new directory under project device-private')
    filename = report['candidate_filename']
    if filename not in [FILENAME, 'StrixOS-1.0.5.5-SUGGEST60-OFFLINE-01-UNFLASHED.zip']:
        raise ValueError('Unexpected candidate filename')
    directory.mkdir(exist_ok=False)
    with (directory/filename).open('xb') as out:
        out.write(candidate)
    with (directory/'offline-report.json').open('x', encoding='utf8') as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
        out.write('\n')
    if stock.sha((directory/filename).read_bytes()) != report['candidate_sha256']:
        raise ValueError('Written artifact hash mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware-version', choices=tuple(PROFILES), required=True,
                        help='Exact baseline; never infer the connected device version or reuse old offsets')
    parser.add_argument('--output-dir', type=Path, help='Optional NEW private directory; never an in-place patch')
    args = parser.parse_args()
    candidate, report = build(args.firmware_version)
    if args.output_dir:
        write_candidate(args.output_dir, candidate, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
