import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createRemoteAdb, main, parseArgs, validTailscaleIP} from './remote-adb.mjs';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const CONFIG = {schema: 1, tailscale_ip: '100.64.10.20', port: 37001, expected_serial: 'synthetic-phone'};
const held = {state: 'held', owner: 'codex', until: new Date(NOW + 60000).toISOString(),
  purpose: 'private-account@example.invalid token=do-not-print'};
const ok = stdout => ({status: 0, stdout, stderr: ''});
function fixture(t, overrides = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'io-remote-adb-test-'));
  t.after(() => fs.rmSync(workspace, {recursive: true, force: true}));
  const directory = path.join(workspace, 'rebuild/android-app/.private/remote-debug');
  fs.mkdirSync(directory, {recursive: true});
  const file = path.join(directory, 'config.json');
  const config = {...CONFIG, ...overrides};
  fs.writeFileSync(file, JSON.stringify(config) + '\n', {mode: 0o600});
  const calls = [];
  const state = {lock: held, serial: config.expected_serial, tail: {BackendState: 'Running',
    User: {secret: {LoginName: 'private-account@example.invalid'}}, token: 'do-not-print'},
    connect: ok('connected'), exec: ok('requested result\n'), hook: null};
  const runner = (binary, args, options) => {
    calls.push({binary, args, options});
    if (state.hook) { const intercepted = state.hook(binary, args, options); if (intercepted) return intercepted; }
    if (binary === process.execPath) {
      assert.deepEqual(args, [path.join(workspace, 'tools/collab/device-lock.mjs'), 'status']);
      return ok(JSON.stringify(state.lock));
    }
    if (binary === config.tailscale_cli) {
      assert.deepEqual(args, ['status', '--json']);
      return ok(JSON.stringify(state.tail));
    }
    assert.equal(binary, path.join(workspace, 'rebuild/android-app/.tools/sdk/platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'));
    assert.deepEqual(args.slice(0, 4), ['-H', '127.0.0.1', '-P', '5037']);
    if (args[4] === 'connect') return state.connect;
    assert.equal(args[4], '-s');
    if (args.slice(6).join(' ') === 'shell getprop ro.serialno') return ok(state.serial + '\r\n');
    return state.exec;
  };
  const options = {workspace, run: runner, now: () => NOW};
  return {workspace, directory, file, config, calls, state, options,
    tool: createRemoteAdb(options), adbCalls: () => calls.filter(c => c.binary.endsWith('/adb') || c.binary.endsWith('\\adb.exe'))};
}
function throwsCode(fn, code) { assert.throws(fn, error => error.code === code); }

test('only canonical Tailscale IPv4 and bounded ports are accepted', () => {
  for (const ip of ['100.64.0.0', '100.100.1.2', '100.127.255.255']) assert.ok(validTailscaleIP(ip));
  for (const ip of ['100.63.255.255', '100.128.0.0', '192.168.1.1', '127.0.0.1', '100.064.1.1',
    '100.64.1.256', '100.64.1.2:5555', 'phone.ts.net', '100.64.1.2\n', '::1', null]) assert.equal(validTailscaleIP(ip), false);
  for (const port of ['0', '-1', '65536', '01', '1.5', '12;echo', '']) throwsCode(() => parseArgs(['connect', '--port', port]), 'USAGE');
});

test('status, connect and exec fail closed without a live Codex lock', t => {
  const f = fixture(t, {tailscale_cli: '/synthetic/tailscale'});
  for (const lock of [null, {state: 'free'}, {...held, owner: 'claude'}, {...held, until: new Date(NOW).toISOString()},
    {...held, until: 'invalid'}, {...held, state: 'free'}]) {
    f.state.lock = lock;
    for (const args of [['status'], ['connect'], ['exec', '--', 'shell', 'true']]) {
      f.calls.length = 0;
      throwsCode(() => f.tool.execute(args), 'DEVICE_LOCK_REQUIRED');
      assert.equal(f.calls.length, 1);
      assert.equal(f.adbCalls().length, 0);
    }
  }
});

test('malformed or failed lock status cannot authorize any device call', t => {
  const f = fixture(t);
  for (const response of [ok('not json'), {status: 1, stdout: JSON.stringify(held)}, {status: 0, signal: 'SIGTERM'}]) {
    f.state.hook = () => response;
    throwsCode(() => f.tool.execute(['status']), 'DEVICE_LOCK_UNAVAILABLE');
    assert.equal(f.adbCalls().length, 0);
  }
});

