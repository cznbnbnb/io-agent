import {validateConnection, validateAction, stamp, matchesBoundTurn, reservedBridgeText, object} from './protocol.js';

// This is a Claude Mod, not Node.js. All I/O goes through documented $ calls.
// Keep $ calls in full and pass $ only to top-level functions for static validation.
let connection = null;
let instance = null;
let enabled = false;
let pumping = false;
let timer = null;
let activeTurn = null;
let busy = true; // Loading into a busy conversation must not manufacture idle.
let journal = {operations:{}, tools:{}, outbox:[]};
let pending = {};
let writeTail = Promise.resolve();
let storageFailed = false;
const synchronousTools = new Set(['Read','Write','Edit','MultiEdit','Glob','Grep','LS','NotebookEdit','TodoWrite','TaskCreate','TaskGet','TaskList','TaskUpdate','TaskStop','AskUserQuestion']);

function storeKey() { return `io-session-v1:${connection.session_id}`; }
function identity() { return {session_id:connection.session_id, cwd:connection.cwd, instance_id:instance}; }
async function persist($) {
  // Event callbacks and the background pump can overlap. Snapshot in call
  // order and serialize storage writes so a slow older write cannot erase a
  // later turn receipt. A failed write poisons this Mod instance.
  const key = storeKey(), snapshot = JSON.parse(JSON.stringify(journal));
  const previous = writeTail;
  let release;
  writeTail = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    if (storageFailed) throw new Error('CLAUDE_MOD_STORE_UNAVAILABLE');
    await $.store.set(key, snapshot);
  } catch (error) {
    storageFailed = true; enabled = false; if (timer) timer.cancel(); throw error;
  } finally { release(); }
}
async function exact($) {
  if (!enabled) return false;
  const session = await $.session.id();
  const cwd = await $.session.cwd();
  return enabled && session === connection.session_id && cwd === connection.cwd;
}
async function post($, endpoint, body) {
  const response = await $.http.fetch(connection.url + endpoint, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + connection.token},
    body:JSON.stringify({...identity(), ...body})
  });
  const value = JSON.parse(response.text);
  if (!response.ok || value.ok !== true) throw new Error(value.error || 'CLAUDE_MOD_LOCAL_REPLY_FAILED');
  return value;
}
async function receipt($, id, phase, extra = {}) {
  const entry = journal.operations[id];
  if (!entry) throw new Error('CLAUDE_MOD_UNKNOWN_OPERATION');
  const value = {operation_id:id, phase, ...extra};
  const key = id + ':' + phase;
  const old = journal.outbox.find(item => item.key === key);
  if (old && JSON.stringify(old.value) !== JSON.stringify(value)) throw new Error('CLAUDE_MOD_LOCAL_RECEIPT_CONFLICT');
  entry.phase = phase;
  if (extra.turn_id) entry.turn_id = extra.turn_id;
  entry.receipt = value;
  if (!old) journal.outbox.push({key, value});
  await persist($);
}
async function flush($) {
  const item = journal.outbox[0];
  if (!item) return;
  await post($, item.endpoint || '/v1/report', {receipt:item.value});
  if (journal.outbox[0]?.key === item.key) { journal.outbox.shift(); await persist($); }
}
function abortWasRequested(turnId) {
  return Object.values(journal.operations).some(entry => entry.kind === 'abort' &&
    entry.turn_id === turnId && entry.abort_dispatched === true);
}
async function childReceipt($, entry, phase, extra = {}) {
  const value = {operation_id:entry.operation_id, turn_id:entry.turn_id, tool_use_id:entry.tool_use_id,
    task_id:entry.task_id, phase, ...extra};
  const key = 'child:' + entry.tool_use_id + ':' + phase;
  const old = journal.outbox.find(item => item.key === key);
  if (old && JSON.stringify(old.value) !== JSON.stringify(value)) throw new Error('CLAUDE_MOD_CHILD_RECEIPT_CONFLICT');
  entry.phase = phase;
  entry.receipt = value;
  if (!old) journal.outbox.push({key, endpoint:'/v1/child-report', value});
  await persist($);
}
async function workReceipt($, id) {
  const operation=journal.operations[id];
  if (!operation?.turn_id || operation.coverage !== 1) return;
  operation.work_sequence=(operation.work_sequence || 0)+1;
  const value={operation_id:id,turn_id:operation.turn_id,sequence:operation.work_sequence,
    sealed:operation.sealed===true,tools:Object.values(journal.tools).filter(t=>t.operation_id===id).map(t=>({
      tool_use_id:t.tool_use_id,tool:t.tool,state:t.work_state || 'unknown'}))};
  journal.outbox.push({key:'work:'+id+':'+value.sequence,endpoint:'/v1/work-report',value});
  await persist($);
}
async function stopChildren($) {
  const entry = Object.values(journal.tools).find(item => item.phase === 'identified' && abortWasRequested(item.turn_id));
  if (!entry || !(await exact($))) return;
  // A durable intent precedes the actual TaskStop call. Prepared or unknown
  // entries are never retried; permissions stay entirely with the host.
  await childReceipt($, entry, 'stop_prepared');
  if (!(await exact($))) return;
  try {
    const response = await $.tool.call({tool:'TaskStop', task_id:entry.task_id});
    if (!(await exact($))) return;
    if (typeof response?.deny === 'string') {
      await childReceipt($, entry, 'stop_denied', {native_result:'denied', reason:response.deny.slice(0,256)});
    } else if (!response?.isError && object(response?.result) && response.result.task_id === entry.task_id &&
        response.result.task_type === 'local_bash') {
      await childReceipt($, entry, 'stop_requested', {native_result:'success'});
    } else {
      await childReceipt($, entry, 'stop_unknown', {native_result:response?.isError ? 'error' : 'unrecognized', reason:'native_task_stop_receipt_not_proven'});
    }
  } catch (error) {
    if (enabled) await childReceipt($, entry, 'stop_unknown', {native_result:'unknown', reason:'native_task_stop_outcome_unknown'});
  }
}
async function trackTool($, e, next) {
  const turn = activeTurn;
  const operation = Object.keys(journal.operations).find(id => journal.operations[id].kind === 'submit' &&
    journal.operations[id].turn_id === turn);
  if (!enabled || e.agentId !== undefined || !operation || !(await exact($))) return next(e);
  if (typeof e.tool_use_id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(e.tool_use_id)) {
    return {deny:'The bridge cannot identify this tool call for scoped stopping.'};
  }
  const id = e.tool_use_id, old = journal.tools[id];
  if (old && (old.operation_id !== operation || old.turn_id !== turn)) {
    return {deny:'The bridge received a conflicting tool call identity.'};
  }
  if (!old) {
    if (Object.keys(journal.tools).length >= 1000) return {deny:'The bridge tool ledger is full.'};
    journal.tools[id] = {tool_use_id:id, operation_id:operation, turn_id:turn, tool:e.tool, phase:'observing',work_state:'in_flight'};
    await persist($);
    await workReceipt($,operation);
  }
  let response;
  try { response = await next(e); }
  catch (error) {
    journal.tools[id].work_state='unknown';
    await workReceipt($,operation);
    throw error;
  }
  if (!(await exact($))) return response;
  const result = response?.result;
  // Never extract a task ID from stdout/text. Native structured result must
  // identify backgrounding caused by a turn abort, not normal background work.
  if (e.tool === 'Bash' && !response?.isError && object(result) &&
      typeof result.backgroundTaskId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(result.backgroundTaskId)) {
    const entry = journal.tools[id];
    if (entry.task_id && entry.task_id !== result.backgroundTaskId) throw new Error('CLAUDE_MOD_CHILD_TASK_CONFLICT');
    entry.task_id = result.backgroundTaskId;
    entry.work_state='background';
    if (entry.phase === 'observing') await childReceipt($, entry, 'identified');
  } else journal.tools[id].work_state = result?.detachedToolCall === true ? 'unknown' :
    (e.tool === 'Bash' || synchronousTools.has(e.tool)) ? 'settled' : 'unsupported';
  await workReceipt($,operation);
  return response;
}
async function submissionSettled($, id, result) {
  if (!enabled || !journal.operations[id]) return;
  if (result?.drop) {
    if (!journal.operations[id].turn_id && journal.operations[id].phase !== 'expired') await receipt($, id, 'dropped', {reason:String(result.drop).slice(0,256)});
    delete pending[id];
  }
  // A resolve only means the turn started. turn.start/complete provide its ID
  // and terminal result; never synthesize a completed result from this promise.
}
async function submissionFailed($, id) {
  if (!enabled || !journal.operations[id]) return;
  // An exception after calling native submit may follow a real admission.
  // Never retry the operation; a later exact turn event can resolve it.
  if (!journal.operations[id].turn_id) await receipt($, id, 'outcome_unknown', {reason:'native_submit_failed'});
}
async function perform($, action) {
  if (!validateAction(action, connection) || !(await exact($))) throw new Error('CLAUDE_MOD_ACTION_MISMATCH');
  const id = action.operation_id;
  const old = journal.operations[id];
  if (old) {
    if (old.receipt && !journal.outbox.some(item => item.key === id + ':' + old.receipt.phase)) {
      journal.outbox.push({key:id + ':' + old.receipt.phase, value:old.receipt}); await persist($);
    } else if (!pending[id] && old.phase === 'prepared') {
      await receipt($, id, 'outcome_unknown', {reason:'previous_dispatch_not_proven'});
    }
    return;
  }
  if (Object.keys(journal.operations).length >= 1000) throw new Error('CLAUDE_MOD_QUEUE_LIMIT');
  journal.operations[id] = {kind:action.kind, phase:'prepared', ...(action.kind === 'abort' ? {turn_id:action.turn_id} : {})};
  await persist($); // Write-ahead record before either native side effect.
  if (!(await exact($))) return;
  if (action.kind === 'abort') {
    if (activeTurn !== action.turn_id) {
      await receipt($, id, 'abort_rejected', {turn_id:action.turn_id, reason:'turn_no_longer_current'}); return;
    }
    try {
      journal.operations[id].abort_dispatched = true;
      await persist($);
      await $.turn.abort({turnId:action.turn_id});
      await receipt($, id, 'abort_requested', {turn_id:action.turn_id});
    } catch (error) {
      // Even an error is not sufficient evidence of no effect after crossing
      // the host boundary. Keep the request unknown and never resend it.
      await receipt($, id, 'outcome_unknown', {turn_id:action.turn_id, reason:'native_abort_not_confirmed'});
    }
    return;
  }
  const now = await $.clock.now();
  if (Date.parse(action.expires_at) <= now) { await receipt($, id, 'expired'); return; }
  pending[id] = {text:stamp(id) + action.text, expires_at:action.expires_at};
  await receipt($, id, 'queued_native');
  if (!(await exact($))) return;
  if (Date.parse(action.expires_at) <= await $.clock.now()) {
    delete pending[id]; await receipt($, id, 'expired'); return;
  }
  // Official Mod dispatch skips this Mod's own prompt.submit hook. Trust is
  // established by authenticated broker delivery and durable write-ahead, not
  // by assuming a second callback will run. External inputs with our reserved
  // prefix/wrapper are rejected in that hook; unrelated user turns may run
  // before this queued native input without consuming its binding.
  pending[id].submitted = true;
  // No await: submit waits for an idle turn. Awaiting it would block the
  // background pump, including independent stop requests and receipt retries.
  $.prompt.submit({text:pending[id].text}).then(
    result => submissionSettled($, id, result),
    () => submissionFailed($, id)
  ).catch(() => { enabled = false; if (timer) timer.cancel(); });
}
async function pump($) {
  if (!enabled || pumping) return;
  pumping = true;
  try {
    if (!(await exact($))) { await end($); return; }
    for (let n=0;n<8 && journal.outbox.length;n++) await flush($);
    const response = await post($, '/v1/poll', {busy, turn_id:activeTurn});
    if (response.action) await perform($, response.action);
    await stopChildren($);
  } catch (error) {
    // Durable operation IDs make a lost HTTP reply retryable. Native calls
    // themselves are never retried; their write-ahead records fence replay.
  } finally { pumping = false; }
}
async function start($) {
  if (timer) timer.cancel();
  enabled = false;
  connection = JSON.parse(await $.fs.read($.plugin.root + '/.claude-plugin/connection.json'));
  if (!validateConnection(connection)) throw new Error('CLAUDE_MOD_CONNECTION_INVALID');
  const session = await $.session.id();
  const cwd = await $.session.cwd();
  if (session !== connection.session_id || cwd !== connection.cwd) throw new Error('CLAUDE_MOD_BINDING_MISMATCH');
  const loaded = await $.store.get(storeKey());
  journal = loaded || {operations:{}, tools:{}, outbox:[]};
  journal.tools ??= {};
  if (!object(journal.operations) || !object(journal.tools) || !Array.isArray(journal.outbox)) throw new Error('CLAUDE_MOD_STORE_INVALID');
  instance = String(await $.clock.now()) + '-' + Math.random().toString(36).slice(2);
  let enginePid;
  try {
    // The short-lived helper's parent is the native CLI, not a PID supplied
    // by a model or read from its tool output. The broker verifies OS identity.
    const process = await $.process.run(['/bin/sh','-c','printf "%s" "$PPID"'],{timeoutMs:2000});
    if (process.exitCode===0 && /^[1-9][0-9]*$/.test(process.stdout)) enginePid=Number(process.stdout);
  } catch { /* execution still works; stop remains unconfirmed without a witness */ }
  await post($, '/v1/bind', enginePid ? {engine_pid:enginePid} : {});
  enabled = true;
  for (const entry of Object.values(journal.tools)) {
    if (entry.phase === 'stop_prepared') await childReceipt($, entry, 'stop_unknown', {reason:'previous_task_stop_not_proven'});
  }
  timer = $.clock.every(250, async () => { await pump($); });
}
async function end($) {
  if (!enabled) return;
  enabled = false;
  if (timer) timer.cancel();
  activeTurn = null; pending = {};
  // session.end covers /clear, /resume and /branch. Do not rebind a new ID.
  try { await post($, '/v1/end', {}); } catch (error) { /* heartbeat expires */ }
}
async function admit($, e, next) {
  // This callback sees other origins, not this Mod's own native submission.
  // A pasted operation marker or attribution wrapper must not impersonate our
  // pending turn, even when the text and claimed plugin name match exactly.
  if (reservedBridgeText(e.text)) return {drop:'This text uses a reserved bridge operation marker.'};
  return next(e);
}
async function started($, e) {
  if (!enabled || e.agentId !== undefined) return;
  activeTurn = e.turnId; busy = true;
  // The actual SDK turn text is wrapped, and self-dispatch does not invoke our
  // prompt.submit hook. Match the complete authenticated, already-dispatched
  // input; never search inside arbitrary user messages for an operation ID.
  const id = Object.keys(pending).find(key => pending[key].submitted &&
    !journal.operations[key]?.turn_id && matchesBoundTurn(e.text, pending[key].text));
  if (id && await exact($)) {
    journal.operations[id].coverage=1;
    await receipt($, id, 'running', {turn_id:e.turnId,work_coverage:1});
    await workReceipt($,id);
    // Native turn.start awaits this callback. Acknowledging the pre-tool
    // process baseline here prevents a later poll mistaking our own child
    // process for a pre-existing service. Failure never grants stop proof.
    while (journal.outbox.length) await flush($);
  }
}
async function completed($, e) {
  if (!enabled || e.agentId !== undefined) return;
  if (activeTurn === e.turnId || activeTurn === null) { activeTurn = null; busy = false; }
  const id = Object.keys(journal.operations).find(key => journal.operations[key].kind === 'submit' && journal.operations[key].turn_id === e.turnId);
  if (!id) return;
  journal.operations[id].sealed=true;
  await workReceipt($,id);
  const hasAnswer = typeof e.answer === 'string' && e.answer.length <= 32768;
  await receipt($, id, e.isAborted ? 'interrupted' : 'completed', {turn_id:e.turnId,
    ...(hasAnswer ? {answer:e.answer} : {reason:typeof e.answer === 'string' ? 'final_result_too_large' : 'final_result_missing'})});
  delete pending[id];
}
export function register(on) {
  on('session.start', async ($, e, next) => { await start($); return next(e); });
  on('session.end', async ($, e, next) => { await end($); return next(e); });
  on('prompt.submit', async ($, e, next) => admit($, e, next)).catch(async ($, e, next) => {
    if (next.called || !reservedBridgeText(e.text)) return next(e);
    return {drop:'The bridge admission check failed. This task was not started.'};
  });
  on('turn.start', async ($, e, next) => { await started($, e); return next(e); });
  on('turn.complete', async ($, e, next) => { await completed($, e); return next(e); });
  on('tool.call', async ($, e, next) => trackTool($, e, next)).catch(async ($, e, next) => {
    if (next.called) return next(e);
    return {deny:'The bridge could not durably track this tool call.'};
  });
}
