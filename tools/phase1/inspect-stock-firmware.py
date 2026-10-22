"""Offline inspection of the pinned 1.0.4.12 rollback archive. Never flashes.

Uses the existing symbol index only after matching each name/address against
the AP's own symbol table. A disassembly window can contain literal pools;
annotations and symbol names are research evidence, not proof of a BLE API.
Python with Capstone is needed only for --function.
"""
import argparse
import bisect
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT/'rebuild/phase1/device-private/stock-firmware-1.0.4.12/StrixOS-1.0.4.12-ORIGINAL-rollback.zip'
SYMBOLS = ROOT/'ref/Turbo-IO/firmware-research/strix-1.0.4.12/native-navigation/focus/symbols.json'
ZIP_SHA = '22c1d844a7b30715f7f2406032042a2caa74a4442e2bd9437c1ac67a6e3990a3'
AP_SHA = '53afdf5298815849eafca6f315a70606d2a605aff2e563f79050f797d615a988'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
# Bases and ranges were checked against the dispatch bounds/branch instructions
# in this exact AP. Tables cover only these ranges, not all protocol messages.
DISPATCH_TABLES = [
    ('assistant', 0x106c3fb4, 0x106c40a4, 2, 11, 'u32'),
    ('assistant', 0x106c3fb4, 0x106c40dc, 50, 15, 'u32'),
    ('launcher', 0x106eec5c, 0x106eecf4, 1, 22, 'u32'),
    ('launcher', 0x106eec5c, 0x106eed80, 78, 11, 'u32'),
    ('recorder', 0x1072eed8, 0x1072efa0, 1, 14, 'u32'),
    ('notification', 0x10705a30, 0x10705aac, 17, 19, 'u32'),
    ('prompter', 0x10719978, 0x10719a04, 1, 10, 'tbb'),
]


