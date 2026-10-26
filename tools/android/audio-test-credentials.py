"""Explicit short-lived synthetic original-audio scopes; never a user grant."""
import importlib.util
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'phase1/cloud-test-credentials.py'
spec = importlib.util.spec_from_file_location('audio_cloud_credentials', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.ROLES = {'phone': ['materials:write', 'audio:write', 'audio:read'],
                'reader': ['materials:read', 'changes:read', 'audio:read'],
                'text': ['materials:write']}
if __name__ == '__main__':
    raise SystemExit(module.main())
