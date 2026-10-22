"""Pinned official APK metadata inventory. No device, database rows, account or cloud access."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'rebuild/android-app'
apk = BASE / '.private/hosts/RayNeo-1.0.7-230-original.apk'
expected = '30239f65d910cf7008cfdf6cfacd5c068c5877068b4a637027786377a9ce4f91'
digest = hashlib.sha256()
with apk.open('rb') as source:
    for block in iter(lambda: source.read(1048576), b''):
        digest.update(block)
if digest.hexdigest() != expected:
    raise ValueError('OFFICIAL_SOURCE_MISMATCH')
with zipfile.ZipFile(apk) as archive:
    raw = archive.read('lib/arm64-v8a/libapp.so')
strings = [match.group().decode('ascii') for match in re.finditer(rb'[ -~]{6,}', raw)]
packages = set()
schemas = set()
database_names = set()
for value in strings:
    match = re.match(r'package:venus_flutter_app/features/(?:lifelog_page|recording_page|record_page|recordings_page|voice_record_page|session_page)/[A-Za-z0-9_./-]+\.dart', value)
    if match:
        packages.add(match.group())
    match = re.fullmatch(r'(?:init:)?([A-Za-z_$][A-Za-z0-9_$]*Schema)', value)
    if match and re.search(r'record|lifelog|transcript|audio', match.group(1), re.I):
        schemas.add(match.group(1))
    if re.fullmatch(r'[A-Za-z0-9_.-]{1,100}\.(?:isar|db)', value):
        database_names.add(value)
report = {
    'schema': 1, 'host_version': '1.0.7 (230)', 'official_apk_sha256': expected,
    'aot_member': 'lib/arm64-v8a/libapp.so', 'aot_sha256': hashlib.sha256(raw).hexdigest(),
    'kind': 'static AOT metadata strings only, not callable interface or database-schema proof',
    'dart_material_package_count': len(packages), 'dart_material_packages': sorted(packages),
    'candidate_schema_names': sorted(schemas), 'candidate_database_names': sorted(database_names),
    'upstream_export_adapter': 'upstream/android-addon/src/com/turboio/addon/RecordingExports.java',
    'upstream_database_transcript_reader_implemented': False,
    'confirmed_database_row_or_transcript_adapter': False,
    'device_or_user_data_accessed': False, 'source_apk_modified': False,
    'remaining': [
        'Pin account/source IDs, collection shape, transcript revision and deletion semantics from an authorized source bridge',
        'Do not open an unknown Isar file with SQLite or infer recording/lifelog type from filename',
        'Preserve original artifacts; sync only explicitly admitted material revisions',
        'Weather A20-W01 and official workflow coexistence still need physical evidence',
    ],
}
(BASE / 'official-material-source-107.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'pinned_official_apk': True, 'material_packages': len(packages), 'candidate_schema_names': len(schemas), 'device_data_read': False}))