class Firmware:
    def __init__(self, archive=ARCHIVE):
        raw = archive.read_bytes()
        if sha(raw) != ZIP_SHA:
            raise ValueError('Archive identity differs; review mapping before analysis')
        self.manifest = []
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            if len(names) != len(set(names)):
                raise ValueError('duplicate archive member')
            declared = {r['Name']: r for r in json.loads(z.read('OtaFileInfo.json'))}
            for entry in z.infolist():
                if entry.file_size > 32*1024*1024:
                    raise ValueError('unexpected member size')
                data = z.read(entry)
                r = declared.get(entry.filename)
                matched = r is not None and r['Size'] == len(data) and r['Md5'].lower() == hashlib.md5(data).hexdigest()
                if r is not None and not matched:
                    raise ValueError('OTA member checksum differs')
                self.manifest.append(dict(name=entry.filename, bytes=len(data), sha256=sha(data), ota_size_md5_match=matched if r else None))
            if set(declared) != set(names)-{'OtaFileInfo.json'}:
                raise ValueError('manifest/member set differs')
            self.ap = z.read('nuttx_ap.bin')
        if sha(self.ap) != AP_SHA:
            raise ValueError('AP identity differs')
        self.symbol_bytes = SYMBOLS.read_bytes()
        self.index = json.loads(self.symbol_bytes)
        self.symbols = self.index['entries']
        self.by_address = {}
        for s in self.symbols:
            name_ptr, address = struct.unpack_from('<II', self.ap, s['tableOffset'])
            if address != s['address'] or self.string(name_ptr) != s['name']:
                raise ValueError('AP symbol mismatch: '+s['name'])
            if address:
                self.by_address.setdefault(address & ~1, []).append(s['name'])
        self.addresses = sorted(self.by_address)

    def offset(self, address):
        for low, high, offset in self.index['segments']:
            if low <= address < high:
                return offset+address-low
        off = address-int(self.index['flash'], 16)
        if 0 <= off < len(self.ap):
            return off
        raise ValueError('unmapped address: '+hex(address))

    def string(self, address):
        offset = self.offset(address)
        end = self.ap.find(b'\0', offset, offset+4096)
        if end < 0:
            raise ValueError('unterminated string')
        return self.ap[offset:end].decode('utf8')

    def window(self, s):
        start = s['address'] & ~1
        ix = bisect.bisect_right(self.addresses, start)
        end = self.addresses[ix]
        size = end-start
        if size > 65536:
            raise ValueError('not a bounded function window')
        offset = self.offset(start)
        raw = self.ap[offset:offset+size]
        return start, end, offset, raw

    def disassemble(self, s):
        import capstone
        start, end, offset, raw = self.window(s)
        md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
        md.skipdata = True
        lines = []
        for i in md.disasm(raw, start):
            notes = []
            if i.mnemonic in ('bl','blx','b','b.w') and i.op_str.startswith('#0x'):
                dest = int(i.op_str[1:], 16) & ~1
                notes.extend(self.by_address.get(dest, []))
            match = re.search(r'\[pc, #(-?0x[0-9a-f]+|-?\d+)\]', i.op_str)
            if i.mnemonic.startswith('ldr') and match:
                literal = ((i.address+4) & ~3)+int(match[1], 0)
                try:
                    value = struct.unpack_from('<I', self.ap, self.offset(literal))[0]
                    notes.append('literal '+hex(literal)+'='+hex(value))
                    try:
                        text = self.string(value)
                        if text and all(c.isprintable() or c in '\r\n\t' for c in text):
                            notes.append(repr(text[:260]))
                    except (ValueError, UnicodeError):
                        pass
                except (ValueError, struct.error):
                    pass
            lines.append(f'{i.address:08x} {i.bytes.hex():10} {i.mnemonic:9} {i.op_str}'+(' ; '+' | '.join(notes) if notes else ''))
        return dict(name=s['name'], start=hex(start), end=hex(end), offset=hex(offset), sha256=sha(raw),
                    note='Linear Thumb window; may include literal pools. Branch tables/indirect calls need manual review.', lines=lines)

    def inventory(self):
        groups = {}
        for s in self.symbols:
            n = s['name']
            if not s['address'] or not n.startswith('rayneo::') or any(t in n for t in ['std::','~','operator','lambda']):
                continue
            if not any(t in n for t in ['MessageProcessor::','MsgProcessor::','SettingsService::','AudioRecorder::']):
                continue
            group = n.rsplit('::', 1)[0]
            groups.setdefault(group, []).append(dict(name=n, address=hex(s['address'] & ~1), table_offset=hex(s['tableOffset'])))
        return dict(schema=1, archive_sha256=ZIP_SHA, ap_sha256=AP_SHA, symbol_index_sha256=sha(self.symbol_bytes),
                    members=self.manifest, embedded_symbols_verified=len(self.symbols), protocol_symbol_groups=groups,
                    dispatch_tables=self.dispatch_tables(),
                    limits=['Repacked cached original members; not original OTA server provenance or flash validation.',
                            'Symbol inventory is not an externally callable interface specification.',
                            'Current glasses binary identity and hardware effects are not established by this analysis.'])

    def dispatch_tables(self):
        result = []
        for group, function, base, first, count, kind in DISPATCH_TABLES:
            width = 1 if kind == 'tbb' else 4
            raw = self.ap[self.offset(base):self.offset(base)+count*width]
            symbol = next(s for s in self.symbols if s['address'] & ~1 == function)
            start, end, _, function_raw = self.window(symbol)
            if not start <= base < base+len(raw) <= end:
                raise ValueError('dispatch table outside pinned symbol window')
            rows = []
            for i in range(count):
                dest = base+raw[i]*2 if kind == 'tbb' else struct.unpack_from('<I', raw, i*4)[0] & ~1
                if not start <= dest < end:
                    raise ValueError('dispatch target outside pinned function')
                rows.append(dict(type=first+i, case_address=hex(dest)))
            result.append(dict(group=group, function=hex(function), function_sha256=sha(function_raw),
                               table_address=hex(base), encoding=kind, raw_hex=raw.hex(), rows=rows,
                               limitation='Case addresses may be default/cleanup/shared branches. Not all types are implemented commands.'))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--function', action='append', default=[], help='Exact symbol name (repeatable)')
    parser.add_argument('--address', action='append', default=[], type=lambda s: int(s, 0),
                        help='Exact symbol start address; useful for duplicate/truncated symbol names')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    fw = Firmware()
    if args.function or args.address:
        selected = [s for s in fw.symbols if s['name'] in args.function or s['address'] & ~1 in args.address]
        if not set(args.function).issubset(s['name'] for s in selected):
            raise ValueError('unknown exact function name')
        if not set(args.address).issubset(s['address'] & ~1 for s in selected):
            raise ValueError('unknown exact symbol address')
        selected = list({s['address'] & ~1: s for s in selected}.values())
        result = [fw.disassemble(s) for s in selected]
    else:
        result = fw.inventory()
    text = json.dumps(result, ensure_ascii=False, indent=2)+'\n'
    if args.out:
        args.out.write_text(text, encoding='utf8')
        print(json.dumps(dict(output=str(args.out), bytes=len(text.encode('utf8')), symbols_verified=len(fw.symbols))))
    else:
        print(text)


if __name__ == '__main__':
    main()
