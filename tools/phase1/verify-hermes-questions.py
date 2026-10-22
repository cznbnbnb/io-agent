"""Record journal/question regression and actual installed MCP stdio evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--site-packages', type=Path, required=True)
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
output = root/'rebuild/agent-bridge/hermes/verification'
output.mkdir(exist_ok=True)
unit = subprocess.run([sys.executable, '-I', '-S', '-B', '-c',
    "import sys,unittest; sys.path.insert(0,'rebuild/agent-bridge/hermes'); loader=unittest.defaultTestLoader; suite=loader.discover('rebuild/agent-bridge/hermes',pattern='test_runtime_journal.py'); suite.addTests(loader.discover('rebuild/agent-bridge/hermes',pattern='test_question_tools.py')); result=unittest.TextTestRunner(verbosity=2).run(suite); sys.exit(not result.wasSuccessful())"],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=40)
log = unit.stdout + unit.stderr
(output/'question-tests.log').write_text(log, encoding='utf-8')
count = re.search(r'Ran (\d+) tests', log)
wire_path = root/'rebuild/phase1/hermes-question-mcp-probe-2026-10-12.json'
wire_run = subprocess.run([sys.executable, '-I', '-S', '-B', str(root/'tools/phase1/probe-hermes-question-mcp.py'),
    '--site-packages', str(args.site_packages.resolve()), '--output', str(wire_path)],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=55)
(output/'question-wire-summary.log').write_text(wire_run.stdout + wire_run.stderr, encoding='utf-8')
wire = json.loads(wire_path.read_text(encoding='utf-8')) if wire_path.exists() else {}
passed = unit.returncode == 0 and count is not None and wire_run.returncode == 0 and wire.get('passed') is True
files = ['rebuild/agent-bridge/hermes/runtime_journal.py', 'rebuild/agent-bridge/hermes/question_tools.py',
         'rebuild/agent-bridge/hermes/test_runtime_journal.py', 'rebuild/agent-bridge/hermes/test_question_tools.py',
         'tools/phase1/probe-hermes-question-mcp.py', 'tools/phase1/verify-hermes-questions.py']
report = {'at': datetime.now(timezone.utc).isoformat(), 'python': sys.version.split()[0],
          'status': 'passed' if passed else 'failed', 'unit_tests': int(count[1]) if count else 0,
          'wire_checks': len(wire.get('checks', [])), 'wire_passed': wire.get('passed', False),
          'scope': 'private real SQLite with competing/crashed workers; real MCP SDK and stdio tool subprocess; synthetic data only',
          'not_verified': wire.get('not_verified', []) + ['production ACLs, retention/capacity, power-loss durability'],
          'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
(output/'question-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['status', 'unit_tests', 'wire_checks', 'wire_passed']}))
raise SystemExit(0 if passed else 1)
