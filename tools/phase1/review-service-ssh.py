"""Read-only audit of the existing deployment using the user's existing helper."""
import contextlib
import io
import json
import runpy
from datetime import datetime, timezone
from pathlib import Path

destination = Path(__file__).resolve().parents[2] / "rebuild/phase1/server-review-ssh-2026-10-12.json"
result = {"at": datetime.now(timezone.utc).isoformat(), "scope": "read-only SSH deployment audit; no tokens or database rows read"}
connection = None
class QuietStream(io.StringIO):
    def reconfigure(self, **_kwargs):
        pass
try:
    # Keep credentials inside the existing private helper, never in argv/output.
    with contextlib.redirect_stdout(QuietStream()), contextlib.redirect_stderr(QuietStream()):
        helper = runpy.run_path("D:/Project/Kimi_Agent_手持娱乐值网站/app/.deploy/ssh.py", run_name="turboio_readonly_review")
    profiles = [profile for profile in helper["PROFILES"].values() if profile.get("host") == "43.142.59.131"]
    if len(profiles) != 1:
        raise ValueError("WRONG_HOST")
    helper["connect"].__globals__["P"] = profiles[0]
    connection = helper["connect"]()
    commands = {
        "service_state": "systemctl is-active turboio-material.service",
        "service_enabled": "systemctl is-enabled turboio-material.service",
        "local_health": "curl --silent --max-time 5 http://127.0.0.1:3401/health",
        "local_tls_unauthenticated_status": "curl --silent --max-time 5 --resolve cznbnb.cn:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://cznbnb.cn/io-api/v1/identity",
        "service_code_sha256": "sha256sum /opt/turboio/rebuild/material-server/cli.mjs /opt/turboio/rebuild/material-server/http.mjs /opt/turboio/rebuild/material-server/json.mjs /opt/turboio/rebuild/material-server/store.mjs /opt/turboio/rebuild/material-server/validation.mjs",
    }
    result["checks"] = {}
    for name, command in commands.items():
        _stdin, stdout, stderr = connection.exec_command(command, timeout=15)
        data = stdout.read(16384).decode("utf-8", "replace").strip()
        stderr.read(4096)  # Do not include remote errors/paths in evidence logs.
        result["checks"][name] = {"exit_code": stdout.channel.recv_exit_status(), "result": data}
except Exception as exc:
    result["error"] = type(exc).__name__
finally:
    if connection is not None:
        connection.close()
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
