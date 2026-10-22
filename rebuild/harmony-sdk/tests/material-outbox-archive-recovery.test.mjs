import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadApp } from './load-app.mjs';

const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');

function fixture(t) {
  const prefix = path.join(os.tmpdir(), 'turboio-archive-recovery-');
  const root = fs.mkdtempSync(prefix).replaceAll('\\', '/');
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
    fs.rmSync(root, { recursive: true });
  });
  let promotionCount = 0;
  let loseReplyAt = -1;
  const readPositions = new Map();
  const io = {
    OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4, READ_ONLY: 8 },
    accessSync: fs.existsSync,
    mkdirSync: p => fs.mkdirSync(p),
    listFileSync: fs.readdirSync,
    lstatSync: fs.lstatSync,
    statSync: p => typeof p === 'number' ? fs.fstatSync(p) : fs.statSync(p),
    readTextSync: p => fs.readFileSync(p, 'utf8'),
    openSync: (p, mode) => {
      const fd = fs.openSync(p, mode & 4 ? 'w' : 'r');
      readPositions.set(fd, 0);
      return { fd };
    },
    closeSync: file => {
      fs.closeSync(file.fd);
      readPositions.delete(file.fd);
    },
    writeSync: (fd, bytes) => fs.writeSync(fd, new Uint8Array(bytes).slice(0, 37)),
    // Harmony ReadOptions.offset is relative to the current file pointer.
    // Node's explicit position does not advance its fd, so track that pointer
    // here rather than silently modelling an absolute Harmony offset.
    readSync: (fd, buffer, options = {}) => {
      const position = readPositions.get(fd) + (options.offset ?? 0);
      const count = fs.readSync(fd, new Uint8Array(buffer), 0,
        Math.min(options.length ?? buffer.byteLength, 53), position);
      readPositions.set(fd, position + count);
      return count;
    },
    fsyncSync: fs.fsyncSync,
    renameSync: (from, to) => {
      fs.renameSync(from, to);
      if (++promotionCount === loseReplyAt) throw Error('SYNTHETIC_POST_RENAME_FAILURE');
    }
  };
  const api = loadApp('MaterialOutboxArchiveIndex', { '@kit.CoreFileKit': { fileIo: io } });
  const partition = hash('synthetic-owner/producer/server');
  const reopen = () => {
    const index = new api.MaterialOutboxArchiveIndex();
    index.initialize(root, partition, hash);
    return index;
  };
  return {
    root, reopen,
    loseNextPromotionReply: () => { loseReplyAt = promotionCount + 1; },
    stopLosingReplies: () => { loseReplyAt = -1; }
  };
}

// Storage-only crash model: the caller has not published an authoritative
// outbox state. A durable bucket file alone must not make an old head advance.
test('post-rename failure leaves old heads authoritative and exact retry adopts orphan nodes', t => {
  const f = fixture(t), first = f.reopen();
  const key = 'r:mat-recording-' + 'a'.repeat(32) + ':1';
  const initialValue = JSON.stringify({ synthetic: true, receipt_evidence: 'legacy_summary' });
  const initial = first.prepare([], [{ key, value: initialValue, replace: false }]);
  first.persist(initial);
  const oldHeads = JSON.parse(JSON.stringify(initial.heads));
  const operationKey = 'o:marc-' + 'b'.repeat(32);
  const changes = [{ key: operationKey, value: JSON.stringify({ synthetic: true, phase: 'complete' }), replace: false }];
  const pending = first.prepare(oldHeads, changes);
  f.loseNextPromotionReply();
  assert.throws(() => first.persist(pending), /SYNTHETIC_POST_RENAME_FAILURE/);
  const cold = f.reopen();
  cold.verify(oldHeads);
  assert.equal(cold.get(oldHeads, key), initialValue);
  assert.equal(cold.get(oldHeads, operationKey), undefined);
  // This is not a committed operation receipt until the caller publishes the
  // new heads; the helper itself does not write an outbox ledger or send HTTP.
  const retry = cold.prepare(oldHeads, changes);
  assert.equal(JSON.stringify(retry), JSON.stringify(pending));
  f.stopLosingReplies();
  cold.persist(retry);
  assert.equal(cold.get(retry.heads, operationKey), changes[0].value);
  assert.equal(cold.get(oldHeads, operationKey), undefined);
  assert.equal(cold.get(oldHeads, key), initialValue);
  assert.equal(fs.existsSync(f.root + '/state.json'), false);
});

test('many revision receipts and watermark replacements survive cold reads of every published snapshot', t => {
  const f = fixture(t), index = f.reopen();
  const id = 'mat-recording-' + 'c'.repeat(32), watermarkKey = 'm:' + id;
  let heads = [];
  const snapshots = [];
  for (let revision = 1; revision <= 40; revision++) {
    const value = JSON.stringify({ synthetic: true, revision, receipt_id: 'synthetic-' + revision });
    const changes = [
      { key: 'r:' + id + ':' + revision, value, replace: false },
      { key: watermarkKey, value: JSON.stringify({ through_revision: revision }), replace: true }
    ];
    const plan = index.prepare(heads, changes);
    index.persist(plan);
    heads = plan.heads;
    snapshots.push({ heads: JSON.parse(JSON.stringify(heads)), revision, value });
  }
  const cold = f.reopen();
  for (const snapshot of snapshots) {
    cold.verify(snapshot.heads);
    assert.equal(cold.get(snapshot.heads, watermarkKey), JSON.stringify({ through_revision: snapshot.revision }));
    assert.equal(cold.get(snapshot.heads, 'r:' + id + ':' + snapshot.revision), snapshot.value);
    assert.equal(cold.get(snapshot.heads, 'r:' + id + ':' + (snapshot.revision + 1)), undefined);
  }
  // Old metadata and payload retention are intentional; this component has no
  // garbage collector and must never advertise that archiving frees disk.
  assert.ok(fs.readdirSync(f.root + '/archive-index').length > heads.length);
  assert.equal(fs.existsSync(f.root + '/state.json'), false);
});