test('missing and malformed private configuration produce safe errors', t => {
  const f = fixture(t);
  for (const config of [{...CONFIG, tailscale_ip: '192.168.1.1'}, {...CONFIG, port: '37001'},
    {...CONFIG, schema: 2}, {...CONFIG, expected_serial: 'unknown'}, {...CONFIG, expected_serial: 'a\nb'},
    {...CONFIG, tailscale_cli: 'tailscale'}, {...CONFIG, token: 'do-not-print'}]) {
    fs.writeFileSync(f.file, JSON.stringify(config));
    throwsCode(() => f.tool.execute(['status']), 'CONFIG_INVALID');
  }
  fs.writeFileSync(f.file, '{"account":"private-account@example.invalid",');
  throwsCode(() => f.tool.execute(['status']), 'CONFIG_INVALID');
  fs.unlinkSync(f.file);
  throwsCode(() => f.tool.execute(['status']), 'CONFIG_MISSING');
  assert.equal(f.calls.length, 0);
});

test('status projects Tailscale state and verifies only the configured endpoint', t => {
  const f = fixture(t, {tailscale_cli: '/synthetic/tailscale'});
  const result = f.tool.execute(['status']);
  assert.deepEqual(result, {ok: true, command: 'status', endpoint: '100.64.10.20:37001',
    identity_verified: true, port_saved: false, tailscale: {checked: true, running: true}});
  assert.equal(f.adbCalls().length, 1);
  assert.deepEqual(f.adbCalls()[0].args.slice(4), ['-s', '100.64.10.20:37001', 'shell', 'getprop', 'ro.serialno']);
  assert.doesNotMatch(JSON.stringify(result), /account|do-not-print|synthetic-phone/);
});

test('Tailscale unavailable or logged out stops before adb without exposing its raw status', t => {
  const f = fixture(t, {tailscale_cli: '/synthetic/tailscale'});
  f.state.tail.BackendState = 'NeedsLogin';
  throwsCode(() => f.tool.execute(['connect']), 'TAILSCALE_NOT_RUNNING');
  assert.equal(f.adbCalls().length, 0);
  f.state.hook = binary => binary === f.config.tailscale_cli ? ok('secret invalid json') : undefined;
  throwsCode(() => f.tool.execute(['status']), 'TAILSCALE_UNAVAILABLE');
  assert.equal(f.adbCalls().length, 0);
});

test('connect saves a new port only after matching physical serial and writes mode 0600', t => {
  const f = fixture(t);
  const result = f.tool.execute(['connect', '--port', '44444']);
  assert.equal(result.port_saved, true);
  assert.deepEqual(f.adbCalls().map(c => c.args.slice(4)), [['connect', '100.64.10.20:44444'],
    ['-s', '100.64.10.20:44444', 'shell', 'getprop', 'ro.serialno']]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), {...CONFIG, port: 44444});
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(f.directory), ['config.json']);
});

test('failed connect, zero-exit failure text, wrong identity and expired lock never save the new port', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  f.state.connect = {status: 1, stdout: 'secret connect failure'};
  throwsCode(() => f.tool.execute(['connect', '--port', '44444']), 'REMOTE_CONNECT_FAILED');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  f.state.connect = ok('failed to connect');
  f.state.hook = (binary, args) => args.includes('ro.serialno') ? {status: 1, stderr: 'private details'} : undefined;
  throwsCode(() => f.tool.execute(['connect', '--port', '44444']), 'REMOTE_IDENTITY_UNAVAILABLE');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  f.state.hook = null;
  f.state.serial = 'wrong-phone';
  throwsCode(() => f.tool.execute(['connect', '--port', '44444']), 'REMOTE_IDENTITY_MISMATCH');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  f.state.serial = CONFIG.expected_serial;
  f.state.hook = (binary, args) => { if (args.includes('ro.serialno')) f.state.lock = {state: 'free'}; };
  throwsCode(() => f.tool.execute(['connect', '--port', '44444']), 'DEVICE_LOCK_REQUIRED');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('configuration changed during the network verification is not overwritten', t => {
  const f = fixture(t);
  const changed = {...CONFIG, port: 46000};
  f.state.hook = (binary, args) => { if (args.includes('ro.serialno')) fs.writeFileSync(f.file, JSON.stringify(changed)); };
  throwsCode(() => f.tool.execute(['connect', '--port', '44444']), 'CONFIG_CHANGED');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), changed);
  assert.deepEqual(fs.readdirSync(f.directory), ['config.json']);
});

test('exec rejects alternate targets and server/global commands before invoking any process', t => {
  const f = fixture(t);
  for (const args of [['-s', 'usb-phone', 'shell', 'true'], ['-d', 'shell', 'true'], ['-H', 'other', 'devices'],
    ['devices'], ['connect', '192.168.1.1:5555'], ['disconnect'], ['pair'], ['kill-server'], ['start-server'],
    ['forward', '--remove-all'], ['wait-for-device', '-s', 'other', 'shell', 'true'],
    ['root'], ['unroot'], ['remount'], ['tcpip', '5555'], ['usb']]) {
    throwsCode(() => f.tool.execute(['exec', '--', ...args]), 'COMMAND_NOT_SCOPED');
  }
  assert.equal(f.calls.length, 0);
});

