// Register the agent caller executing this command (Codex, Claude Code, ...), using an isolated test owner.
// Credential issuance is separate. No replacement Agent session is launched.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {BridgeClient, readPrivateJson} from '../../rebuild/agent-bridge/client.mjs';
import {caller, callerBase} from '../../rebuild/agent-bridge/questions/cli.mjs';
import {privatePath} from '../../rebuild/agent-bridge/questions/private-path.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireValue = (value, code) => { if (!value) throw Error(code); };
const writeOnce = (file, value) => {
  if (fs.existsSync(file)) {
    requireValue(JSON.stringify(readPrivateJson(file)) === JSON.stringify(value), 'CALLER_PREPARATION_CONFLICT');
    return;
  }
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
};

async function main() {
  const args = process.argv.slice(2);
  // Optional --topic: a one-line conversation topic shown on the phone task list and the prompter header.
  requireValue((args.length === 4 || args.length === 6 && args[4] === '--topic') && args[0] === '--run-id' && args[2] === '--python', 'CALLER_PREPARATION_ARGUMENT_INVALID');
  const topic = args[5];
  const runId = args[1], python = args[3], current = caller(), {runtime, session} = current;
  requireValue(/^caller[0-9]{3}-[a-z0-9-]{1,40}$/.test(runId), 'CALLER_PREPARATION_SCOPE_INVALID');
  requireValue(!current.error, current.error);
  requireValue(fs.realpathSync(process.cwd()) === fs.realpathSync(workspace), 'CALLER_PROJECT_MISMATCH');
  requireValue(path.isAbsolute(python) && fs.statSync(python).isFile(), 'CALLER_PYTHON_REQUIRED');
  const probe = spawnSync(python, ['-I', '-S', '-B', '-c', 'import sqlite3,sys;print(sys.version_info >= (3,10))'], {encoding:'utf8',timeout:5000});
  requireValue(probe.status === 0 && probe.stdout.trim() === 'True', 'CALLER_PYTHON_UNSUPPORTED');

  const privateRoot = path.join(workspace, 'rebuild/agent-bridge/private');
  const run = privatePath(privateRoot, path.join(privateRoot, 'cloud-' + runId), {directory:true, code:'CALLER_PREPARATION_PATH_INVALID'});
  const bundle = readPrivateJson(privatePath(privateRoot, path.join(run, 'bundle.json'), {code:'CALLER_PREPARATION_PATH_INVALID'}));
  requireValue(bundle.run_id === runId && bundle.agent.owner_id === 'synthetic-cloud-' + runId &&
    bundle.phone.owner_id === bundle.agent.owner_id && bundle.agent.base_url === 'https://cznbnb.cn/io-api/v1/' &&
    bundle.phone.base_url === bundle.agent.base_url && bundle.agent.producer_id === 'cloud-agent' &&
    bundle.phone.producer_id === 'cloud-phone' && bundle.agent.server_id === bundle.phone.server_id,
    'CALLER_PREPARATION_OWNER_INVALID');
  for (const role of ['agent', 'phone']) {
    requireValue(privatePath(privateRoot, bundle[role].credential_file, {code:'CALLER_PREPARATION_CREDENTIAL_PATH_INVALID'}) === path.join(run, role + '.json'), 'CALLER_PREPARATION_CREDENTIAL_PATH_INVALID');
    requireValue(Date.parse(readPrivateJson(bundle[role].credential_file).expires_at) > Date.now() + 120000, 'CALLER_PREPARATION_EXPIRED');
  }
  // Codex keeps its earlier ids; other agents are named after their runtime.
  const bridge = {...bundle.agent, ...(runtime === 'codex' ? {computer_id:'io-mac-codex-computer', agent_id:'io-current-codex'} : {computer_id:'io-mac-computer', agent_id:'io-' + runtime})};
  const identity = await new BridgeClient(bridge).identity();
  requireValue(identity.scopes?.includes('tasks:write'), 'CALLER_TASK_PUBLISH_SCOPE_REQUIRED');
  const spec = {bridge, project_id:'rayneo-io-agent', operation_key:runId, python, ...(topic === undefined ? {} : {topic})};
  const specFile = privatePath(privateRoot, path.join(run, 'caller-enrollment.json'), {allowMissing:true, code:'CALLER_PREPARATION_PATH_INVALID'});
  writeOnce(specFile, spec);
  const registration = spawnSync(process.execPath, [path.join(workspace, 'rebuild/agent-bridge/questions/cli.mjs'), 'register', '--config', specFile],
    {cwd:workspace, encoding:'utf8', timeout:45000, maxBuffer:1048576});
  let registered;
  try { registered = JSON.parse(registration.stdout); }
  catch { throw Error('CALLER_REGISTRATION_FAILED'); }
  requireValue(registration.status === 0 && registered.registered && registered.caller_verified && registered.creates_agent_session === false && registered.runtime === runtime,
    /^[A-Z_]{3,80}$/.test(registered.error || '') ? registered.error : 'CALLER_REGISTRATION_FAILED');

  const base = privatePath(privateRoot, callerBase(current), {directory:true});
  const active = readPrivateJson(privatePath(privateRoot, path.join(base, 'active.json')));
  requireValue(/^[a-f0-9]{64}$/.test(active.profile), 'CALLER_ACTIVE_CONTEXT_INVALID');
  const directory = privatePath(privateRoot, path.join(base, 'registrations', active.profile), {directory:true}), context = readPrivateJson(privatePath(privateRoot, path.join(directory, 'context.json')));
  requireValue(context.caller.session_id === session && context.caller.cwd === workspace &&
    context.route.session_id === session && context.task_id === registered.task_id, 'CALLER_ORIGINAL_CONTEXT_MISMATCH');
  const phone = readPrivateJson(bundle.phone.credential_file);
  const output = name => privatePath(privateRoot, path.join(run, name), {allowMissing:true, code:'CALLER_PREPARATION_PATH_INVALID'});
  writeOnce(output('task-connection.json'), {format:'turboio-task-connection/1',
    base_url:bundle.phone.base_url, owner_id:bundle.phone.owner_id, producer_id:bundle.phone.producer_id,
    server_id:bundle.phone.server_id, ...phone, ...context.route});
  writeOnce(output('active-profile-path.json'), {directory});
  writeOnce(output('registration-result.json'), registered);
  console.log(JSON.stringify({registered:true, caller_verified:true, runtime, creates_agent_session:false,
    task_id:registered.task_id, connection_file:path.join(run, 'task-connection.json')}));
}

try { await main(); }
catch (error) {
  console.error(JSON.stringify({error:/^[A-Z_]{3,80}$/.test(error.message || '') ? error.message : 'CALLER_PREPARATION_FAILED'}));
  process.exitCode = 2;
}
