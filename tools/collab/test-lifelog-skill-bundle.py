"""Check the complete vendored v4 skill and its offline helper; never access live data."""
import argparse
import ast
import copy
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / 'rebuild/agent-bridge/skills/cz-lifelog-correct'
PREFIX = 'rebuild/agent-bridge/skills/cz-lifelog-correct/'
EXPECTED = {
    'SKILL.md', 'scripts/lifelog_review.py', 'agents/openai.yaml',
    'references/workbuddy-handoff.md', 'references/style-guide.md',
    'references/cli-and-writeback.md', 'references/evidence-rules.md',
    'references/workbuddy-0700.txt', 'references/event-review.md',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Also check a built portable CLI archive.')
    parser.add_argument('--source-dir', type=Path, help='Optionally compare every original source file.')
    args = parser.parse_args()
    bundle = json.loads((SKILL / 'BUNDLE.json').read_text())
    assert bundle['format'] == 'cz-lifelog-correct-bundle/1'
    assert bundle['name'] == 'cz-lifelog-correct' and bundle['version'] == 4
    assert bundle['entrypoint'] == 'SKILL.md' and bundle['helper'] == 'scripts/lifelog_review.py'
    assert set(bundle['files']) == set(bundle['source_files']) == EXPECTED
    assert bundle['adaptations'] == ['references/workbuddy-handoff.md']
    actual = {p.relative_to(SKILL).as_posix() for p in SKILL.rglob('*') if p.is_file()}
    assert actual == EXPECTED | {'BUNDLE.json'}, 'Unexpected or missing bundle member'
    for name, digest in bundle['files'].items():
        body = (SKILL / name).read_bytes()
        assert hashlib.sha256(body).hexdigest() == digest, name
        if name not in bundle['adaptations']:
            assert digest == bundle['source_files'][name], 'Original v4 rules changed: ' + name
        if args.source_dir:
            source = (args.source_dir / name).read_bytes()
            assert hashlib.sha256(source).hexdigest() == bundle['source_files'][name], name
            if name not in bundle['adaptations']:
                assert source == body, name
        if name.endswith(('.md', '.txt', '.py', '.yaml')):
            text = body.decode('utf-8')
            assert not re.search(r'/Users/|/home/[A-Za-z0-9_-]+/|[A-Z]:\\(?:Users|Documents)\\', text), name
            if name.endswith('.md'):
                for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
                    if '://' not in link and not link.startswith('#'):
                        target = (SKILL / name).parent / link.split('#', 1)[0]
                        target.resolve().relative_to(SKILL.resolve())
                        assert target.is_file(), 'Missing referenced file: ' + link
    assert 'version: "4"' in (SKILL / 'SKILL.md').read_text()
    helper = SKILL / bundle['helper']
    modules = set()
    for node in ast.walk(ast.parse(helper.read_text(), feature_version=(3, 10))):
        if isinstance(node, ast.Import):
            modules.update(n.name.split('.')[0] for n in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.add(node.module.split('.')[0])
    assert modules == {'argparse', 'copy', 'hashlib', 'json', 'datetime', 'pathlib'}
    compile(helper.read_text(), str(helper), 'exec')

    with tempfile.TemporaryDirectory(prefix='cz-lifelog-v4-bundle-') as temporary:
        directory = Path(temporary)
        script = helper
        if args.archive:
            with zipfile.ZipFile(args.archive) as archive:
                manifest = json.loads(archive.read('cz-iot-cli/MANIFEST.json'))
                for name in EXPECTED | {'BUNDLE.json'}:
                    relative = PREFIX + name
                    body = archive.read('cz-iot-cli/' + relative)
                    assert body == (SKILL / name).read_bytes(), relative
                    assert hashlib.sha256(body).hexdigest() == manifest['files'][relative]
                    destination = directory / 'extracted' / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(body)
                script = directory / 'extracted' / bundle['helper']

        def run(*arguments, accepted=True):
            result = subprocess.run([sys.executable, '-I', '-S', '-B', str(script), *map(str, arguments)],
                                    cwd=directory, capture_output=True, encoding='utf-8', timeout=15)
            assert (result.returncode == 0) == accepted, result.stderr or result.stdout
            return result

        assert run('--version').stdout.strip() == 'cz-lifelog-correct v4'
        day = json.loads(run('date', '--now', '2026-11-14T23:00:00-08:00').stdout)
        assert day['date'] == '2026-11-14' and day['timezone'] == 'Asia/Shanghai'
        assert day['context_end'] == '2026-11-15T15:00:00+08:00'
        before = {'complete': True, 'has_more': False, 'items': [{
            'material_id': 'synthetic-summary', 'date': '2026-11-14', 'timezone': 'Asia/Shanghai',
            'kind': 'summary', 'revision': 1, 'correction_revision': 0,
            'dependencies_version': 'synthetic-dependencies', 'summary_stale': False,
            'needs_review': False, 'blocks': [{'id': 'summary', 'text': '你验证了两批样机。'}],
        }]}
        before_file = directory / 'before.json'
        before_file.write_text(json.dumps(before, ensure_ascii=False), encoding='utf-8')
        read_dir = directory / 'read'
        prepared = json.loads(run('prepare', '--snapshot', before_file, '--out', read_dir).stdout)
        assert prepared['materials'] == 1
        assert json.loads((read_dir / 'events.json').read_text()) == {}
        decisions = json.loads((read_dir / 'decisions.json').read_text())
        assert decisions[0]['status'] == 'pending' and 'summary#1' in decisions[0]['fact_review']
        run('prepare', '--snapshot', before_file, '--out', read_dir, accepted=False)
        plan = {'material_id': 'synthetic-summary', 'source_revision': 1, 'correction_revision': 0,
                'dependencies_version': 'synthetic-dependencies', 'agent': 'Synthetic QA',
                'reason': 'Synthetic firsthand reply states only one batch.',
                'evidence': ['Synthetic reply: 我只验证了一批样机。'],
                'edits': [{'block_id': 'summary', 'before': '你验证了两批样机。', 'text': '你验证了一批样机。'}]}
        plan_file = directory / 'plan.json'
        plan_file.write_text(json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        decisions[0].update(status='corrected', reason=plan['reason'],
                            fact_review={'summary#1': {'checks': [{
                                'text': '你验证了一批样机', 'event': 'sample-review', 'use': 'focus',
                                'sources': [{'ref': 'Synthetic reply', 'quote': '我只验证了一批样机。'}],
                            }]}})
        decision_file = read_dir / 'decisions.json'
        decision_file.write_text(json.dumps(decisions, ensure_ascii=False), encoding='utf-8')
        events = {'sample-review': {'scene': 'Synthetic device verification', 'relation': 'background',
                                   'sources': [{'ref': 'Synthetic reply', 'quote': '我只验证了一批样机。'}]}}
        event_file = read_dir / 'events.json'
        event_file.write_text(json.dumps(events, ensure_ascii=False), encoding='utf-8')
        request_dir = directory / 'requests'
        request_dir.mkdir()
        request_file = request_dir / 'summary.json'
        command = ('request', '--snapshot', before_file, '--plan', plan_file,
                   '--decisions', decision_file, '--out', request_file)
        rejected = run(*command, accepted=False)
        assert 'cannot anchor personal actions or focus' in rejected.stderr
        assert not request_file.exists()
        events['sample-review']['relation'] = 'own'
        event_file.write_text(json.dumps(events, ensure_ascii=False), encoding='utf-8')
        request = json.loads(run(*command).stdout)
        assert request['network_write_performed'] is False
        assert json.loads(run(*command).stdout)['request_id'] == request['request_id']
        after = copy.deepcopy(before)
        after['items'][0]['blocks'][0]['text'] = '你验证了一批样机。'
        after['items'][0]['correction_revision'] = 1
        after_file = directory / 'after.json'
        after_file.write_text(json.dumps(after, ensure_ascii=False), encoding='utf-8')
        report = json.loads(run('verify', '--before', before_file, '--after', after_file,
                                '--requests', request_dir, '--decisions', decision_file,
                                '--out', directory / 'audit.json', '--ledger-out', directory / 'ledger.json').stdout)
        assert report['verified'] and report['review_version'] == 4
        assert report['semantic_accuracy_machine_verified'] is False
        assert report['materials_written'] == report['claims_with_source_quotes'] == 1
    print(json.dumps({'passed': True, 'skill': bundle['name'], 'version': bundle['version'],
                      'original_files': len(EXPECTED), 'unchanged_rule_files': len(EXPECTED) - 1,
                      'portable_standard_library_only': True, 'archive_checked': bool(args.archive),
                      'source_checked': bool(args.source_dir), 'live_data_accessed': False}))


if __name__ == '__main__':
    main()