test('exec checks identity then pins the command, uses no shell, and bounds its lifetime by the lock', t => {
  const f = fixture(t);
  const result = f.tool.execute(['exec', '--', 'shell', 'echo', '$(must-not-run)']);
  assert.equal(result.stdout, 'requested result\n');
  assert.equal(f.adbCalls().length, 2);
  assert.deepEqual(f.adbCalls()[1].args.slice(4), ['-s', '100.64.10.20:37001', 'shell', 'echo', '$(must-not-run)']);
  assert.equal(f.adbCalls()[1].options.shell, false);
  assert.ok(f.adbCalls()[1].options.timeout <= 60000);
  for (const key of ['ANDROID_SERIAL', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_PORT', 'ANDROID_ADB_SERVER_ADDRESS'])
    assert.equal(key in f.adbCalls()[1].options.env, false);
});

test('wrong identity or lock loss after identity stops exec without fallback', t => {
  const f = fixture(t);
  f.state.serial = 'wrong-device';
  throwsCode(() => f.tool.execute(['exec', '--', 'shell', 'true']), 'REMOTE_IDENTITY_MISMATCH');
  assert.equal(f.adbCalls().length, 1);
  f.calls.length = 0;
  f.state.serial = CONFIG.expected_serial;
  f.state.hook = (binary, args) => { if (args.includes('ro.serialno')) f.state.lock = {...held, owner: 'claude'}; };
  throwsCode(() => f.tool.execute(['exec', '--', 'shell', 'true']), 'DEVICE_LOCK_REQUIRED');
  assert.equal(f.adbCalls().length, 1);
});

test('CLI errors never include child errors, config, account, serial or lock purpose', t => {
  const f = fixture(t);
  f.state.hook = binary => { if (binary !== process.execPath) throw Error('private-account@example.invalid token=do-not-print'); };
  let stdout = '', stderr = '';
  const code = main(['status'], f.options, {stdout: {write: s => stdout += s}, stderr: {write: s => stderr += s}});
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.equal(JSON.parse(stderr).error, 'REMOTE_IDENTITY_UNAVAILABLE');
  assert.doesNotMatch(stderr, /private-account|do-not-print|synthetic-phone/);
});

test('exec-out preserves binary output such as PNG screenshots without JSON or UTF-8 conversion', t => {
  const f = fixture(t);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a]);
  f.state.exec = {status: 0, stdout: bytes, stderr: Buffer.alloc(0)};
  const output = [], errors = [];
  const code = main(['exec', '--', 'exec-out', 'screencap', '-p'], f.options,
    {stdout: {write: b => output.push(b)}, stderr: {write: b => errors.push(b)}});
  assert.equal(code, 0);
  assert.deepEqual(Buffer.concat(output), bytes);
  assert.equal(Buffer.concat(errors).length, 0);
  assert.equal(f.adbCalls()[1].options.encoding, null);
});

test('shared private root is supported but a config or nested-directory symlink is rejected', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  const privatePath = path.dirname(f.directory);
  const shared = path.join(f.workspace, 'shared-private');
  fs.renameSync(privatePath, shared);
  fs.symlinkSync(shared, privatePath, 'dir');
  assert.equal(f.tool.execute(['status']).identity_verified, true);
  const configPath = path.join(shared, 'remote-debug/config.json');
  const other = path.join(shared, 'other.json');
  fs.renameSync(configPath, other);
  fs.symlinkSync(other, configPath);
  throwsCode(() => f.tool.execute(['status']), 'CONFIG_PATH_UNSAFE');
  fs.unlinkSync(configPath);
  fs.renameSync(other, configPath);
  fs.renameSync(path.join(shared, 'remote-debug'), path.join(shared, 'other-directory'));
  fs.symlinkSync(path.join(shared, 'other-directory'), path.join(shared, 'remote-debug'), 'dir');
  throwsCode(() => f.tool.execute(['status']), 'CONFIG_PATH_UNSAFE');
});

test('real subprocess smoke uses only a temporary fake lock and fake SDK adb', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t);
  const lock = path.join(f.workspace, 'tools/collab/device-lock.mjs');
  const adb = path.join(f.workspace, 'rebuild/android-app/.tools/sdk/platform-tools/adb');
  fs.mkdirSync(path.dirname(lock), {recursive: true});
  fs.mkdirSync(path.dirname(adb), {recursive: true});
  fs.writeFileSync(lock, `process.stdout.write(JSON.stringify(${JSON.stringify(held)}));\n`);
  fs.writeFileSync(adb, `#!${process.execPath}\nconst a=process.argv.slice(2);if(a[0]!=='-H'||a[1]!=='127.0.0.1'||a[2]!=='-P'||a[3]!=='5037')process.exit(9);if(a[4]==='connect')console.log('connected');else if(a[4]==='-s'&&a[5]==='100.64.10.20:44444'&&a.slice(6).join(' ')==='shell getprop ro.serialno')console.log('synthetic-phone');else process.exit(8);\n`, {mode: 0o700});
  const result = createRemoteAdb({workspace: f.workspace, now: () => NOW}).execute(['connect', '--port', '44444']);
  assert.equal(result.identity_verified, true);
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).port, 44444);
});
