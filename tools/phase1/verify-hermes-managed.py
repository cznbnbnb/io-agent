"""Record managed scheduler regressions and real local ACP/MCP queue integration."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
output = root/'rebuild/agent-bridge/hermes/verification'
unit = subprocess.run([sys.executable,'-I','-S','-B','-c',
    "import sys,unittest; sys.path.insert(0,'rebuild/agent-bridge/hermes'); result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('rebuild/agent-bridge/hermes',pattern='test_runtime_scheduler.py')); sys.exit(not result.wasSuccessful())"],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=25)
log = unit.stdout+unit.stderr
(output/'managed-tests.log').write_text(log,encoding='utf-8')
count = re.search(r'Ran (\d+) tests',log)
native = subprocess.run(['D:/openclaw/nodejs/node.exe',str(root/'tools/phase1/verify-hermes-runtime.mjs'),'--python',sys.executable],
    cwd=root, capture_output=True, encoding='utf-8', errors='replace', timeout=90)
(output/'managed-wire-summary.log').write_text(native.stdout+native.stderr,encoding='utf-8')
wire = json.loads((root/'rebuild/phase1/hermes-managed-runtime-2026-10-12.json').read_text(encoding='utf-8'))
passed = unit.returncode==0 and count is not None and native.returncode==0 and wire['passed'] is True
report = {'at':datetime.now(timezone.utc).isoformat(),'status':'passed' if passed else 'failed',
    'unit_tests':int(count[1]) if count else 0,'local_integration_checks':len(wire['checks']),
    'scope':wire['scope']+'; fake-runner state cases and real independent managed-home owner hard kill',
    'not_verified':wire['not_verified'],'source_sha256':wire.get('source_sha256',{})}
(output/'managed-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:report[key] for key in ['status','unit_tests','local_integration_checks']}))
raise SystemExit(0 if passed else 1)
