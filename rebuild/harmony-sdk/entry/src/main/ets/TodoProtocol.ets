import { util } from '@kit.ArkTS';
import { readLauncherEnvelope } from 'turbo_core';

// Strict support for the cached official Android schema audited on 2026-10-16
// and the top-level batch profile referenced by OpenRayneo 2449baaf8575.
// Unknown/new fields are not silently treated as a complete query. Receipt and
// full-query completion are observations, never proof of device-side deletion.
export class TodoDeleteFailure {
  eventID: number|null = null; errorCode: number|null = null; errorMessage: string|null = null;
}
export class TodoDeleteReceipt {
  sourceType: number = 0; successCount: number = 0;
  chunkId: number|null = null; scheduleTotal: number|null = null; todoTotal: number|null = null;
  failList: TodoDeleteFailure[]|null = null;
}
export class TodoQueryItem {
  eventType: number = 0; eventID: number = 0; status: number|null = null;
  createTime: number|null = null; lastModifiedTime: number|null = null;
  isImportant: boolean|number|null = null; title: string|null = null;
  offlineCompletedModifiedTime: number|null = null;
}
export class TodoQueryChunk {
  chunkId: number|null = null; batchNo: number|null = null;
  isLastBatch: boolean|null = null; currentItems: number|null = null;
}
export class TodoQueryBatch {
  scheduleTotal: number|null = null; todoTotal: number|null = null; batchNo: number|null = null;
  isLastBatch: boolean|null = null; needFullData: boolean|null = null;
  chunkInfo: TodoQueryChunk|null = null; dataList: TodoQueryItem[]|null = null;
  offlineCompletedModifiedTime: number|null = null;
}
export class TodoQueryObservation {
  phase: string = 'collecting'; note: string = '等待完整待办查询观察'; batches: number = 0; items: number = 0;
  todo_ids: number[] = []; todo_total: number|null = null; schedule_total: number|null = null;
}

