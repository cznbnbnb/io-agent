"""Reuse the existing isolated one-hour issuer for a current-caller check.

Only this test's agent gets tasks:write to publish its already-running caller's
task mirror. It has no access to the user's owner or other identities.
"""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'phase1/cloud-test-credentials.py'
spec = importlib.util.spec_from_file_location('caller_cloud_credentials', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.ROLES = {name: list(scopes) for name, scopes in module.ROLES.items()}
module.ROLES['agent'].append('tasks:write')

if __name__ == '__main__':
    raise SystemExit(module.main())
