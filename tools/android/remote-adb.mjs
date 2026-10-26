#!/usr/bin/env node
// Only this explicit Tailscale endpoint is used; USB and adb auto-discovery are never fallbacks.
// Private config: {schema:1,tailscale_ip:"100.64.1.2",port:12345,
//                  expected_serial:"physical-device-serial",tailscale_cli:"/absolute/path"}
// Usage: remote-adb.mjs status | connect [--port PORT] | exec -- shell getprop ro.product.model
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = 'rebuild/android-app/.private/remote-debug/config.json';
const DEVICE_COMMANDS = new Set(['shell', 'exec-out', 'exec-in', 'push', 'pull', 'install',
  'install-multiple', 'install-multi-package', 'uninstall', 'logcat', 'bugreport',
  'get-state', 'get-serialno', 'get-devpath', 'reboot']);
const MESSAGES = {
  USAGE: '用法：status | connect [--port PORT] | exec -- <设备 adb 子命令及参数>。',
  CONFIG_MISSING: `缺少私有配置 ${CONFIG}；请先登记已核验的手机 IP、连接端口和序列号。`,
  CONFIG_INVALID: '私有配置无效：需要 schema=1、Tailscale IPv4、端口和预期手机序列号。',
  CONFIG_PATH_UNSAFE: '配置文件或 remote-debug 目录不能是符号链接。共享 .private 根可以是链接。',
  CONFIG_CHANGED: '验证期间配置发生变化，未保存端口；请重新核对后重试。',
  CONFIG_SAVE_FAILED: '端口保存失败；未报告为已保存。',
  DEVICE_LOCK_REQUIRED: '需要本代理（codex 或 claude）持有且尚未到期的设备锁；本工具不会自动抢锁。',
  DEVICE_LOCK_UNAVAILABLE: '无法核对设备锁，已停止设备操作。',
  TAILSCALE_UNAVAILABLE: '无法读取 Tailscale 状态，请在本机客户端检查登录和连接。',
  TAILSCALE_NOT_RUNNING: 'Tailscale 尚未运行，请在本机客户端完成登录和连接。',
  REMOTE_CONNECT_FAILED: '指定远程端点未确认连接；请核对手机当前无线调试连接端口。',
  REMOTE_IDENTITY_UNAVAILABLE: '无法读取指定远程端点的手机序列号；未执行后续命令。',
  REMOTE_IDENTITY_MISMATCH: '远程端点的手机序列号不匹配；未执行后续命令或保存端口。',
  COMMAND_NOT_SCOPED: '仅支持明确作用于指定设备的 adb 子命令；不能覆盖目标或管理全局 adb server。',
  REMOTE_EXEC_FAILED: '远程命令失败或超过设备锁允许的时间。',
  INTERNAL_ERROR: '远程调试工具失败；未输出原始异常或私有配置。',
};
class RemoteError extends Error {
  constructor(code) { super(MESSAGES[code]); this.code = code; }
}
const fail = code => { throw new RemoteError(code); };
const good = r => r && !r.error && !r.signal && r.status === 0;

export function validTailscaleIP(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts.every(p => p <= 255) && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
function validPort(value) { return Number.isInteger(value) && value >= 1 && value <= 65535; }
function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.schema !== 1 ||
      Object.keys(config).some(k => !['schema', 'tailscale_ip', 'port', 'expected_serial', 'tailscale_cli'].includes(k)) ||
      !validTailscaleIP(config.tailscale_ip) || !validPort(config.port) ||
      typeof config.expected_serial !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(config.expected_serial) ||
      /^(?:unknown|null|undefined|0)$/i.test(config.expected_serial) ||
      (config.tailscale_cli !== undefined && (typeof config.tailscale_cli !== 'string' ||
        !path.isAbsolute(config.tailscale_cli) || /[\x00-\x1f]/.test(config.tailscale_cli)))) fail('CONFIG_INVALID');
  return config;
}
export function parseArgs(args) {
  if (args.length === 1 && args[0] === 'status') return {command: 'status'};
  if (args[0] === 'connect' && args.length === 1) return {command: 'connect'};
  if (args[0] === 'connect' && args.length === 3 && args[1] === '--port' &&
      /^[1-9]\d{0,4}$/.test(args[2]) && validPort(Number(args[2]))) return {command: 'connect', port: Number(args[2])};
  if (args[0] === 'exec' && args[1] === '--' && args.length > 2) {
    const adbArgs = args.slice(2);
    if (!DEVICE_COMMANDS.has(adbArgs[0]) || adbArgs.some(s => typeof s !== 'string' || s.includes('\0'))) fail('COMMAND_NOT_SCOPED');
    return {command: 'exec', adbArgs};
  }
  fail('USAGE');
}
function childEnvironment() {
  const env = {...process.env};
  for (const key of ['ANDROID_SERIAL', 'ADB_SERVER_SOCKET', 'ADB_SERVER_PORT', 'ANDROID_ADB_SERVER_PORT',
    'ANDROID_ADB_SERVER_ADDRESS']) delete env[key];
  return env;
}