function record(value: Object): Record<string,Object> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('todo-json-object');
  return value as Record<string,Object>;
}
function keys(value: Record<string,Object>, allowed: string[]): void {
  if (Object.keys(value).some((key: string): boolean => !allowed.includes(key))) throw new Error('todo-json-field');
}
function integer(value: Record<string,Object>, key: string, max: number, required: boolean = false): number|null {
  const item = value[key];
  if (item === undefined || item === null) { if (required) throw new Error('todo-json-integer'); return null; }
  if (typeof item !== 'number' || !Number.isSafeInteger(item) || Number(item) < 0 || Number(item) > max) throw new Error('todo-json-integer');
  return Number(item);
}
function booleanValue(value: Record<string,Object>, key: string): boolean|null {
  const item = value[key];
  if (item === undefined || item === null) return null;
  if (typeof item !== 'boolean') throw new Error('todo-json-boolean');
  return item as boolean;
}
function stringValue(value: Record<string,Object>, key: string, max: number): string|null {
  const item = value[key];
  if (item === undefined || item === null) return null;
  if (typeof item !== 'string' || (item as string).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item as string)) throw new Error('todo-json-text');
  const text = item as string;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('todo-json-text'); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('todo-json-text');
  }
  return text;
}
class KeyScope { object: boolean = false; needKey: boolean = false; seen: string[] = []; }
// JSON.parse alone collapses duplicate keys, including escaped spellings. Scan
// key tokens at their actual nesting level before accepting the parsed object.
function uniqueKeys(text: string): void {
  const stack: KeyScope[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i++; let closed = false;
      for (; i < text.length; i++) { if (text[i] === '\\') i++; else if (text[i] === '"') { closed = true; break; } }
      if (!closed) throw new Error('todo-json-string');
      const scope = stack.length ? stack[stack.length - 1] : null;
      if (scope !== null && scope.object && scope.needKey) {
        const key = JSON.parse(text.slice(start,i + 1)) as string;
        if (scope.seen.includes(key)) throw new Error('todo-json-duplicate');
        scope.seen.push(key); scope.needKey = false;
      }
    } else if (char === '{' || char === '[') {
      if (stack.length >= 8) throw new Error('todo-json-depth');
      const scope = new KeyScope(); scope.object = char === '{'; scope.needKey = scope.object; stack.push(scope);
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.length && stack[stack.length - 1].object) stack[stack.length - 1].needKey = true;
  }
}
function envelopeJson(bytes: Uint8Array, type: number): Record<string,Object> {
  const envelope = readLauncherEnvelope(bytes);
  try {
    if (envelope.type !== type || envelope.binary.length || envelope.json.length < 2 || envelope.json.length > 15000) throw new Error('todo-envelope');
    const text = new util.TextDecoder('utf-8',{fatal:true}).decodeToString(envelope.json);
    const encoded = new util.TextEncoder().encodeInto(text);
    try { if (encoded.length !== envelope.json.length || !encoded.every((byte: number,index: number): boolean => byte === envelope.json[index])) throw new Error('todo-json-utf8'); }
    finally { encoded.fill(0); }
    uniqueKeys(text); return record(JSON.parse(text) as Object);
  } finally { envelope.json.fill(0); envelope.binary.fill(0); }
}
export function parseTodoDeleteReceipt(bytes: Uint8Array): TodoDeleteReceipt|null {
  try {
    const json = envelopeJson(bytes,14); keys(json,['sourceType','chunkId','scheduleTotal','todoTotal','successCount','failList']);
    const result = new TodoDeleteReceipt();
    result.sourceType = integer(json,'sourceType',65535,true) as number;
    result.successCount = integer(json,'successCount',400,true) as number;
    result.chunkId = integer(json,'chunkId',Number.MAX_SAFE_INTEGER);
    result.scheduleTotal = integer(json,'scheduleTotal',200); result.todoTotal = integer(json,'todoTotal',200);
    const list = json['failList'];
    if (list !== undefined && list !== null) {
      if (!Array.isArray(list) || list.length > 200) throw new Error('todo-receipt-list');
      const items = list as Object[];
      result.failList = []; const ids: number[] = [];
      for (const item of items) {
        const row = record(item); keys(row,['eventID','errorCode','errorMessage']); const failure = new TodoDeleteFailure();
        failure.eventID = integer(row,'eventID',Number.MAX_SAFE_INTEGER);
        if (failure.eventID !== null) { if (failure.eventID < 1 || ids.includes(failure.eventID)) throw new Error('todo-receipt-id'); ids.push(failure.eventID); }
        failure.errorCode = integer(row,'errorCode',2147483647); failure.errorMessage = stringValue(row,'errorMessage',512); result.failList.push(failure);
      }
    }
    return result;
  } catch (_) { return null; }
}
function queryRecord(json: Record<string,Object>): TodoQueryBatch {
  keys(json,['scheduleTotal','todoTotal','batchNo','isLastBatch','needFullData','chunkInfo','dataList','offlineCompletedModifiedTime']);
  const result = new TodoQueryBatch();
  result.scheduleTotal = integer(json,'scheduleTotal',200); result.todoTotal = integer(json,'todoTotal',200);
  result.batchNo = integer(json,'batchNo',64); result.isLastBatch = booleanValue(json,'isLastBatch'); result.needFullData = booleanValue(json,'needFullData');
  result.offlineCompletedModifiedTime = integer(json,'offlineCompletedModifiedTime',Number.MAX_SAFE_INTEGER);
  const chunk = json['chunkInfo'];
  if (chunk !== undefined && chunk !== null) {
    const row = record(chunk); keys(row,['chunkId','batchNo','isLastBatch','currentItems']);
    // Actual iO type16 replies observed on 0.1.99 use {} for no chunk metadata.
    // Only an empty object normalizes to absent; a present partial chunk still
    // reaches the accumulator's strict completeness/consistency checks.
    if (Object.keys(row).length > 0) {
      result.chunkInfo = new TodoQueryChunk(); result.chunkInfo.chunkId = integer(row,'chunkId',Number.MAX_SAFE_INTEGER);
      result.chunkInfo.batchNo = integer(row,'batchNo',64); result.chunkInfo.isLastBatch = booleanValue(row,'isLastBatch');
      result.chunkInfo.currentItems = integer(row,'currentItems',400);
    }
  }
  const list = json['dataList'];
  if (list !== undefined && list !== null) {
    if (!Array.isArray(list) || list.length > 400) throw new Error('todo-query-list'); result.dataList = [];
    const items = list as Object[];
    for (const item of items) {
      const row = record(item); keys(row,['eventType','eventID','status','createTime','lastModifiedTime','isImportant','title','offlineCompletedModifiedTime']);
      const entry = new TodoQueryItem(); entry.eventType = integer(row,'eventType',1,true) as number;
      entry.eventID = integer(row,'eventID',Number.MAX_SAFE_INTEGER,true) as number;
      if (entry.eventID < 1) throw new Error('todo-query-id');
      entry.status = integer(row,'status',1); entry.createTime = integer(row,'createTime',Number.MAX_SAFE_INTEGER);
      entry.lastModifiedTime = integer(row,'lastModifiedTime',Number.MAX_SAFE_INTEGER); entry.title = stringValue(row,'title',1024);
      entry.offlineCompletedModifiedTime = integer(row,'offlineCompletedModifiedTime',Number.MAX_SAFE_INTEGER);
      const important = row['isImportant'];
      if (important !== undefined && important !== null) {
        if (typeof important === 'boolean') entry.isImportant = important as boolean;
        else entry.isImportant = integer(row,'isImportant',1);
      }
      result.dataList.push(entry);
    }
  }
  return result;
}
export function parseTodoQueryBatch(bytes: Uint8Array): TodoQueryBatch|null {
  try { return queryRecord(envelopeJson(bytes,16)); } catch (_) { return null; }
}

