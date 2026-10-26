import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {BridgeState} from '../../state.mjs';
import {BridgeRunLock} from '../../run-lock.mjs';
import {runtimeDigest} from '../../runtime-events.mjs';
import {uuid, object} from './plugin/hooks/protocol.js';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const need = (condition, code) => { if (!condition) fail(code); };
const terminal = new Set(['completed', 'interrupted', 'dropped', 'expired', 'abort_requested', 'abort_rejected']);
const phases = new Set(['queued', 'handoff', 'queued_native', 'running', 'outcome_unknown', ...terminal]);
const childPhases = new Set(['identified','stop_prepared','stop_requested','stop_denied','stop_unknown']);
const clean = operation => {
  const {text, digest, ...value} = operation;
  return structuredClone(value);
};

/** Local candidate only. No credential discovery, model process, or plugin installation. */
export async function createClaudeModBroker({directory, binding, clock = Date.now}) {
  need(path.isAbsolute(directory) && object(binding) && uuid(binding.route?.session_id) &&
    binding.host_kind === 'claude' && path.isAbsolute(binding.workspace), 'CLAUDE_MOD_BINDING_INVALID');
  binding = {server_id:binding.server_id, owner_id:binding.owner_id, host_kind:binding.host_kind,
    workspace:binding.workspace, route:structuredClone(binding.route)};
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  need((fs.statSync(directory).mode & 0o077) === 0, 'CLAUDE_MOD_DIRECTORY_NOT_PRIVATE');
  const stateFile = path.join(directory, 'broker.json');
  const existing = fs.existsSync(stateFile);
  const lock = BridgeRunLock.acquire({stateFile, identity:{server_id:'claude-mod-v1', owner_id:String(os.userInfo().uid),
    computer_id:'local', agent_id:`claude-mod:${binding.route.session_id}`}});
  let state, server, poisoned = false, closed = false;
  try {
    state = BridgeState.load(lock.stateFile);
    state.bind({server_id:binding.server_id, owner_id:binding.owner_id, producer_id:'claude-mod-broker', binding});
    state.guardWrites(() => lock.assertHeld());
    need(!existing || object(state.value.claude_mod), 'CLAUDE_MOD_STATE_CORRUPT');
    state.value.claude_mod ??= {version:1, operations:{}, order:[]};
    const journal = state.value.claude_mod;
    need(journal.version === 1 && object(journal.operations) && Array.isArray(journal.order) &&
      journal.order.length <= 1000 && new Set(journal.order).size === journal.order.length &&
      journal.order.length === Object.keys(journal.operations).length, 'CLAUDE_MOD_STATE_CORRUPT');
    for (const id of journal.order) {
      const op = journal.operations[id];
      need(uuid(id) && object(op) && op.operation_id === id && ['submit','abort'].includes(op.kind) && phases.has(op.phase) &&
        op.session_id === binding.route.session_id && op.cwd === binding.workspace && typeof op.digest === 'string', 'CLAUDE_MOD_STATE_CORRUPT');
      const input = {kind:op.kind, operation_id:id};
      if (op.kind === 'submit') {
        need(typeof op.text === 'string' && op.text.trim() && Buffer.byteLength(op.text) <= 32768 &&
          typeof op.expires_at === 'string' && Number.isFinite(Date.parse(op.expires_at)), 'CLAUDE_MOD_STATE_CORRUPT');
        Object.assign(input, {text:op.text, expires_at:op.expires_at});
      } else {
        need(typeof op.turn_id === 'string' && op.turn_id.length > 0 && op.turn_id.length <= 160, 'CLAUDE_MOD_STATE_CORRUPT');
        input.turn_id = op.turn_id;
      }
      Object.assign(input, {session_id:op.session_id, cwd:op.cwd});
      need(runtimeDigest(input) === op.digest, 'CLAUDE_MOD_STATE_CORRUPT');
      // Native input cannot be replayed after broker loss, even if the old Mod
      // had not managed to report its turn. An unknown receipt fences the queue.
      if (!terminal.has(op.phase) && op.phase !== 'queued') op.phase = 'outcome_unknown';
    }
    const save = () => { try { state.save(); } catch (error) { poisoned = true; throw error; } };
    const check = () => { need(!closed && !poisoned, 'CLAUDE_MOD_STORAGE_UNAVAILABLE'); lock.assertHeld(); };
    save();
    const token = randomBytes(32).toString('hex');
    let instance = null, ended = false, heartbeat = 0, busy = true, activeTurn = null;
    let publicUrl;
    const envelope = value => ({...value, session_id:binding.route.session_id, cwd:binding.workspace});
    const ready = () => { check(); need(instance && !ended && clock() - heartbeat < 5000, 'CLAUDE_MOD_NOT_CONNECTED'); };
    function change(op, phase, extra = {}) { Object.assign(op, extra, {phase}); save(); }
    function expire() {
      for (const id of journal.order) {
        const op = journal.operations[id];
        if (op.kind === 'submit' && op.phase === 'queued' && Date.parse(op.expires_at) <= clock()) change(op, 'expired');
      }
    }
    function enqueue(input) {
      check();
      const digest = runtimeDigest(input), old = journal.operations[input.operation_id];
      if (old) { need(old.digest === digest, 'CLAUDE_MOD_OPERATION_CONFLICT'); return clean(old); }
      need(journal.order.length < 1000, 'CLAUDE_MOD_QUEUE_LIMIT');
      const op = {...input, digest, phase:'queued'};
      journal.operations[op.operation_id] = op; journal.order.push(op.operation_id); save();
      return clean(op);
    }
    function route(request) {
      check();
      need(object(request) && request.session_id === binding.route.session_id && request.cwd === binding.workspace,
        'CLAUDE_MOD_ROUTE_MISMATCH');
      need(typeof request.instance_id === 'string' && /^[a-zA-Z0-9._-]{8,128}$/.test(request.instance_id), 'CLAUDE_MOD_INSTANCE_INVALID');
    }
    function receive(endpoint, request) {
      route(request);
      if (endpoint === '/v1/bind') {
        need(!ended && (instance === null || instance === request.instance_id), 'CLAUDE_MOD_ALREADY_BOUND');
        instance = request.instance_id; heartbeat = clock(); return {ok:true};
      }
      need(instance === request.instance_id && !ended, 'CLAUDE_MOD_INSTANCE_STALE');
      heartbeat = clock();
      if (endpoint === '/v1/end') {
        ended = true; busy = true; activeTurn = null;
        for (const id of journal.order) {
          const op = journal.operations[id];
          if (op.phase === 'queued') op.phase = 'dropped';
          else if (!terminal.has(op.phase)) op.phase = 'outcome_unknown';
        }
        save(); return {ok:true};
      }
      if (endpoint === '/v1/poll') {
        need(typeof request.busy === 'boolean' && (request.turn_id === null || typeof request.turn_id === 'string'), 'CLAUDE_MOD_STATUS_INVALID');
        busy = request.busy; activeTurn = request.turn_id; expire();
        // Stop can pass a pending native submission. Normal tasks remain FIFO
        // and an ambiguous admission never opens a second input flight.
        let op = journal.order.map(id => journal.operations[id]).find(x => x.kind === 'abort' && ['queued','handoff'].includes(x.phase));
        if (!op) {
          const first = journal.order.map(id => journal.operations[id]).find(x => x.kind === 'submit' && !terminal.has(x.phase));
          if (first && ['queued','handoff'].includes(first.phase)) op = first;
        }
        if (!op) return {ok:true, action:null};
        if (op.phase === 'queued') change(op, 'handoff');
        const {digest, phase, ...action} = op;
        return {ok:true, action};
      }
      if (endpoint === '/v1/report') {
        const receipt = request.receipt, op = object(receipt) && journal.operations[receipt.operation_id];
        need(op && phases.has(receipt.phase) && !['queued','handoff'].includes(receipt.phase), 'CLAUDE_MOD_RECEIPT_INVALID');
        const index = ['queued_native','running','completed','interrupted','dropped','expired','outcome_unknown','abort_requested','abort_rejected'].indexOf(receipt.phase);
        const receiptId = `${receipt.operation_id}:${receipt.phase}`;
        const digest = runtimeDigest(receipt); op.receipts ??= {};
        if (op.receipts[receiptId]) { need(op.receipts[receiptId] === digest, 'CLAUDE_MOD_RECEIPT_CONFLICT'); return {ok:true}; }
        need(index >= 0 && (receipt.turn_id === undefined || typeof receipt.turn_id === 'string' && receipt.turn_id.length <= 160), 'CLAUDE_MOD_RECEIPT_INVALID');
        need(op.phase !== 'queued', 'CLAUDE_MOD_NOT_DISPATCHED');
        if (op.turn_id && receipt.turn_id) need(op.turn_id === receipt.turn_id, 'CLAUDE_MOD_TURN_CONFLICT');
        need(!['running','completed','interrupted'].includes(receipt.phase) || Boolean(receipt.turn_id), 'CLAUDE_MOD_TURN_MISSING');
        need(op.kind === 'abort' ? ['abort_requested','abort_rejected','outcome_unknown'].includes(receipt.phase) :
          !['abort_requested','abort_rejected'].includes(receipt.phase), 'CLAUDE_MOD_RECEIPT_INVALID');
        need(receipt.answer === undefined || typeof receipt.answer === 'string' && receipt.answer.length <= 32768, 'CLAUDE_MOD_RESULT_INVALID');
        // Delayed retries may acknowledge an older state but cannot roll back
        // a final receipt or substitute another terminal outcome.
        if (terminal.has(op.phase)) {
          need(receipt.phase === 'queued_native' || receipt.phase === 'running', 'CLAUDE_MOD_TERMINAL_CONFLICT');
          op.receipts[receiptId] = digest; save(); return {ok:true};
        }
        op.receipts[receiptId] = digest;
        const extra = {};
        if (receipt.turn_id) extra.turn_id = receipt.turn_id;
        if (typeof receipt.reason === 'string') extra.reason = receipt.reason.slice(0,256);
        if (typeof receipt.answer === 'string') extra.answer = receipt.answer;
        if (['running','outcome_unknown'].includes(op.phase) && receipt.phase === 'queued_native') { save(); return {ok:true}; }
        change(op, receipt.phase, extra); return {ok:true};
      }
      if (endpoint === '/v1/child-report') {
        const r = request.receipt, op = object(r) && journal.operations[r.operation_id];
        need(op?.kind === 'submit' && typeof op.turn_id === 'string' && op.turn_id === r.turn_id &&
          typeof r.tool_use_id === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(r.tool_use_id) &&
          typeof r.task_id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.task_id) && childPhases.has(r.phase),
          'CLAUDE_MOD_CHILD_RECEIPT_INVALID');
        if (r.phase !== 'identified') need(journal.order.some(id => {
          const a = journal.operations[id];return a.kind === 'abort' && a.turn_id === r.turn_id &&
            ['handoff','abort_requested','outcome_unknown'].includes(a.phase);
        }), 'CLAUDE_MOD_CHILD_STOP_NOT_REQUESTED');
        op.children ??= {};
        const old = op.children[r.tool_use_id];
        need(!old || old.task_id === r.task_id, 'CLAUDE_MOD_CHILD_TASK_CONFLICT');
        const child = old ?? {tool_use_id:r.tool_use_id, task_id:r.task_id, turn_id:r.turn_id, phase:'identified', receipts:{}};
        const digest = runtimeDigest(r);
        if (child.receipts[r.phase]) {need(child.receipts[r.phase] === digest,'CLAUDE_MOD_CHILD_RECEIPT_CONFLICT');return {ok:true};}
        if (['stop_requested','stop_denied','stop_unknown'].includes(child.phase)) {
          need(['identified','stop_prepared'].includes(r.phase),'CLAUDE_MOD_CHILD_TERMINAL_CONFLICT');
        } else if (!(child.phase === 'stop_prepared' && r.phase === 'identified')) {
          if (r.phase === 'stop_prepared') need(child.phase === 'identified','CLAUDE_MOD_CHILD_PHASE_INVALID');
          if (['stop_requested','stop_denied','stop_unknown'].includes(r.phase))
            need(child.phase === 'stop_prepared','CLAUDE_MOD_CHILD_PHASE_INVALID');
          child.phase = r.phase;
          if (typeof r.reason === 'string') child.reason = r.reason.slice(0,256);
          if (['success','denied','error','unrecognized','unknown'].includes(r.native_result)) child.native_result = r.native_result;
        }
        child.receipts[r.phase] = digest;op.children[r.tool_use_id] = child;save();return {ok:true};
      }
      fail('CLAUDE_MOD_ENDPOINT_UNKNOWN');
    }
    server = http.createServer(async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };
      try {
        check();
        need(req.method === 'POST' && req.headers.host === publicUrl.slice(7) && !req.headers.origin, 'CLAUDE_MOD_REQUEST_REFUSED');
        const auth = req.headers.authorization ?? '', expected = `Bearer ${token}`;
        need(auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected)), 'CLAUDE_MOD_AUTH_FAILED');
        need(req.headers['content-type']?.split(';')[0] === 'application/json', 'CLAUDE_MOD_REQUEST_REFUSED');
        let raw = '', bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; need(bytes <= 128*1024, 'CLAUDE_MOD_REQUEST_LIMIT'); raw += chunk; }
        reply(200, receive(req.url, JSON.parse(raw)));
      } catch (error) { reply(error.code === 'CLAUDE_MOD_AUTH_FAILED' ? 401 : 409, {ok:false, error:/^CLAUDE_MOD_/.test(error.code) ? error.code : 'CLAUDE_MOD_REQUEST_FAILED'}); }
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000;
    await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    publicUrl = `http://127.0.0.1:${server.address().port}`;
    const pluginDirectory = path.join(directory, 'plugin');
    fs.cpSync(fileURLToPath(new URL('./plugin', import.meta.url)), pluginDirectory, {recursive:true});
    const configFile = path.join(pluginDirectory,'.claude-plugin','connection.json');
    const descriptor = envelope({schema_version:1, token, url:publicUrl});
    fs.writeFileSync(configFile, JSON.stringify(descriptor), {mode:0o600}); fs.chmodSync(configFile,0o600);
    const host = {
      conversationId:binding.route.session_id,
      capabilities:{atomic_idle_start:false, atomic_queue_append:true, exact_turn_interrupt:true, final_result_evidence:true, native_queue_expiry:false},
      async status() { ready(); return {conversationId:binding.route.session_id, workspace:binding.workspace, busy, activeTurnId:activeTurn}; },
      async start({text,clientUserMessageId,expiresAt}) {
        ready(); need(uuid(clientUserMessageId) && typeof text === 'string' && text.trim() && Buffer.byteLength(text) <= 32768 &&
          typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)), 'CLAUDE_MOD_INPUT_INVALID');
        enqueue(envelope({kind:'submit', operation_id:clientUserMessageId, text, expires_at:expiresAt}));
        return {accepted:true, clientUserMessageId};
      },
      async inspectOperation(id) {
        check(); const op = journal.operations[id];
        if (!op || op.kind !== 'submit') return {found:false, outcomeUnknown:true, resultComplete:false};
        if (op.phase === 'outcome_unknown' && !op.turn_id) return {found:false, outcomeUnknown:true, resultComplete:false};
        const status = {running:'inProgress', completed:'completed', interrupted:'interrupted', dropped:'failed', expired:'failed'}[op.phase] ??
          (['queued','handoff','queued_native'].includes(op.phase) ? 'queued' : 'unknown');
        return {found:true, turnId:op.turn_id ?? null,
          status:!op.turn_id && ['dropped','expired'].includes(op.phase) ? 'rejected' : status,
          phase:op.phase, reason:op.reason ?? (op.phase === 'expired' ? 'task_expired_before_admission' : undefined),
          resultComplete:op.phase === 'completed' && typeof op.answer === 'string',
          result:typeof op.answer === 'string' ? {type:'text', text:op.answer} : undefined};
      },
      async interrupt(turnId) {
        ready(); need(typeof turnId === 'string' && turnId.length > 0 && turnId.length <= 160, 'CLAUDE_MOD_STOP_INVALID');
        const prior = journal.order.map(id => journal.operations[id]).find(op => op.kind === 'abort' && op.turn_id === turnId);
        if (!prior) {
          need(activeTurn === turnId, 'CLAUDE_MOD_STOP_STALE');
          enqueue(envelope({kind:'abort', operation_id:randomUUID(), turn_id:turnId}));
        }
        return {requested:true, expectedTurnId:turnId, confirmedStopped:false};
      },
      async inspectStop(turnId) {
        check(); const op = Object.values(journal.operations).find(op => op.kind === 'submit' && op.turn_id === turnId);
        return {conversationId:binding.route.session_id, turnId, terminal:op?.phase === 'interrupted', descendantsStopped:false,
          ...(op?.children ? {childStops:Object.values(op.children).map(({receipts,...child})=>structuredClone(child))} : {})};
      }
    };
    return {host, pluginDirectory, configFile, snapshot:() => journal.order.map(id => clean(journal.operations[id])),
      async close() { if (closed) return; closed = true; await new Promise(resolve => server.close(resolve)); lock.release(); } };
  } catch (error) { server?.close(); lock.release(); throw error; }
}