// Dependency injection exists for offline tests only; no CLI flags or environment variables
// can replace the lock script, config location, SDK adb binary, or expected device identity.
// The lock must belong to the agent running this tool (Claude took over device work on 2026-10-24).
export function createRemoteAdb({workspace = WORKSPACE, run = spawnSync, now = Date.now, agent = 'codex'} = {}) {
  const configFile = path.join(workspace, CONFIG);
  const adb = path.join(workspace, 'rebuild/android-app/.tools/sdk/platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  const lockScript = path.join(workspace, 'tools/collab/device-lock.mjs');
  function processCall(binary, args, timeout = 10000, maxBuffer = 1024 * 1024, encoding = 'utf8') {
    try { return run(binary, args, {cwd: workspace, encoding, timeout, maxBuffer,
      windowsHide: true, shell: false, env: childEnvironment(), stdio: ['inherit', 'pipe', 'pipe']}); }
    catch { return {status: null, error: true}; }
  }
  function lock() {
    const result = processCall(process.execPath, [lockScript, 'status']);
    if (!good(result)) fail('DEVICE_LOCK_UNAVAILABLE');
    let value;
    try { value = JSON.parse(result.stdout); } catch { fail('DEVICE_LOCK_UNAVAILABLE'); }
    if (value?.state !== 'held' || value.owner !== agent || typeof value.until !== 'string' ||
        !Number.isFinite(Date.parse(value.until)) || Date.parse(value.until) <= now() + 100) fail('DEVICE_LOCK_REQUIRED');
    return Date.parse(value.until);
  }
  function configPath() {
    try {
      const privateRoot = fs.realpathSync(path.dirname(path.dirname(configFile)));
      const directory = path.join(privateRoot, 'remote-debug');
      const file = path.join(directory, 'config.json');
      if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink() ||
          !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) fail('CONFIG_PATH_UNSAFE');
      return file;
    } catch (e) {
      if (e instanceof RemoteError) throw e;
      if (e.code === 'ENOENT') fail('CONFIG_MISSING');
      fail('CONFIG_PATH_UNSAFE');
    }
  }
  function load() {
    const file = configPath();
    let text;
    try {
      const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        if (fs.fstatSync(fd).size > 16384) fail('CONFIG_INVALID');
        text = fs.readFileSync(fd, 'utf8');
      } finally { fs.closeSync(fd); }
    } catch (e) { if (e instanceof RemoteError) throw e; fail('CONFIG_PATH_UNSAFE'); }
    let config;
    try { config = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { fail('CONFIG_INVALID'); }
    return {file, text, config: validateConfig(config)};
  }
  function savePort(original, port) {
    lock();
    const current = load();
    if (current.file !== original.file || current.text !== original.text) fail('CONFIG_CHANGED');
    const temp = `${original.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({...original.config, port}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      // An independently updated config must not be overwritten after the network round trip.
      const latest = load();
      if (latest.file !== original.file || latest.text !== original.text) fail('CONFIG_CHANGED');
      fs.renameSync(temp, original.file);
    } catch (e) { if (e instanceof RemoteError) throw e; fail('CONFIG_SAVE_FAILED'); }
    finally { try { fs.unlinkSync(temp); } catch {} }
  }
  function adbCall(args, code, maximum = 15000, raw = false) {
    const until = lock();
    const timeout = Math.max(1, Math.min(maximum, until - now() - 100));
    const result = processCall(adb, ['-H', '127.0.0.1', '-P', '5037', ...args], timeout, 16 * 1024 * 1024, raw ? null : 'utf8');
    if (!good(result)) fail(code);
    return result;
  }
  function identity(endpoint, config) {
    const result = adbCall(['-s', endpoint, 'shell', 'getprop', 'ro.serialno'], 'REMOTE_IDENTITY_UNAVAILABLE');
    if (String(result.stdout).trim() !== config.expected_serial) fail('REMOTE_IDENTITY_MISMATCH');
  }
  function tailscale(config) {
    if (!config.tailscale_cli) return {checked: false};
    lock();
    const result = processCall(config.tailscale_cli, ['status', '--json']);
    if (!good(result)) fail('TAILSCALE_UNAVAILABLE');
    let value;
    try { value = JSON.parse(result.stdout); } catch { fail('TAILSCALE_UNAVAILABLE'); }
    if (value?.BackendState !== 'Running') fail('TAILSCALE_NOT_RUNNING');
    // Never print the raw status, which contains account names, emails, and peer metadata.
    return {checked: true, running: true};
  }
  return {
    execute(args) {
      const request = parseArgs(args);
      const original = load();
      lock(); // Includes status: no device or Tailscale process is called without a live Codex lock.
      const config = original.config;
      const endpoint = `${config.tailscale_ip}:${request.port ?? config.port}`;
      const tunnel = tailscale(config);
      if (request.command === 'connect') {
        // adb connect sometimes exits zero while printing a connection error; identity is decisive.
        adbCall(['connect', endpoint], 'REMOTE_CONNECT_FAILED');
      }
      identity(endpoint, config);
      if (request.command === 'exec') {
        const result = adbCall(['-s', endpoint, ...request.adbArgs], 'REMOTE_EXEC_FAILED', 300000, true);
        // Only explicit caller-requested adb output is passed through; preflight output is private.
        return {command: 'exec', stdout: result.stdout || '', stderr: result.stderr || ''};
      }
      if (request.port !== undefined) savePort(original, request.port);
      return {ok: true, command: request.command, endpoint, identity_verified: true,
        port_saved: request.port !== undefined, tailscale: tunnel};
    },
  };
}

export function main(args, options = {}, io = process) {
  try {
    const result = createRemoteAdb(options).execute(args);
    if (result.command === 'exec') {
      io.stdout.write(result.stdout);
      io.stderr.write(result.stderr);
    } else io.stdout.write(JSON.stringify(result) + '\n');
    return 0;
  } catch (e) {
    const code = e instanceof RemoteError ? e.code : 'INTERNAL_ERROR';
    io.stderr.write(JSON.stringify({ok: false, error: code, message: MESSAGES[code]}) + '\n');
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = process.env.CODEX_THREAD_ID ? 'codex' : process.env.CLAUDE_CODE_SESSION_ID ? 'claude' : 'codex';
  process.exitCode = main(process.argv.slice(2), {agent});
}