// Rejection diagnostics contain schema keys/types only. Never include primitive
// field values, error messages from the peer, row titles, IDs or speech text.
function queryValueShape(value: Object|null|undefined): string {
  if (value === undefined) return 'missing'; if (value === null) return 'null';
  if (Array.isArray(value)) return 'a';
  if (typeof value === 'number') return Number.isSafeInteger(value) && Number(value) >= 0 ? 'n' : 'n!';
  if (typeof value === 'string') return 's'; if (typeof value === 'boolean') return 'b';
  return 'o';
}
function queryRecordShape(value: Object|null|undefined): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return queryValueShape(value);
  const row = value as Record<string,Object>, names = Object.keys(row);
  const parts: string[] = [];
  for (const key of names.slice(0,16)) {
    parts.push((/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key) ? key : '?') + ':' + queryValueShape(row[key]));
  }
  return '[' + parts.join(',') + (names.length > 16 ? ',more' : '') + ']';
}
export function describeTodoQueryBatch(bytes: Uint8Array): string {
  try {
    const row = envelopeJson(bytes,16); let rejection = 'batch-integrity';
    try { queryRecord(row); } catch (error) {
      const code = (error as Error).message;
      if (['todo-json-object','todo-json-field','todo-json-integer','todo-json-boolean','todo-json-text','todo-query-list','todo-query-id'].includes(code)) rejection = code;
      else rejection = 'schema-rejected';
    }
    const list = row['dataList']; let first: Object|null = null;
    if (Array.isArray(list) && list.length) first = (list as Object[])[0];
    return ('待办查询不完整；reject=' + rejection + ';root=' + queryRecordShape(row) +
      ';chunk=' + queryRecordShape(row['chunkInfo']) + ';row=' + queryRecordShape(first)).slice(0,480);
  } catch (_) {
    try {
      const envelope = readLauncherEnvelope(bytes);
      try { return `待办查询不完整；envelope type=${envelope.type},jsonBytes=${envelope.json.length},binaryBytes=${envelope.binary.length}`; }
      finally { envelope.json.fill(0); envelope.binary.fill(0); }
    } catch (_) { return '待办查询不完整；envelope rejected'; }
  }
}

