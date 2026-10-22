"""Dependency bootstrap for scoped MCP tools; the only argv value is a path."""
from pathlib import Path
import os
import sys

packages = Path(sys.argv[1]).resolve(strict=True)
sys.path[:0] = [str(Path(__file__).resolve().parent), str(packages), str(packages/'win32'), str(packages/'win32/lib')]
dll = os.add_dll_directory(str(packages/'pywin32_system32')) if os.name == 'nt' else None
from question_tools import main
raise SystemExit(main())
