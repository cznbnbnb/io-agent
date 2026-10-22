"""Unauthenticated, read-only reachability check for the deployed iO endpoint."""
import json
import socket
import ssl
from datetime import datetime, timezone
from pathlib import Path

domain = "cznbnb.cn"
address = "43.142.59.131"
result = {"at": datetime.now(timezone.utc).isoformat(), "host": domain,
          "address": address, "scope": "local computer direct TCP and verified TLS; no credentials or writes", "tcp": {}}
for port in (22, 80, 443):
    try:
        with socket.create_connection((address, port), timeout=3):
            result["tcp"][str(port)] = "connected"
    except OSError as exc:
        result["tcp"][str(port)] = type(exc).__name__
try:
    with socket.create_connection((address, 443), timeout=3) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname=domain) as connection:
            connection.sendall(b"GET /io-api/v1/identity HTTP/1.1\r\nHost: cznbnb.cn\r\nConnection: close\r\n\r\n")
            header = b""
            while b"\r\n\r\n" not in header and len(header) < 16384:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                header += chunk
            result["https"] = {"certificate_verified": True, "protocol": connection.version(),
                               "status_line": header.split(b"\r\n", 1)[0].decode("ascii", "replace")}
except (OSError, ssl.SSLError) as exc:
    result["https"] = {"certificate_verified": False, "error": type(exc).__name__}
result["interpretation"] = "Timeout alone does not identify a specific cloud firewall rule. Server-local TLS evidence is separate."
destination = Path(__file__).resolve().parents[2] / "rebuild/phase1/server-review-reachability-2026-10-12.json"
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
