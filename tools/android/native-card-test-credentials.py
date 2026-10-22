"""One 15-minute synthetic credential for the authorized native-card transport check.

It publishes and answers only its isolated synthetic owner's test question. No Agent is started.
"""
import importlib.util
from pathlib import Path
source = Path(__file__).resolve().parents[1] / 'phase1/cloud-test-credentials.py'
spec = importlib.util.spec_from_file_location('native_card_cloud_credentials', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.ROLES = {'phone': list(module.ROLES['phone']) + ['requests:write']}
if __name__ == '__main__':
    raise SystemExit(module.main())
