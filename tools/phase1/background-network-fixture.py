"""Finite loopback-only diagnostic fixture; no user content or production services."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import argparse
import json
import time

ROOT = Path(__file__).resolve().parents[2] / 'rebuild' / 'phase1'
parser = argparse.ArgumentParser()
parser.add_argument('--recovery', action='store_true')
args = parser.parse_args()
started = time.monotonic()
events = []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path != '/p12':
            self.send_error(404)
            return
        # 25–50 s deliberately fails, to test restoration without changing phone settings.
        elapsed = time.monotonic() - started
        code = 503 if not args.recovery and 25 <= elapsed < 50 else 200
        events.append({'elapsed_s': round(elapsed, 3), 'status': code})
        ROOT.joinpath('device-background-network-fixture-recovery.json' if args.recovery else 'device-background-network-fixture.json').write_text(
            json.dumps({'kind': 'loopback_http_fixture', 'events': events}, indent=2), encoding='utf-8')
        body = f'p12-local-fixture:{len(events)}'.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

server = HTTPServer(('127.0.0.1', 18765), Handler)
server.timeout = 1
print('Loopback fixture ready, 150-second automatic expiry', flush=True)
while time.monotonic() - started < 150:
    server.handle_request()
server.server_close()
print('Loopback fixture stopped', flush=True)
