"""Pinned Android110 data-only OTA routing. Never changes executable segments."""
import hashlib, struct

MEMBER = 'lib/arm64-v8a/libapp.so'
INPUT_SHA = '363aa67372f41b65c3ef980d856ceb14013f3300257b9be6b91edd865911e15c'
OUTPUT_SHA = '51aa02e05a8df9fcd8730f778f8cd5eaaed78689487b2bc96e7308a690dd5a47'
SIZE = 45089712
SLOTS = (
    (8872178, b'/xrlauncherapi/v1/signApi/gray/upgrade', b'http://127.0.0.1:18795/g/xxxxxxxOhuKnB'),
    (902816, b'/xrlauncherhwapi/v1/signApi/gray/upgrade', b'http://127.0.0.1:18795/g/xxxxxxxxxpJTwXJ'),
)

def patch_library(data):
    if len(data) != SIZE or hashlib.sha256(data).hexdigest() != INPUT_SHA:
        raise ValueError('Unsupported original Android110 library')
    if data[:7] != b'\x7fELF\x02\x01\x01' or struct.unpack_from('<H', data, 18)[0] != 183:
        raise ValueError('Expected little-endian ARM64 ELF')
    phoff = struct.unpack_from('<Q', data, 32)[0]
    ents, count = struct.unpack_from('<HH', data, 54)
    if ents < 56 or not 1 <= count <= 32 or phoff + ents * count > len(data):
        raise ValueError('Invalid ELF program headers')
    loads = []
    for i in range(count):
        at = phoff + i * ents
        kind, flags, offset = struct.unpack_from('<IIQ', data, at)
        length = struct.unpack_from('<Q', data, at + 32)[0]
        if kind == 1:
            loads.append((offset, offset + length, flags))
    output = bytearray(data)
    for offset, old, new in SLOTS:
        if len(old) != len(new) or data.find(old) != offset or data.find(old, offset + 1) != -1:
            raise ValueError('OTA route slot is not unique/exact')
        if data[offset - 1] != 128 + len(old) * 2:
            raise ValueError('Dart serialized string prefix differs')
        covering = [s for s in loads if s[0] <= offset and offset + len(old) <= s[1]]
        if len(covering) != 1 or covering[0][2] != 4:
            raise ValueError('OTA route is not in a read-only nonexecuting segment')
        output[offset:offset + len(old)] = new
    if hashlib.sha256(output).hexdigest() != OUTPUT_SHA:
        raise ValueError('Whole-library OTA route result differs')
    return bytes(output)

def report():
    return {'member': MEMBER, 'input_sha256': INPUT_SHA, 'output_sha256': OUTPUT_SHA,
            'bytes': SIZE, 'only_two_serialized_urls_changed': True,
            'all_slots_in_readonly_nonexecuting_segments': True, 'instructions_changed': False}
