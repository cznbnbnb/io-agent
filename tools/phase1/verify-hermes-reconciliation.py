"""Record isolated SQLite/CLI guards and actual ACP child-crash queue recovery."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root=Path(__file__).resolve().parents[2]
output=root/'rebuild/agent-bridge/hermes/verification'
unit=subprocess.run([sys.executable,'-I','-S','-B','-X','utf8','-c',
    "import sys,unittest; sys.path.insert(0,'rebuild/agent-bridge/hermes'); result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('rebuild/agent-bridge/hermes',pattern='test_reconciliation.py')); sys.exit(not result.wasSuccessful())"],
    cwd=root,capture_output=True,encoding='utf-8',errors='replace',timeout=30)
log=unit.stdout+unit.stderr
(output/'reconciliation-tests.log').write_text(log,encoding='utf-8')
count=re.search(r'Ran (\d+) tests',log)
wire=subprocess.run(['D:/openclaw/nodejs/node.exe',str(root/'tools/phase1/verify-hermes-runtime.mjs'),
    '--python',sys.executable,'--with-reconciliation'],cwd=root,capture_output=True,
    encoding='utf-8',errors='replace',timeout=110)
(output/'reconciliation-wire-summary.log').write_text(wire.stdout+wire.stderr,encoding='utf-8')
integration=json.loads((root/'rebuild/phase1/hermes-managed-reconciliation-runtime-2026-10-12.json').read_text(encoding='utf-8'))
passed=unit.returncode==0 and count is not None and wire.returncode==0 and integration['passed'] is True
files=['rebuild/agent-bridge/hermes/test_reconciliation.py','tools/phase1/verify-hermes-reconciliation.py']
report={'at':datetime.now(timezone.utc).isoformat(),'status':'passed' if passed else 'failed',
        'unit_tests':int(count[1]) if count else 0,'local_integration_checks':len(integration['checks']),
        'scope':integration['scope']+'; read-only review and synthetic operator attestation, actual ACP process crash',
        'not_verified':integration['not_verified']+['real human adjudication or real external task side effects'],
        'source_sha256':integration.get('source_sha256',{}) |
            {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
(output/'reconciliation-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:report[key] for key in ['status','unit_tests','local_integration_checks']}))
raise SystemExit(0 if passed else 1)
