"""Pinned native Hermes mailbox, private synthetic inputs and real file receipts.

Never opens the installed user home or delivers to a real running Agent.
This probes storage/ownership components, not model execution or prompt routing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
args = p.parse_args()
source = args.source.resolve()
expected = '08165d58931841cee713468ae89032af7c57060a'
actual = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
dirty = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], capture_output=True, text=True, check=True).stdout.strip()
if actual != expected or dirty:
    raise SystemExit('RUNTIME_PIN_MISMATCH')
args.output.parent.mkdir(parents=True, exist_ok=True)
private_root = args.output.parent / 'runtime-home'
private_root.mkdir(exist_ok=True)
result = {'at': datetime.now(timezone.utc).isoformat(), 'runtime_commit': actual,
          'scope': 'installed mailbox + isolated real SessionDB/active-session lease + native file receipts; synthetic messages only; separate claim worker exits before completion; no live TUI, model, tools or user state',
          'network': 'blocked', 'checks': [], 'passed': False,
          'source_sha256': {name: hashlib.sha256((source/name).read_bytes()).hexdigest() for name in [
              'tools/bot_live_delivery.py', 'hermes_cli/active_sessions.py',
              'tui_gateway/session_notifications.py', 'tui_gateway/session_auto_continue.py',
              'website/docs/developer-guide/cron-internals.md']}}

def deny(*_args, **_kwargs):
    raise RuntimeError('PROBE_NETWORK_BLOCKED')

socket.socket.connect = deny
socket.create_connection = deny
sys.dont_write_bytecode = True
sys.path[:0] = [str(source), str(args.site_packages.resolve())]

def check(name, **details):
    result['checks'].append({'case': name, 'passed': True, **details})

def refuses(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError('EXPECTED_REFUSAL')

with tempfile.TemporaryDirectory(prefix='p42-mailbox-', dir=private_root) as temporary:
    home = Path(temporary).resolve()
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1')
    db = lease = None
    try:
        from hermes_state import SessionDB
        from hermes_cli.active_sessions import try_acquire_active_session
        from tools.bot_live_delivery import (
            find_canonical_live_owner, deliver_to_live_owner, claim_pending_delivery,
            complete_delivery, cancel_queued_delivery, read_delivery_result)

        db = SessionDB(home / 'state.db')
        db.create_session(session_id='synthetic-session', source='cli')
        assert db.set_session_title('synthetic-session', 'Synthetic original task')
        lease, refusal = try_acquire_active_session(
            session_id='synthetic-session', surface='synthetic-probe', config={},
            metadata={'bot_live_delivery_consumer': True, 'live_session_id': 'synthetic-live'},
            registry_home=home)
        assert lease is not None and refusal is None
        assert find_canonical_live_owner(home) is None
        assert db.set_session_title('synthetic-session', 'Bot Chat')
        owner = find_canonical_live_owner(home)
        assert owner and owner['session_id'] == 'synthetic-session' and owner['lease_id'] == lease.lease_id
        check('canonical_discovery_requires_bot_chat_title', arbitrary_original_task_route=False)

        key = '1' * 32
        original = deliver_to_live_owner(home, owner, 'synthetic one', delivery_id=key)
        assert original['status'] == 'queued'
        assert deliver_to_live_owner(home, owner, 'synthetic one', delivery_id=key) == original
        refuses(lambda: deliver_to_live_owner(home, owner, 'different', delivery_id=key))
        refuses(lambda: deliver_to_live_owner(home, {**owner, 'lease_id': 'another'}, 'synthetic one', delivery_id=key))
        assert read_delivery_result(home, key) == original
        check('admission_replay_stable_and_conflicting_payload_or_owner_refused')

        second = deliver_to_live_owner(home, owner, 'synthetic two', delivery_id='2' * 32)
        assert second['sequence'] > original['sequence']
        assert claim_pending_delivery(home, {**owner, 'lease_id': 'new-owner'}) is None
        assert claim_pending_delivery(home, owner)['delivery_id'] == key
        assert claim_pending_delivery(home, owner)['delivery_id'] == second['delivery_id']
        assert claim_pending_delivery(home, owner) is None
        check('fifo_claims_once_and_new_lease_cannot_steal_old_inputs')

        assert cancel_queued_delivery(home, key, error='synthetic cancel', reason='cancelled')['status'] == 'claimed'
        settled = complete_delivery(home, key, status='settled', reply='synthetic reply')
        assert complete_delivery(home, key, status='settled', reply='synthetic reply') == settled
        refuses(lambda: complete_delivery(home, key, status='settled', reply='changed reply'))
        check('claimed_cancel_does_not_cancel_running_turn_and_terminal_receipt_is_immutable', running_cancel_supported_by_this_api=False)

        queued_key = '3' * 32
        deliver_to_live_owner(home, owner, 'synthetic cancel before claim', delivery_id=queued_key)
        assert cancel_queued_delivery(home, queued_key, error='synthetic cancel', reason='cancelled')['status'] == 'cancelled'
        assert claim_pending_delivery(home, owner) is None
        check('queued_cancel_persists_and_prevents_claim')

        crash_key = '4' * 32
        deliver_to_live_owner(home, owner, 'synthetic interrupted claim', delivery_id=crash_key)
        child_code = '''import json, os, socket, sys
from pathlib import Path
sys.path[:0] = sys.argv[1:3]
def deny(*a, **k): raise RuntimeError('PROBE_NETWORK_BLOCKED')
socket.socket.connect = deny
socket.create_connection = deny
from tools.bot_live_delivery import claim_pending_delivery
record = claim_pending_delivery(Path(sys.argv[3]), json.loads(sys.argv[4]))
os._exit(73 if record and record['delivery_id'] == sys.argv[5] else 74)
'''
        child = subprocess.run([sys.executable, '-I', '-S', '-B', '-c', child_code,
                                str(source), str(args.site_packages.resolve()), str(home), json.dumps(owner), crash_key],
                               capture_output=True, timeout=20)
        assert child.returncode == 73
        assert read_delivery_result(home, crash_key)['status'] == 'claimed'
        assert claim_pending_delivery(home, owner) is None
        assert deliver_to_live_owner(home, owner, 'synthetic interrupted claim', delivery_id=crash_key)['status'] == 'claimed'
        check('actual_claim_worker_exit_keeps_unknown_claim_and_prevents_redelivery',
              automatic_original_task_recovery=False)
        lease.release()
        assert find_canonical_live_owner(home) is None
        check('released_owner_is_not_discovered_as_live')
        result['passed'] = True
    except Exception as error:
        result['error_type'] = type(error).__name__
    finally:
        if lease is not None:
            lease.release()
        if db is not None:
            db.close()
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': result['passed'], 'checks': len(result['checks']), 'error_type': result.get('error_type')}))
raise SystemExit(0 if result['passed'] else 1)
