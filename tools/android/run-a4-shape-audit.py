"""Read existing sealed audio on the phone; emit only bounded shape metadata.

Uses the existing signed UI test driver. Installation/cleanup remain separate so
an observation timeout never causes a duplicate installation or audit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'rebuild/android-app'
BUILD = APP / 'build'
DRIVER = 'com.turboio.androidtests'
PRODUCT = 'com.rayneo.venus.pub'


def parse_report(output, expected_nonce=None):
    # Keys such as a4_shape contain digits; do not silently discard them.
    fields = dict(re.findall(r'^INSTRUMENTATION_RESULT: ([a-z0-9_]+)=(.*)$', output, re.M))
    assert fields.get('passed') == 'true', {
        key: fields[key] for key in ['passed', 'error'] if key in fields
    }
    nonce = fields.get('probe_id', '')
    assert re.fullmatch('[a-f0-9]{32}', nonce)
    assert expected_nonce is None or nonce == expected_nonce
    shape = json.loads(fields['a4_shape'])
    numbers = {
        'sealed_segments_scanned', 'open_or_quarantined_skipped',
        'journal_bytes_verified', 'a4_batches', 'a4_data_bytes', 'a4_empty',
        'a4_batch_ogg_markers', 'a4_batch_multiple_240', 'a4_min_batch_bytes',
        'a4_max_batch_bytes', 'a4_same_session_task',
        'unowned_stock_cache_entries_not_read', 'probe_original_writes',
        'probe_explicit_http_requests',
    }
    flags = {
        'budget_limited', 'stock_cache_directory_present', 'originals_unchanged',
        'audio_bytes_returned', 'format_or_codec_proven',
    }
    assert set(shape) == numbers | flags | {'batch_kinds', 'stock_caches_for_verified_tasks'}
    assert all(type(shape[key]) is int and 0 <= shape[key] <= 134217728 for key in numbers)
    assert all(type(shape[key]) is bool for key in flags)
    kinds = shape['batch_kinds']
    assert isinstance(kinds, dict) and set(kinds) <= {'A3', 'A4', 'A5', 'link_lost'}
    assert all(type(value) is int and value >= 0 for value in kinds.values())
    caches = shape['stock_caches_for_verified_tasks']
    assert isinstance(caches, list) and len(caches) <= 256
    for entry in caches:
        assert set(entry) == {'current_verified_task', 'bytes', 'ogg_marker', 'multiple_of_240'}
        assert entry['current_verified_task'] is True
        assert type(entry['bytes']) is int and entry['bytes'] >= 0
        assert type(entry['ogg_marker']) is bool and type(entry['multiple_of_240']) is bool
    assert shape['originals_unchanged'] and not shape['audio_bytes_returned']
    assert shape['probe_original_writes'] == shape['probe_explicit_http_requests'] == 0
    assert shape['format_or_codec_proven'] is False
    for key in ['original_audio_removed', 'new_recording_started', 'audio_uploaded_played_or_returned']:
        assert fields.get(key) == 'false'
    return {
        'probe_id': nonce, 'passed': True, 'product': 'dev87 /10509', 'a4_shape': shape,
        **{key: fields[key] for key in [
            'original_audio_removed', 'new_recording_started', 'audio_uploaded_played_or_returned'
        ]},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--parse-only', type=Path)
    parser.add_argument('--serial')
    parser.add_argument('--serial-sha256')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.parse_only:
        assert not args.apply and not args.serial and not args.serial_sha256
        report = parse_report(args.parse_only.read_text())
    else:
        assert args.apply and args.serial and re.fullmatch('[a-f0-9]{64}', args.serial_sha256 or '')
        lock = json.loads(subprocess.check_output(
            ['node', 'tools/collab/device-lock.mjs', 'status'], cwd=ROOT
        ))
        assert lock.get('state') == 'held' and lock['owner'] == 'codex'
        candidate = json.loads((APP / 'candidate.json').read_text())
        assert candidate['version_code'] == 10509 and candidate['installed']
        build = json.loads((BUILD / 'a4-shape-driver-build-report.json').read_text())
        source = ROOT / 'tools/android/LifelogAudioExportProbe.java'
        assert hashlib.sha256(source.read_bytes()).hexdigest() == build['source_sha256']
        adb = [str(APP / '.tools/sdk/platform-tools/adb'), '-s', args.serial]

        def call(values, timeout=35):
            return subprocess.check_output(adb + values, text=True, timeout=timeout).strip()

        assert hashlib.sha256(call(['shell', 'getprop', 'ro.serialno']).encode()).hexdigest() == args.serial_sha256
        for package, expected in [(PRODUCT, candidate['sha256']), (DRIVER, build['apk_sha256'])]:
            path = call(['shell', 'pm', 'path', package])
            assert path.startswith('package:/data/app/') and path.endswith('/base.apk')
            assert call(['shell', 'sha256sum', path[8:]]).split()[0] == expected
        import secrets
        nonce = secrets.token_hex(16)
        output = call([
            'shell', 'am', 'instrument', '-w', '-e', 'probe_id', nonce,
            '-e', 'mode', 'a4-shape', '-e', 'version_code', '10509',
            DRIVER + '/' + DRIVER + '.LifelogAudioExportProbe',
        ], 90)
        (BUILD / ('a4-shape-probe-' + nonce + '.log')).write_text(output + '\n')
        report = parse_report(output, nonce)
        (BUILD / 'a4-shape-phone-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
