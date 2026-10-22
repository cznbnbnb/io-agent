"""Pinned Android107 data-only OTA routing. Never changes executable segments."""
import hashlib, struct

MEMBER = 'lib/arm64-v8a/libapp.so'
INPUT_SHA = 'a35159a82c0916f62ed6c4da271a40217300cc6678b29c54f2591d9fb592a45c'
OUTPUT_SHA = '48ffd34352bf23eca928ad9c2f576347c4965a5af5ca05a35c1f1ed2ffc9fd50'
SIZE = 46465968
SLOTS = (
    (8933678, b'/xrlauncherapi/v1/signApi/gray/upgrade', b'http://127.0.0.1:18794/g/xxxxxxxA78p2M'),
    (925256, b'/xrlauncherhwapi/v1/signApi/gray/upgrade', b'http://127.0.0.1:18794/g/xxxxxxxxxxCCXhB'),
)

def patch_library(data):
    if len(data) != SIZE or hashlib.sha256(data).hexdigest() != INPUT_SHA:
        raise ValueError('Unsupported original Android107 library')
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
