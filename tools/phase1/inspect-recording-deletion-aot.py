#!/usr/bin/env python3
"""Bounded, local ARM64 slices from the verified official 1.0.7 ELF.

Blutter's pool is an annotation aid. Linear register tracking does not establish
control flow, account ownership, successful deletion, or permission to delete.
No Dart application code, HTTP request, or device command is executed here.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
from elftools.elf.elffile import ELFFile

OFFICIAL_LIB_SHA256 = "a35159a82c0916f62ed6c4da271a40217300cc6678b29c54f2591d9fb592a45c"


def digest(path):
    with path.open("rb") as source:
        result = hashlib.sha256()
        for chunk in iter(lambda: source.read(1048576), b""):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lib", type=Path, required=True)
    parser.add_argument("--pool", type=Path, required=True)
    parser.add_argument("--range", action="append", required=True,
                        help="label:start:end, with hexadecimal ELF virtual addresses")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if digest(args.lib) != OFFICIAL_LIB_SHA256:
        parser.error("official 1.0.7 libapp.so hash mismatch")
    if not 1 <= len(args.range) <= 16 or args.pool.stat().st_size > 32 * 1048576:
        parser.error("input budget exceeded")
    ranges = []
    for raw in args.range:
        label, start, end = raw.split(":")
        start, end = int(start, 16), int(end, 16)
        if not re.fullmatch(r"[a-z0-9_-]{1,64}", label) or start % 4 or end % 4 or not 0 < end-start <= 65536:
            parser.error("invalid slice")
        ranges.append((label, start, end))
    if sum(end-start for _, start, end in ranges) > 262144:
        parser.error("slice budget exceeded")
    pool = {}
    for line in args.pool.read_text().splitlines():
        match = re.fullmatch(r"\[pp\+0x([0-9a-f]+)\] (.*)", line)
        if match:
            pool[int(match[1], 16)] = match[2]
    disassembler = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    sections = []
    with args.lib.open("rb") as source:
        elf = ELFFile(source)
        if elf["e_machine"] != "EM_AARCH64":
            parser.error("not an ARM64 ELF")
        for label, start, end in ranges:
            segments = [s for s in elf.iter_segments() if s["p_type"] == "PT_LOAD"
                        and s["p_flags"] & 1 and s["p_vaddr"] <= start
                        and end <= s["p_vaddr"] + s["p_filesz"]]
            if len(segments) != 1:
                parser.error("slice is not inside one executable segment")
            segment = segments[0]
            source.seek(segment["p_offset"] + start-segment["p_vaddr"])
            data = source.read(end-start)
            rows, bases = [], {}
            for instruction in disassembler.disasm(data, start):
                op, operands = instruction.mnemonic, instruction.op_str
                row = {"address": hex(instruction.address), "instruction": op+" "+operands}
                load = re.fullmatch(r"[xw]\d+, \[(x\d+)(?:, #(0x[0-9a-f]+|[0-9]+))?\]", operands)
                if op == "ldr" and load:
                    base = 0 if load[1] == "x27" else bases.get(load[1])
                    if base is not None:
                        offset = base + int(load[2] or "0", 0)
                        if offset in pool:
                            row["pool"] = {"offset": hex(offset), "value": pool[offset]}
                dest = re.match(r"(x\d+),", operands)
                if dest and op not in ("str", "stur", "stp", "cmp", "tst", "cbz", "cbnz", "tbz", "tbnz"):
                    bases.pop(dest[1], None)
                add = re.fullmatch(r"(x\d+), x27, #(0x[0-9a-f]+|[0-9]+)(?:, lsl #(0xc|12))?", operands)
                if op == "add" and add:
                    bases[add[1]] = int(add[2], 0) * (4096 if add[3] else 1)
                if op in ("bl", "blr"):
                    bases.clear()
                rows.append(row)
            if len(rows)*4 != len(data):
                parser.error("slice contains undecoded bytes")
            sections.append({"label": label, "start": hex(start), "end": hex(end),
                             "bytes_sha256": hashlib.sha256(data).hexdigest(), "rows": rows})
    result = {"kind": "official_107_local_aot_linear_slices", "library_sha256": OFFICIAL_LIB_SHA256,
              "pool_sha256": digest(args.pool), "limit": __doc__, "ranges": sections}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n")
    print(json.dumps({"output": str(args.output), "ranges": len(sections),
                      "instructions": sum(len(s["rows"]) for s in sections)}))


if __name__ == "__main__":
    main()
