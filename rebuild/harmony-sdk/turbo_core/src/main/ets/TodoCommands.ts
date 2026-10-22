// Cached official Android sendDeleteEvents: business 22 / type 7. This is a
// single, explicitly selected TODO only; no batch or clear-all form is enabled.
export function todoDeleteCommand(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('todo-delete-id');
  return `{"eventType":1,"scheduleTotal":0,"todoTotal":1,"eventIDList":[${id}]}`;
}

// Input is the JSON field of an already parsed business envelope. The allowed
// document contains ASCII keys/numbers only, so reject non-ASCII/escaped keys
// and duplicate key spellings before JSON.parse can collapse them.
export function isSingleTodoDeleteJson(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes.length > 192) return false;
  let text = '';
  for (const byte of bytes) {
    if (byte > 127 || byte === 92 || (byte < 32 && ![9,10,13].includes(byte))) return false;
    text += String.fromCharCode(byte);
  }
  try {
    const body = JSON.parse(text) as Record<string, Object>;
    if (!body || Array.isArray(body) || typeof body !== 'object') return false;
    const keys = Object.keys(body), allowed = ['eventType','scheduleTotal','todoTotal','eventIDList'];
    const spelled = text.match(/"[A-Za-z]+"\s*:/g);
    if (keys.length !== 4 || !keys.every((key: string): boolean => allowed.includes(key)) || spelled === null || spelled.length !== 4) return false;
    const ids = body['eventIDList'] as Object[];
    return body['eventType'] === 1 && body['scheduleTotal'] === 0 && body['todoTotal'] === 1 &&
      Array.isArray(ids) && ids.length === 1 && Number.isSafeInteger(ids[0]) && Number(ids[0]) > 0;
  } catch (_) { return false; }
}
