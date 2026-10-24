"""Offline controller/real SQLite and file tests; no SSH, HTTP or server access."""
import base64
import contextlib
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid
from email.message import Message

TOOLS = Path(__file__).resolve().parent


class FormalConnectionTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('formal_controller_test', TOOLS / 'prepare-formal-material-connection.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.parent = Path(tempfile.gettempdir()).resolve()
        self.root = Path(tempfile.mkdtemp(prefix='fmc-test-', dir=self.parent)).resolve()
        self.addCleanup(self.cleanup)
        (self.root / 'rebuild/phase1').mkdir(parents=True)
        (self.root / 'rebuild/material-server/private').mkdir(parents=True)
        self.module.ROOT = self.root
        self.remote = {'__name__': 'formal_remote_offline'}
        exec(self.module.REMOTE_SOURCE, self.remote)
        self.db = self.root / 'synthetic.sqlite'
        self.remote['DB'] = self.db
        self.remote['RUN_PARENT'] = self.root / 'remote-formal'
        self.directory_syncs = []
        self.remote['sync_dir'] = lambda path: self.directory_syncs.append(Path(path))
        self.mints = []
        self.fail_role = None
        self.lose_reply_role = None
        self.mint_delay_ms = {}
        self.remote['command'] = self.command
        with sqlite3.connect(self.db) as db:
            db.executescript('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);'
                'CREATE TABLE credentials(token_id TEXT PRIMARY KEY,digest TEXT UNIQUE,owner TEXT,producer TEXT,scopes TEXT,expires INTEGER,revoked INTEGER DEFAULT 0);'
                'CREATE TABLE user_data(value TEXT); PRAGMA user_version=2;')
            db.executemany('INSERT INTO meta VALUES (?,?)', [('server_id', self.module.SERVER), ('cursor_secret', 'synthetic-cursor-secret')])
            db.execute('INSERT INTO user_data VALUES (?)', ('synthetic existing material must remain',))
            for role, definition in self.module.ROLES.items():
                token = base64.urlsafe_b64encode(hashlib.sha256(('old-' + role).encode()).digest()).decode().rstrip('=')
                db.execute('INSERT INTO credentials VALUES (?,?,?,?,?,?,?)', (str(uuid.uuid4()), hashlib.sha256(token.encode()).hexdigest(),
                    self.module.OWNER, definition['producer_id'], json.dumps(definition['scopes']), int(time.time() * 1000) - 1000, 0))

    def cleanup(self):
        if self.root.parent != self.parent or not self.root.name.startswith('fmc-test-') or self.root.is_symlink():
            raise ValueError('TEST_CLEANUP_OUT_OF_SCOPE')
        shutil.rmtree(self.root)

    def command(self, args):
        if args == ['systemctl', 'is-active', 'turboio-material.service']:
            return 'active'
        self.assertEqual(args[:3], [self.remote['NODE'], self.remote['CLI'], 'mint'])
        options = dict(zip(args[3::2], args[4::2]))
        self.assertEqual(set(options), {'--db', '--owner', '--producer', '--scopes', '--ttl-ms', '--out'})
        self.assertEqual(options['--db'], str(self.db));self.assertEqual(options['--owner'], self.module.OWNER)
        self.assertEqual(options['--ttl-ms'], '86400000')
        role = next(role for role, value in self.module.ROLES.items() if value['producer_id'] == options['--producer'])
        self.assertEqual(options['--scopes'], ','.join(self.module.ROLES[role]['scopes']))
        target = Path(options['--out'])
        self.assertEqual(target.parent.parent, self.remote['RUN_PARENT']);self.assertEqual(target.name, role + '.json')
        self.mints.append((role, list(args)))
        if role == self.fail_role:
            raise TimeoutError('synthetic secret command error must not escape')
        token = base64.urlsafe_b64encode(hashlib.sha256(('mint-' + str(len(self.mints)) + role).encode()).digest()).decode().rstrip('=')
        value = {'token': token, 'token_id': str(uuid.uuid4()),
                 'expires_at': self.remote['utc'](int(time.time() * 1000) + self.mint_delay_ms.get(role, 0) + self.module.TTL_MS)}
        # The real CLI reserves O_EXCL before inserting the credential; mimic
        # that ordering against a real local SQLite DB, without launching Node.
        fd = self.remote['os'].open(target, self.remote['os'].O_CREAT | self.remote['os'].O_EXCL | self.remote['os'].O_WRONLY, 0o600)
        try:
            with sqlite3.connect(self.db) as db:
                db.execute('INSERT INTO credentials VALUES (?,?,?,?,?,?,?)', (value['token_id'], hashlib.sha256(token.encode()).hexdigest(),
                    self.module.OWNER, options['--producer'], json.dumps(self.module.ROLES[role]['scopes']), self.module.expiry_ms(value['expires_at']), 0))
            with self.remote['os'].fdopen(fd, 'w', encoding='utf-8') as output:
                fd = None
                output.write(json.dumps(value));output.flush();self.remote['os'].fsync(output.fileno())
        finally:
            if fd is not None:
                self.remote['os'].close(fd)
        if role == self.lose_reply_role:
            raise TimeoutError('synthetic lost mint reply')
        return json.dumps({key: value[key] for key in ['token_id', 'expires_at']})

    def execute(self, mode, run='synthetic-run'):
        return self.remote['run_remote']({'mode': mode, 'run_id': run})

    def invoke(self, mode=None, execute=None):
        class Connection:
            closed = False
            def close(self): self.closed = True
        connection = Connection();calls=[];protected=[]
        def remote(connection, action, run):
            calls.append(action)
            return execute(action, run) if execute else self.execute(action, run)
        output = io.StringIO()
        with patch.object(self.module, 'connect', return_value=connection), patch.object(self.module, 'remote', side_effect=remote), \
             patch.object(self.module, 'protect_directory', side_effect=lambda directory: protected.append(directory)), \
             patch.object(self.module, 'verify_identity', side_effect=self.verified), contextlib.redirect_stdout(output):
            status = self.module.main(['--run-id', 'synthetic-run'] + ([mode] if mode else []))
        report = json.loads((self.root / 'rebuild/phase1/formal-material-connection-synthetic-run.json').read_text(encoding='utf-8'))
        if calls:
            self.assertTrue(connection.closed)
        return status, report, output.getvalue(), calls, protected

    def verified(self, opener, role, value):
        self.module.credential(value)
        return {'owner_id': self.module.OWNER, 'producer_id': self.module.ROLES[role]['producer_id'], 'server_id': self.module.SERVER,
                'token_id': value['token_id'], 'expires_at': value['expires_at'], 'scopes': self.module.ROLES[role]['scopes'],
                'material_schema_versions': ['1.0', '1.1', '1.2'], 'http_status': 200}

    def test_openssh_pins_host_and_captures_output(self):
        expected = self.execute('inspect')
        response = type('Response', (), {'returncode': 0, 'stdout': json.dumps(expected).encode(), 'stderr': b'private diagnostic'})()
        with patch.object(self.module.subprocess, 'run', return_value=response) as run:
            actual = self.module.remote('openssh', 'inspect', 'synthetic-run')
        self.assertEqual(actual, expected)
        argv = run.call_args.args[0]
        self.assertIn('StrictHostKeyChecking=yes', argv)
        self.assertIn('BatchMode=yes', argv)
        self.assertEqual(argv[-1], 'sudo -n /usr/bin/python3 -')
        self.assertTrue(run.call_args.kwargs['capture_output'])
        self.assertIn(b"'mode': 'inspect'", run.call_args.kwargs['input'])

    def test_openssh_failure_does_not_print_stderr(self):
        response = type('Response', (), {'returncode': 1, 'stdout': b'', 'stderr': b'synthetic secret'})()
        with patch.object(self.module.subprocess, 'run', return_value=response), contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(ValueError, 'REMOTE_RESULT_NOT_CONFIRMED'):
                self.module.remote('openssh', 'inspect', 'synthetic-run')
        self.assertEqual(output.getvalue(), '')

    def test_default_inspection_never_mints_reads_bearers_or_creates_private_run(self):
        before = self.db.read_bytes()
        with patch.dict(self.remote, {'read_json': lambda *args: self.fail('inspect must not open a credential file')}):
            result = self.execute('inspect')
        self.assertEqual(result['status'], 'inspected');self.assertNotIn('credentials', result)
        self.assertEqual(result['metadata']['existing_role_counts'], {'phone': 1, 'reader': 1})
        self.assertEqual(before, self.db.read_bytes());self.assertFalse(self.remote['RUN_PARENT'].exists());self.assertEqual(self.mints, [])
        status, report, output, calls, protected = self.invoke()
        self.assertEqual(status, 0);self.assertEqual(calls, ['inspect']);self.assertEqual(protected, [])
        self.assertEqual(report['status'], 'inspected');self.assertNotIn('"token":', json.dumps(report))

    def test_issue_is_single_run_exclusive_with_exact_scopes_and_durable_role_events(self):
        result = self.execute('issue');self.assertEqual(result['status'], 'issued');self.assertEqual(len(self.mints), 2)
        self.assertEqual(result['journal']['issued_roles'], ['phone', 'reader']);self.assertTrue(result['journal']['complete_record'])
        root = self.remote['RUN_PARENT'] / 'synthetic-run'
        self.assertEqual({file.name for file in root.iterdir()}, {'manifest.json', 'phone-intent.json', 'phone.json', 'phone-issued.json',
            'reader-intent.json', 'reader.json', 'reader-issued.json', 'complete.json'})
        self.assertGreaterEqual(len(self.directory_syncs), 8)
        duplicate = self.execute('issue');self.assertEqual(duplicate['error'], 'REMOTE_RUN_EXISTS_USE_RECOVER');self.assertEqual(len(self.mints), 2)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM credentials').fetchone()[0], 4)
            self.assertEqual(db.execute('SELECT value FROM user_data').fetchall(), [('synthetic existing material must remain',)])
            self.assertEqual(db.execute('SELECT SUM(revoked) FROM credentials').fetchone()[0], 0)

    def test_recover_reads_same_credentials_without_mint_or_remote_file_changes(self):
        issued = self.execute('issue');root = self.remote['RUN_PARENT'] / 'synthetic-run'
        files = {file.name: file.read_bytes() for file in root.iterdir()};database = self.db.read_bytes()
        recovered = self.execute('recover')
        self.assertEqual(recovered['status'], 'recovered');self.assertEqual(recovered['credentials'], issued['credentials'])
        self.assertEqual(len(self.mints), 2);self.assertFalse(recovered['issuance_started'])
        self.assertEqual(files, {file.name: file.read_bytes() for file in root.iterdir()});self.assertEqual(database, self.db.read_bytes())
        with patch.dict(self.remote, {'read_credential': lambda *args: self.fail('inspect must not read bearer')}):
            self.assertEqual(self.execute('inspect')['status'], 'inspected')

    def test_reader_issued_61_seconds_later_still_recovers_without_another_mint(self):
        # Simulate elapsed issuance time, not a longer CLI TTL. DB, digest and
        # returned exact expiry still agree; no wall-clock sleep is necessary.
        self.mint_delay_ms['reader'] = 61000
        issued = self.execute('issue')
        self.assertEqual(issued['status'], 'issued')
        root = self.remote['RUN_PARENT'] / 'synthetic-run'
        files = {file.name: file.read_bytes() for file in root.iterdir()}
        recovered = self.execute('recover')
        self.assertEqual(recovered['status'], 'recovered');self.assertEqual(recovered['credentials'], issued['credentials'])
        self.assertEqual(len(self.mints), 2);self.assertEqual(files, {file.name: file.read_bytes() for file in root.iterdir()})

    def test_partial_issue_and_lost_mint_reply_are_not_reissued_by_recovery(self):
        self.fail_role = 'reader'
        partial = self.execute('issue');self.assertEqual(partial['status'], 'partial');self.assertEqual(set(partial['credentials']), {'phone'})
        self.assertEqual(partial['error'], 'REMOTE_MINT_FAILED')
        recovered = self.execute('recover');self.assertEqual(recovered['status'], 'partial');self.assertEqual(set(recovered['credentials']), {'phone'})
        self.assertEqual(len(self.mints), 2)
        self.assertEqual(self.execute('issue')['error'], 'REMOTE_RUN_EXISTS_USE_RECOVER');self.assertEqual(len(self.mints), 2)
        self.fail_role = None;self.lose_reply_role = 'phone'
        lost = self.execute('issue', 'synthetic-lost');self.assertEqual(lost['error'], 'REMOTE_MINT_FAILED')
        recovered = self.execute('recover', 'synthetic-lost');self.assertEqual(set(recovered['credentials']), {'phone'})
        self.assertEqual(recovered['journal']['intent_roles'], ['phone']);self.assertEqual(recovered['journal']['issued_roles'], [])
        self.assertEqual(len(self.mints), 3)

    def test_wrong_database_identity_schema_or_missing_formal_producer_blocks_mint(self):
        for statement in ["UPDATE meta SET value='other-server' WHERE key='server_id'", 'PRAGMA user_version=1',
                          "DELETE FROM credentials WHERE producer='pc-query'"]:
            with sqlite3.connect(self.db) as db:
                db.execute(statement)
            result = self.execute('issue')
            self.assertEqual(result['status'], 'failed');self.assertIn(result['error'], {'REMOTE_DATABASE_MISMATCH', 'REMOTE_EXISTING_ROLE_MISSING'})
            self.assertEqual(self.mints, []);self.assertFalse(self.remote['RUN_PARENT'].exists())
            # Restore only this local fixture to try the next independent guard.
            with sqlite3.connect(self.db) as db:
                db.execute('UPDATE meta SET value=? WHERE key=?', (self.module.SERVER, 'server_id'));db.execute('PRAGMA user_version=2')

    def test_controller_ready_writes_only_private_bearers_and_exact_phone_package(self):
        status, report, output, calls, protected = self.invoke('--issue')
        self.assertEqual(status, 0);self.assertEqual(report['status'], 'ready');self.assertEqual(calls, ['inspect', 'issue']);self.assertEqual(len(protected), 1)
        private = self.root / 'rebuild/material-server/private/formal-synthetic-run'
        phone = json.loads((private / 'phone.json').read_text());reader = json.loads((private / 'reader.json').read_text())
        pack = json.loads((private / 'connection.json').read_text());query = json.loads((private / 'query-config.json').read_text())
        self.assertEqual(set(pack), {'format', 'base_url', 'owner_id', 'producer_id', 'server_id', 'token', 'token_id', 'expires_at'})
        self.assertEqual(pack['token'], phone['token']);self.assertEqual(pack['owner_id'], self.module.OWNER);self.assertEqual(pack['producer_id'], 'phone-harmony')
        self.assertNotIn('enabled', pack);self.assertEqual(query['credential_file'], 'reader.json');self.assertEqual(query['producer_id'], 'pc-query')
        for token in [phone['token'], reader['token']]:
            self.assertNotIn(token, output);self.assertNotIn(token, json.dumps(report))
        self.assertEqual(report['material_requests_sent'], 0)

    def test_lost_issue_envelope_requires_explicit_recover_and_never_mints_twice(self):
        def lose(action, run):
            result = self.execute(action, run)
            if action == 'issue': raise TimeoutError('private-synthetic-SSH-response')
            return result
        status, report, output, calls, _ = self.invoke('--issue', lose)
        self.assertEqual(status, 1);self.assertEqual(report['status'], 'issue_observation_unknown');self.assertEqual(len(self.mints), 2)
        self.assertEqual(calls, ['inspect', 'issue']);self.assertNotIn('private-synthetic', output)
        status, report, _, calls, _ = self.invoke('--issue')
        self.assertEqual(status, 1);self.assertEqual(calls, []);self.assertEqual(report['error'], 'LOCAL_RUN_EXISTS_USE_RECOVER')
        status, report, _, calls, _ = self.invoke('--recover')
        self.assertEqual(status, 0);self.assertEqual(report['status'], 'ready');self.assertEqual(calls, ['inspect', 'recover']);self.assertEqual(len(self.mints), 2)

    def test_existing_private_files_are_verified_never_overwritten(self):
        self.invoke('--issue')
        file = self.root / 'rebuild/material-server/private/formal-synthetic-run/phone.json'
        original = file.read_bytes();value = json.loads(original);value['token'] = 'z' * 43
        file.write_text(json.dumps(value), encoding='utf-8');changed = file.read_bytes()
        status, report, _, calls, _ = self.invoke('--recover')
        self.assertEqual(status, 1);self.assertEqual(report['error'], 'LOCAL_PRIVATE_FILE_CONFLICT');self.assertEqual(file.read_bytes(), changed)
        self.assertEqual(calls, ['inspect', 'recover']);self.assertEqual(len(self.mints), 2)

    def test_public_identity_get_is_bounded_and_checks_real_scopes_expiry_and_schema(self):
        result = self.execute('issue');value = result['credentials']['phone'];requests = []
        identity = {'schema_version': '1.0', 'owner_id': self.module.OWNER, 'producer_id': 'phone-harmony', 'server_id': self.module.SERVER,
                    'scopes': ['materials:write'], 'expires_at': value['expires_at'], 'material_schema_versions': ['1.0', '1.1', '1.2']}
        class Response:
            status = 200
            headers = Message()
            headers['Content-Type'] = 'application/json; charset=utf-8'
            def __init__(self, data): self.data = data
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, length):
                self.length = length
                return self.data[:length]
        class Opener:
            def __init__(self, data): self.data = data
            def open(self, request, timeout):
                requests.append(request);self.response = Response(self.data);return self.response
        opener = Opener(json.dumps(identity).encode())
        observed = self.module.verify_identity(opener, 'phone', value)
        self.assertEqual(observed['http_status'], 200);self.assertEqual(opener.response.length, 16385)
        self.assertEqual(requests[0].get_method(), 'GET');self.assertEqual(requests[0].full_url, self.module.BASE + 'identity')
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer ' + value['token'])
        for change in [{'owner_id': 'other-owner'}, {'producer_id': 'other-phone'}, {'server_id': 'other-server'},
                       {'scopes': ['materials:read']}, {'scopes': [{}]}, {'expires_at': '2000-01-01T00:00:00.000Z'},
                       {'material_schema_versions': ['1.1']}, {'material_schema_versions': ['1.2', '2'*43+'.0']}]:
            with self.assertRaises(ValueError):
                self.module.verify_identity(Opener(json.dumps({**identity, **change}).encode()), 'phone', value)
        with self.assertRaisesRegex(ValueError, '^PUBLIC_IDENTITY_INVALID$'):
            self.module.verify_identity(Opener(b' ' * 16385), 'phone', value)
        with self.assertRaisesRegex(ValueError, '^PUBLIC_REDIRECT_REFUSED$'):
            self.module.NoRedirect().redirect_request(None, None, None, None, None, None)

    def test_ssh_transport_uses_fixed_argv_and_captured_secret_stdout_only(self):
        result = self.execute('issue')
        class Channel:
            ended = False
            def shutdown_write(self): self.ended = True
            def recv_exit_status(self): return 0
        class Input(io.StringIO):
            channel = Channel()
        class Output(io.BytesIO):
            channel = Channel()
        class Connection:
            def exec_command(self, command, timeout):
                self.command = command;self.stdin = Input();self.output = Output(json.dumps(result).encode())
                return self.stdin, self.output, Output(b'private-synthetic-stderr discarded')
        connection = Connection()
        captured = self.module.remote(connection, 'issue', 'synthetic-run')
        self.assertEqual(connection.command, 'sudo -n /usr/bin/python3 -');self.assertTrue(connection.stdin.channel.ended)
        self.assertEqual(captured['credentials'], result['credentials'])
        for value in result['credentials'].values():
            self.assertNotIn(value['token'], connection.command);self.assertNotIn(value['token'], connection.stdin.getvalue())
        public = json.dumps(self.module.public_remote(captured))
        for value in result['credentials'].values(): self.assertNotIn(value['token'], public)

    def android(self, mode, run='synthetic-android'):
        self.module.PLATFORM = 'android'
        self.module.ROLES = {'phone': {'producer_id': 'phone-android', 'scopes': ['materials:write']},
                             'reader': {'producer_id': 'pc-query', 'scopes': ['materials:read', 'changes:read']}}
        return self.remote['run_remote']({'mode': mode, 'run_id': run, 'platform': 'android'})

    def test_android_first_enrollment_preserves_harmony_and_recovers_same_credentials(self):
        with sqlite3.connect(self.db) as db:
            original = db.execute("SELECT * FROM credentials WHERE producer='phone-harmony'").fetchall()
        inspected = self.android('inspect')
        self.assertEqual(inspected['status'], 'inspected')
        self.assertEqual(inspected['metadata']['existing_role_counts']['phone'], 0)
        self.assertEqual(self.module.public_remote(inspected)['status'], 'inspected')
        issued = self.android('issue')
        self.assertEqual(issued['status'], 'issued')
        self.assertEqual(issued['roles']['phone']['producer_id'], 'phone-android')
        recovered = self.android('recover')
        self.assertEqual(recovered['credentials'], issued['credentials'])
        self.assertEqual(len(self.mints), 2)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT * FROM credentials WHERE producer='phone-harmony'").fetchall(), original)
            self.assertEqual(db.execute('SELECT value FROM user_data').fetchone()[0], 'synthetic existing material must remain')
        wrong_platform = self.remote['run_remote']({'mode': 'recover', 'run_id': 'synthetic-android'})
        self.assertEqual(wrong_platform['status'], 'failed')
        self.assertEqual(wrong_platform['error'], 'REMOTE_MANIFEST_INVALID')

    def test_android_missing_original_anchor_refuses_new_identity(self):
        with sqlite3.connect(self.db) as db:
            db.execute("DELETE FROM credentials WHERE producer='phone-harmony'")
        result = self.android('issue')
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error'], 'REMOTE_EXISTING_ROLE_MISSING')
        self.assertEqual(self.mints, [])
        self.assertFalse((self.remote['RUN_PARENT'] / 'synthetic-android').exists())

    def test_unknown_platform_refused_before_preflight_or_mint(self):
        with self.assertRaisesRegex(ValueError, '^REMOTE_OPERATION_FAILED$'):
            self.remote['run_remote']({'mode': 'issue', 'run_id': 'synthetic-android', 'platform': 'arbitrary'})
        self.assertEqual(self.mints, [])

    def test_invalid_run_is_refused_before_any_connection_or_file_operation(self):
        with patch.object(self.module, 'connect', side_effect=AssertionError('must not connect')), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(self.module.main(['--issue', '--run-id', '../synthetic-path']), 1)
        self.assertEqual(json.loads(output.getvalue())['error'], 'RUN_ID_INVALID')
        self.assertEqual(list((self.root / 'rebuild/phase1').iterdir()), [])


if __name__ == '__main__':
    unittest.main()
