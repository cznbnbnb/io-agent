"""The observed execution seam is valid only for this inspected installation."""
from pathlib import Path
import subprocess
from runtime_journal import RuntimeJournalError

PIN = '08165d58931841cee713468ae89032af7c57060a'

def verify_source(source):
    source = Path(source).resolve(strict=True)
    try:
        head = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, check=True,
                              text=True, timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], capture_output=True, check=True,
                               text=True, timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout.strip()
        if head != PIN or dirty:
            raise ValueError()
    except Exception:
        raise RuntimeJournalError('RUNTIME_PIN_MISMATCH') from None
    return source
