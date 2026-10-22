"""Real SQLite/child-process verification for the runtime-owned journal."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
output = root / 'rebuild/agent-bridge/hermes/verification'
output.mkdir(exist_ok=True)
result = subprocess.run([sys.executable, '-I', '-S', '-B', '-c',
    "import runpy,sys; sys.path.insert(0, 'rebuild/agent-bridge/hermes'); runpy.run_path('rebuild/agent-bridge/hermes/test_runtime_journal.py', run_name='__main__')"],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=45)
log = result.stdout + result.stderr
(output / 'journal-tests.log').write_text(log, encoding='utf-8')
count = re.search(r'Ran (\d+) tests', log)
files = ['rebuild/agent-bridge/hermes/runtime_journal.py', 'rebuild/agent-bridge/hermes/test_runtime_journal.py',
         'tools/phase1/verify-hermes-journal.py']
report = {'at': datetime.now(timezone.utc).isoformat(), 'python': sys.version.split()[0],
          'status': 'passed' if result.returncode == 0 and count is not None else 'failed',
          'tests': int(count[1]) if count else 0,
          'scope': 'real private SQLite, actual competing processes, actual claim worker hard exit; synthetic data only',
          'not_verified': ['real model or tools', 'Hermes owner fencing', 'bridge/ACP/MCP integration',
                           'original tool waitpoint recovery', 'production file ACLs or disk-loss durability',
                           'semantic truth of caller-provided completion evidence', 'retention/compaction or long-run capacity'],
          'source_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
(output / 'journal-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: report[key] for key in ['status', 'tests']}))
raise SystemExit(0 if report['status'] == 'passed' else 1)