export class TodoQueryAccumulator {
  private observation: TodoQueryObservation = new TodoQueryObservation();
  private seenBatches: string[] = []; private firstBatch: number = -1; private chunkId: number = -1;
  private seenItems: string[] = []; private todoIds: number[] = []; private scheduleItems: number = 0;
  private retainedBytes: number = 0; private profile: string = ''; private todoOnly: boolean = false;
  constructor(todoOnly: boolean = false) { this.todoOnly = todoOnly; }
  snapshot(): TodoQueryObservation {
    const result = new TodoQueryObservation(); result.phase = this.observation.phase; result.note = this.observation.note;
    result.batches = this.observation.batches; result.items = this.observation.items;
    result.todo_total = this.observation.todo_total; result.schedule_total = this.observation.schedule_total;
    result.todo_ids = this.observation.phase === 'complete' ? this.todoIds.slice().sort((a: number,b: number): number => a - b) : [];
    return result;
  }
  invalidate(reason: string = 'invalid-batch'): TodoQueryObservation {
    this.observation.phase = 'incomplete';
    this.observation.note = reason === 'timeout' ? '待办查询超时，未取得完整观察' : reason === 'disconnected' ? '连接中断，未取得完整待办观察' : '待办查询不完整或存在冲突，不能判断缺失';
    this.seenBatches = []; this.seenItems = []; this.todoIds = []; this.retainedBytes = 0;
    return this.snapshot();
  }
  add(input: TodoQueryBatch): TodoQueryObservation {
    if (this.observation.phase === 'incomplete') return this.snapshot();
    try {
      // Revalidate/copy public DTO input; caller mutations never alter retained
      // query state, and bypassing the wire parser grants no extra authority.
      const batch = queryRecord(record(input as Object)), chunk = batch.chunkInfo;
      if (batch.scheduleTotal === null || batch.todoTotal === null || batch.batchNo === null || batch.isLastBatch === null ||
        batch.needFullData !== true || batch.dataList === null) return this.invalidate();
      // Some firmware uses only the root batch fields. A present chunk must be
      // complete and consistent; profiles cannot change within a query.
      const profile = chunk === null ? 'top' : 'chunk';
      if (chunk !== null && (chunk.chunkId === null || chunk.batchNo === null || chunk.isLastBatch === null ||
        chunk.currentItems === null || chunk.batchNo !== batch.batchNo || chunk.isLastBatch !== batch.isLastBatch ||
        chunk.currentItems !== batch.dataList.length)) return this.invalidate();
      if (this.profile !== '' && this.profile !== profile) return this.invalidate();
      const canonical = JSON.stringify(batch);
      if (this.firstBatch >= 0 && batch.batchNo >= this.firstBatch && batch.batchNo < this.firstBatch + this.seenBatches.length) {
        return this.seenBatches[batch.batchNo - this.firstBatch] === canonical ? this.snapshot() : this.invalidate();
      }
      if (this.observation.phase === 'complete' || this.seenBatches.length >= 64 || this.retainedBytes + canonical.length * 3 > 262144) return this.invalidate();
      if (this.firstBatch < 0) {
        if (batch.batchNo !== 0 && batch.batchNo !== 1) return this.invalidate();
        this.firstBatch = batch.batchNo; this.profile = profile; this.chunkId = chunk === null ? -1 : chunk.chunkId as number;
        this.observation.todo_total = batch.todoTotal; this.observation.schedule_total = batch.scheduleTotal;
      } else if (batch.batchNo !== this.firstBatch + this.seenBatches.length || (chunk !== null && chunk.chunkId !== this.chunkId) ||
        batch.todoTotal !== this.observation.todo_total || batch.scheduleTotal !== this.observation.schedule_total) return this.invalidate();
      for (const item of batch.dataList) {
        if (this.todoOnly && item.eventType !== 1) return this.invalidate();
        const key = `${item.eventType}:${item.eventID}`;
        if (this.seenItems.includes(key) || this.seenItems.length >= 400) return this.invalidate();
        this.seenItems.push(key); if (item.eventType === 1) this.todoIds.push(item.eventID); else this.scheduleItems++;
      }
      if (this.todoIds.length > batch.todoTotal || this.scheduleItems > batch.scheduleTotal) return this.invalidate();
      this.seenBatches.push(canonical); this.retainedBytes += canonical.length * 3;
      this.observation.batches = this.seenBatches.length; this.observation.items = this.seenItems.length;
      if (batch.isLastBatch) {
        // eventType=1 requests todos only. scheduleTotal can describe the
        // unrelated catalogue; it cannot imply schedule rows were returned.
        if (this.todoIds.length !== batch.todoTotal || (!this.todoOnly && this.scheduleItems !== batch.scheduleTotal)) return this.invalidate();
        this.observation.phase = 'complete'; this.observation.note = '本轮查询观察完整；未见某条不等于设备已确认删除';
      }
      return this.snapshot();
    } catch (_) { return this.invalidate(); }
  }
}
