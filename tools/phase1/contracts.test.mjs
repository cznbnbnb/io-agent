// Conformance reference only; not a deployed server, auth service, queue, or runtime adapter.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function dependency(name) { try { return require(name); } catch { return require('../deveco-cli/node_modules/' + name); } }
const Ajv = dependency('ajv/dist/2020.js');
const addFormats = dependency('ajv-formats');
const root = new URL('../../docs/contracts/', import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('event-v1.schema.json', root))));
class ReferenceLedger {
  seen = new Map(); materials = new Map(); requests = new Map(); tasks = new Map();
  accept(e, now) {
    if (!validate(e)) return 'INVALID';
    if (Date.parse(e.expires_at) <= now || Date.parse(e.expires_at) <= Date.parse(e.created_at)) return 'EXPIRED';
    const key = e.producer_id + ':' + e.idempotency_key, digest = JSON.stringify(e);
    if (this.seen.has(key)) return this.seen.get(key) === digest ? 'duplicate' : 'IDEMPOTENCY_CONFLICT';
    const b = e.body; let result;
    if (e.kind === 'material.revision') {
      const revision = this.materials.get(b.material_id) || 0;
      if (b.base_revision !== revision || b.revision !== revision + 1) return 'REVISION_CONFLICT';
      if (Date.parse(b.ended_at) < Date.parse(b.started_at) || b.utterances.some(u => u.end_ms < u.start_ms)) return 'INVALID_TIME_RANGE';
      if (b.operation === 'delete' && b.utterances.length) return 'INVALID_TOMBSTONE';
      this.materials.set(b.material_id, b.revision); result = b.operation === 'delete' ? 'deleted' : 'stored';
    } else if (e.kind === 'task') { this.tasks.set(b.task_id, b); result = 'task_queued';
    } else if (e.kind === 'request') {
      const task = this.tasks.get(b.task_id);
      if (!task || JSON.stringify(task.route) !== JSON.stringify(b.route)) return 'ROUTE_MISMATCH';
      if (b.mode === 'choice' && (b.options.length < 2 || new Set(b.options.map(o => o.option_id)).size !== b.options.length)) return 'INVALID_OPTIONS';
      if (this.requests.has(b.request_id)) return 'REQUEST_REVISION_CONFLICT';
      this.requests.set(b.request_id, { ...b, expires_at: e.expires_at }); result = 'request_pending';
    } else if (e.kind === 'answer') {
      const r = this.requests.get(b.request_id);
      if (!r) return 'REQUEST_NOT_FOUND';
      if (r.revision !== b.request_revision) return 'STALE_REQUEST';
      if (Date.parse(r.expires_at) <= now) return 'EXPIRED';
      if (JSON.stringify(r.route) !== JSON.stringify(b.route) || r.task_id !== b.task_id) return 'ROUTE_MISMATCH';
      if (r.state === 'answered') return 'ANSWER_ALREADY_ACCEPTED';
      if (r.state === 'withdrawn' || r.state === 'expired') return 'REQUEST_CLOSED';
      if ((!b.option_id && !b.text.trim()) || (b.option_id && !r.options.some(o => o.option_id === b.option_id))) return 'INVALID_ANSWER';
      r.state = 'answered'; result = 'answer_recorded';
    } else result = e.kind === 'receipt' ? 'receipt_recorded' : 'message_queued';
    this.seen.set(key, digest); return result;
  }
}
for (const name of ['normal','duplicate','expired','offline-recovery']) {
  test(`P14 ${name}: valid wire objects and expected lifecycle boundaries`, () => {
    const fixture = JSON.parse(fs.readFileSync(new URL(name + '.json', root)));
    const ledger = new ReferenceLedger();
    fixture.events.forEach(e => assert(validate(e), JSON.stringify(validate.errors)));
    assert.deepEqual(fixture.events.map(e => ledger.accept(e, Date.parse(fixture.server_now))), fixture.expected);
    if (name === 'offline-recovery') assert.equal(ledger.materials.get('material-demo'), 3);
  });
}
test('P14 altered idempotency key body, stale version, foreign route and unknown option fail closed', () => {
  const { events, server_now } = JSON.parse(fs.readFileSync(new URL('normal.json', root)));
  const now = Date.parse(server_now), ledger = new ReferenceLedger();
  ledger.accept(events[0], now);
  const changed = structuredClone(events[0]); changed.body.completeness = 'partial';
  assert.equal(ledger.accept(changed, now), 'IDEMPOTENCY_CONFLICT');
  ledger.accept(events[1], now); ledger.accept(events[2], now);
  const stale = structuredClone(events[4]); stale.body.request_revision++;
  assert.equal(ledger.accept(stale, now), 'STALE_REQUEST');
  const foreign = structuredClone(events[4]); foreign.body.route.session_id = 'other';
  assert.equal(ledger.accept(foreign, now), 'ROUTE_MISMATCH');
  const option = structuredClone(events[4]); option.body.option_id = 'unlisted';
  assert.equal(ledger.accept(option, now), 'INVALID_ANSWER');
  const invalid = structuredClone(events[4]); invalid.body.raw_action = 'nod';
  assert.equal(ledger.accept(invalid, now), 'INVALID');
});
