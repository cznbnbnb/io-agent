"""Prepare an explicit, auditable GitHub source inventory without reading secrets.

This never stages, commits, uploads, deletes or reads private directories. The
manifest and findings stay in the excluded Android private directory. A clean
Git baseline is assembled separately only after reviewing the findings.
"""
from pathlib import Path
import collections
import hashlib
import json
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rebuild/android-app/.private/github-publication-2026-10-22'
PRUNED = {'.git', '.private', 'private', '.tools', '.downloads', 'build',
          'node_modules', 'oh_modules', '.hvigor', '__pycache__', 'verification',
          'artifacts', 'runtime-home', 'device-private', 'model-cache',
          'baseline-source', 'candidate-runs', 'research', 'ui'}
DENIED = {'.apk', '.hap', '.app', '.har', '.so', '.a', '.zip', '.jks',
          '.keystore', '.key', '.pem', '.p12', '.p7b', '.cer', '.sqlite',
          '.sqlite-wal', '.sqlite-shm', '.db', '.log', '.tap', '.jsonl',
          '.ndjson', '.wav', '.pcm', '.ogg', '.mp3', '.m4a', '.bin', '.onnx',
          '.tar', '.gz', '.7z', '.exe', '.dll', '.jar', '.class', '.dex'}
TEXT = {'.java', '.mjs', '.js', '.cjs', '.py', '.ps1', '.sh', '.ts', '.ets',
        '.cpp', '.h', '.c', '.hpp', '.cmake', '.md', '.json', '.json5', '.xml',
        '.css', '.html', '.txt', '.yaml', '.yml', '.properties', '.gradle',
        '.kt', '.m4', '.build', '.in', '.mk', '.am', '.pl', '.mips', '.unix',
        '.s', '.guess', '.sub', '.ac', '.toml', ''}
ANDROID_META = {'product.json', 'upstream-lock.json',
                'upstream-source-manifest.json', 'original-host.json',
                'candidate.json', 'candidate-source.json', 'test-results.json',
                'normal-voice-delivery-2026-10-22.json',
                'material-month-implementation-2026-10-22.json',
                'phone-month-ui-2026-10-22.json',
                'phone-month-dev2-install-2026-10-22.json'}


def walk(base):
    for directory, dirs, names in os.walk(ROOT / base, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in PRUNED and not (Path(directory) / d).is_symlink())
        for name in sorted(names):
            p = Path(directory) / name
            if p.is_symlink() or p.suffix.lower() in DENIED or name.startswith('.env') or name == 'local.properties':
                continue
            yield p


def paths():
    selected = {ROOT / name for name in ('.gitignore', '.gitattributes', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md')}
    for base in ('docs', 'tools/android', 'tools/phase1', 'tools/github',
                 'rebuild/agent-bridge', 'rebuild/material-server', 'rebuild/harmony-sdk'):
        for p in walk(base):
            rel = p.relative_to(ROOT).as_posix()
            # The Harmony project explicitly reserves this local signing file;
            # publish its tracked example even when the local copy is unsigned.
            if rel == 'rebuild/harmony-sdk/build-profile.json5':
                continue
            resource = '/src/main/resources/' in rel or '/AppScope/resources/' in rel
            if p.suffix.lower() in TEXT or p.suffix.lower() == '.svg' or resource and p.suffix.lower() in {'.png', '.jpg', '.webp'}:
                selected.add(p)
    for p in walk('rebuild/android-app/src'):
        if p.suffix == '.java':
            selected.add(p)
    app = ROOT / 'rebuild/android-app'
    for p in app.iterdir():
        if p.is_file() and (p.suffix in {'.py', '.mjs', '.md'} or p.name in ANDROID_META or p.name.endswith('-test-results.json')):
            selected.add(p)
    manifest = json.loads((app / 'upstream-source-manifest.json').read_text(encoding='utf-8-sig'))
    for item in manifest['files']:
        p = app / 'upstream' / item['path']
        if not p.resolve().is_relative_to((app / 'upstream').resolve()) or p.is_symlink():
            raise RuntimeError('UPSTREAM_PATH_INVALID')
        data = p.read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise RuntimeError('UPSTREAM_SOURCE_CHANGED')
        selected.add(p)
    for name in ('LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'):
        selected.add(app / 'upstream' / name)
    for name in ('README.md', 'offline-refactor-2026-10-10.md', 'build-windows.ps1', 'sign-windows.ps1'):
        selected.add(ROOT / 'rebuild' / name)
    tracked = subprocess.run(['git', 'ls-files', '-z', 'rebuild/core-probe/Vendor/opus-1.5.2'], cwd=ROOT, capture_output=True, check=True).stdout.decode().split('\0')
    selected.update(ROOT / f for f in tracked if f)
    for p in (ROOT / 'rebuild/phase1').iterdir():
        if p.is_file() and p.suffix in {'.ps1', '.mjs', '.md'}:
            selected.add(p)
    return sorted(selected, key=lambda p: p.relative_to(ROOT).as_posix())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    findings, inventory = [], []
    rules = {
        'provider_token': re.compile(rb'(?<![A-Za-z0-9_-])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})'),
        'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        'jwt_literal': re.compile(rb'eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}'),
        'credential_literal': re.compile(rb'''(?i)(?:password|passwd|access[_-]?token|api[_-]?key|secret[_-]?key)\s*[:=]\s*["']([^"'\r\n]{6,})["']'''),
        'lock_pin_literal': re.compile(rb'''(?i)(?:lockscreen|lock[_-]?pin|unlock[_-]?pin|screen[_-]?password)\s*[:=]\s*["']?[0-9]{4,8}\b'''),
    }
    for p in paths():
        rel = p.relative_to(ROOT).as_posix()
        if not p.is_file() or any(part in PRUNED for part in p.relative_to(ROOT).parts):
            raise RuntimeError('SNAPSHOT_PATH_INVALID')
        data = p.read_bytes()
        if len(data) > 25 * 1024 * 1024:
            raise RuntimeError('SNAPSHOT_FILE_BUDGET')
        inventory.append({'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        if p.suffix.lower() in TEXT or p.name in {'.gitignore', '.gitattributes', 'LICENSE', 'NOTICE'}:
            for name, pattern in rules.items():
                for match in pattern.finditer(data):
                    # A Java concatenation operand between two string literals
                    # is an expression, not a stored literal credential.
                    if name == 'credential_literal' and re.fullmatch(rb'\+[A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\])?\+', match.group(1)):
                        continue
                    findings.append({'path': rel, 'line': data.count(b'\n', 0, match.start()) + 1, 'rule': name})
    report = {'schema': 1, 'files': inventory, 'file_count': len(inventory),
              'bytes': sum(f['bytes'] for f in inventory), 'findings': findings,
              'private_directories_read': False, 'git_mutated': False, 'uploaded': False}
    (OUT / 'snapshot.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('file_count', 'bytes', 'findings', 'private_directories_read', 'git_mutated')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
