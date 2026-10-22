"""Installed ACP/MCP integration and actual Windows child-tree containment."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
output = root/'rebuild/agent-bridge/hermes/verification'
output.mkdir(exist_ok=True)
unit = subprocess.run([sys.executable, '-I', '-S', '-B', '-c',
    "import sys,runpy; sys.path.insert(0,'rebuild/agent-bridge/hermes'); runpy.run_path('rebuild/agent-bridge/hermes/test_process_job.py',run_name='__main__')"],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=30)
log = unit.stdout + unit.stderr
(output/'process-job-tests.log').write_text(log, encoding='utf-8')
count = re.search(r'Ran (\d+) tests', log)
reports, runs = [], []
for mode in ['default', 'off']:
    path = root/f'rebuild/phase1/hermes-acp-question-{mode}-probe-2026-10-12.json'
    result = subprocess.run([sys.executable, '-I', '-S', '-B', str(root/'tools/phase1/probe-hermes-acp-questions.py'),
        '--source', str(args.source.resolve()), '--site-packages', str(args.site_packages.resolve()),
        '--tool-search', mode, '--output', str(path)], cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=80)
    (output/f'acp-question-{mode}-summary.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    reports.append(json.loads(path.read_text(encoding='utf-8')) if path.exists() else {})
    runs.append(result.returncode)
passed = unit.returncode == 0 and count is not None and all(code == 0 for code in runs) and all(report.get('passed') is True for report in reports)
files = ['rebuild/agent-bridge/hermes/acp_transport.py', 'rebuild/agent-bridge/hermes/process_job.py',
         'rebuild/agent-bridge/hermes/test_process_job.py', 'tools/phase1/hermes-acp-question-fixture.py',
         'tools/phase1/probe-hermes-acp-questions.py', 'tools/phase1/verify-hermes-acp-questions.py']
report = {'at': datetime.now(timezone.utc).isoformat(), 'python': sys.version.split()[0],
          'status': 'passed' if passed else 'failed', 'process_job_tests': int(count[1]) if count else 0,
          'runtime_commit': reports[0].get('runtime_commit'),
          'integration_modes': [{'tool_search': item.get('tool_search'), 'dispatch_mode': item.get('dispatch_mode'),
                                 'passed': item.get('passed', False), 'checks': len(item.get('checks', []))} for item in reports],
          'scope': 'actual pinned Hermes ACP/MCP/model-tools dispatch; synthetic conversation body and queue-shaped answer; actual Windows job hard-owner-exit and descendant handle waits',
          'not_verified': reports[0].get('not_verified', []) + ['full bridge execution adapter or global runtime/session lease', 'atomic pre-spawn containment of arbitrary launcher children'],
          'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
(output/'acp-question-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['status', 'process_job_tests', 'integration_modes']}))
raise SystemExit(0 if passed else 1)
