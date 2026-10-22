"""Build a source-only iO release; never deploy, mint credentials or copy data."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

RUNTIME = tuple('rebuild/material-server/' + name for name in (
    'store.mjs', 'http.mjs', 'json.mjs', 'validation.mjs', 'cli.mjs', 'traffic.mjs',
    'package.json', 'package-lock.json', '.node-version',
    'admin/index.html', 'admin/app.js', 'admin/style.css'))
CONTRACTS = ('docs/contracts/event-v1.schema.json', 'docs/contracts/event-v1.1.schema.json')
FILES = RUNTIME + CONTRACTS
VERIFICATION_SOURCES = ('rebuild/material-server/verify.mjs',
                        'rebuild/material-server/tests/request-lifecycle.test.mjs',
                        'rebuild/material-server/tests/request-lifecycle-worker.mjs',
                        'docs/contracts/request-lifecycle.json')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sources(root):
    report = json.loads((root / 'rebuild/material-server/verification/result.json').read_text(encoding='utf-8'))
    if report.get('status') != 'passed' or report.get('failed') != 0 or report.get('tests', 0) < 47:
        raise ValueError('SERVER_VERIFICATION_NOT_PASSED')
    lifecycle = [suite for suite in report.get('suites', []) if suite.get('file') == 'tests/request-lifecycle.test.mjs']
    if len(lifecycle) != 1 or lifecycle[0].get('status') != 'passed' or lifecycle[0].get('failed') != 0 or \
       lifecycle[0].get('tests', 0) < 8 or lifecycle[0].get('passed') != lifecycle[0].get('tests'):
        raise ValueError('REQUEST_LIFECYCLE_NOT_VERIFIED')
    for name in VERIFICATION_SOURCES:
        path = root / name
        key = name.removeprefix('rebuild/material-server/') if name.startswith('rebuild/material-server/') else '../../' + name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1048576 or \
           sha(path.read_bytes()) != report.get('source_sha256', {}).get(key):
            raise ValueError('VERIFICATION_SOURCE_CHANGED')
    payloads = {}
    for name in FILES:
        path = root / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1048576:
            raise ValueError('SOURCE_TYPE_OR_SIZE_INVALID')
        data = path.read_bytes()
        key = name.removeprefix('rebuild/material-server/') if name in RUNTIME else '../../' + name
        if sha(data) != report.get('source_sha256', {}).get(key):
            raise ValueError('SOURCE_NOT_VERIFIED')
        payloads[name] = data
    return report, payloads


def build(root, out, release_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', release_id):
        raise ValueError('RELEASE_ID_INVALID')
    report, payloads = sources(root)
    manifest = {'schema': 1, 'release_id': release_id,
                'scope': 'source only; isolated iO service; no nginx/site/credentials/main-database migration',
                'node_version': payloads['rebuild/material-server/.node-version'].decode().strip(),
                'verified_tests': report['tests'],
                'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in payloads.items()}}
    out.mkdir(parents=True, exist_ok=True)
    archive = out / (release_id + '.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as package:
        package.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        for name, data in payloads.items():
            package.writestr(name, data)
    verified = inspect(archive)
    return {**verified, 'archive': str(archive.resolve()), 'archive_sha256': sha(archive.read_bytes())}


def inspect(archive):
    # This verifies the review package only; production activation must also
    # fence the current remote generation and prove rollback/health separately.
    if archive.stat().st_size > 8388608:
        raise ValueError('ARCHIVE_TOO_LARGE')
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(set(names)) or set(names) != set(FILES) | {'manifest.json'}:
            raise ValueError('ARCHIVE_SCOPE_INVALID')
        if any(info.file_size > 1048576 or info.is_dir() or
               (info.external_attr >> 16) & 0o170000 == 0o120000 for info in package.infolist()):
            raise ValueError('ARCHIVE_MEMBER_INVALID')
        manifest = json.loads(package.read('manifest.json'))
        if manifest.get('schema') != 1 or set(manifest.get('files', {})) != set(FILES) or \
           not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', str(manifest.get('release_id', ''))) or \
           not re.fullmatch(r'22\.\d+\.\d+', str(manifest.get('node_version', ''))) or \
           type(manifest.get('verified_tests')) is not int or manifest['verified_tests'] < 39:
            raise ValueError('MANIFEST_INVALID')
        for name in FILES:
            data = package.read(name)
            if manifest['files'][name] != {'sha256': sha(data), 'bytes': len(data)}:
                raise ValueError('ARCHIVE_HASH_MISMATCH')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--release-id', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    result = build(root, root / 'rebuild/phase1/artifacts', args.release_id)
    target = root / ('rebuild/phase1/' + args.release_id + '-manifest.json')
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'packaged', 'release_id': args.release_id, 'file_count': len(FILES),
                      'archive_sha256': result['archive_sha256'], 'verified_tests': result['verified_tests']}))
