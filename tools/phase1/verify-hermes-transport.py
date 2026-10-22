"""Record unit + installed-runtime stdio evidence; use prepared Hermes Python."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
verification = root / 'rebuild/agent-bridge/hermes/verification'
verification.mkdir(exist_ok=True)
unit = subprocess.run([sys.executable, '-I', '-S', '-B', '-c',
    "import runpy,sys; sys.path.insert(0, 'rebuild/agent-bridge/hermes'); runpy.run_path('rebuild/agent-bridge/hermes/test_acp_transport.py', run_name='__main__')"],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=30)
unit_log = unit.stdout + unit.stderr
(verification / 'unit-tests.log').write_text(unit_log, encoding='utf-8')
unit_count = re.search(r'Ran (\d+) tests', unit_log)
wire_path = root / 'rebuild/phase1/hermes-acp-wire-probe-2026-10-12.json'
wire_run = subprocess.run([sys.executable, '-I', '-S', '-B', str(root / 'tools/phase1/probe-hermes-acp-wire.py'),
    '--source', str(args.source), '--site-packages', str(args.site_packages), '--output', str(wire_path)],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=65)
(verification / 'wire-summary.log').write_text(wire_run.stdout, encoding='utf-8')
wire = json.loads(wire_path.read_text(encoding='utf-8')) if wire_path.is_file() else {}
passed = unit.returncode == 0 and unit_count is not None and wire_run.returncode == 0 and wire.get('passed') is True
project_files = ['rebuild/agent-bridge/hermes/acp_transport.py', 'rebuild/agent-bridge/hermes/process_job.py', 'rebuild/agent-bridge/hermes/test_acp_transport.py',
                 'tools/phase1/hermes-acp-wire-fixture.py', 'tools/phase1/probe-hermes-acp-wire.py', 'tools/phase1/verify-hermes-transport.py']
report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed' if passed else 'failed',
          'python': sys.version.split()[0], 'scope': 'real private SQLite for unit guards; installed official ACP SDK stdio + installed Hermes handlers in a child process, synthetic Agent body only',
          'unit_tests': int(unit_count[1]) if unit_count else 0, 'wire_checks': len(wire.get('checks', [])),
          'wire_passed': wire.get('passed', False), 'runtime_commit': wire.get('runtime_commit'),
          'not_verified': ['real provider/model', 'original CLI/TUI task route', 'owner fencing against external ACP writers',
                           'durable runtime event outbox', 'original suspended tool waitpoint after owner restart',
                           'task completion evidence beyond ACP stop_reason', 'production Agent permissions', 'bridge execution adapter or cloud/phone integration'],
          'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in project_files}}
(verification / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['status', 'unit_tests', 'wire_checks', 'wire_passed']}))
raise SystemExit(0 if passed else 1)
