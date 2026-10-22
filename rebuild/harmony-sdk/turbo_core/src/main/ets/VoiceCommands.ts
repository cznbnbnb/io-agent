export function recorder(start: boolean): string { return start ? '{"rc":1}' : '{"rc":2}'; }
// Bound by UTF-16 units without splitting surrogate pairs, including emoji.
export function voiceChunks(text: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 2 || limit > 100) throw new Error('chunk-limit');
  const out: string[] = []; let chunk = '';
  for (const char of Array.from(text)) {
    if (chunk.length + char.length > limit) { out.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) out.push(chunk);
  return out;
}
export function transcript(text: string, final: boolean): string {
  if (!text || text.length > 100) throw new Error('transcript-size');
  return `{"text":${JSON.stringify(text)},"final":${final}}`;
}
export function answerChunk(text: string, sid: string, query: string, timestamp: number): string {
  if (!/^[a-f0-9]{32}$/.test(sid) || !text || text.length > 24 || query.length > 16 || !Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('answer-input');
  return `{"sub":"workflow","vendor":"turboio","uuid":"${sid}","sid":"${sid}","round":-1,"timestamp":${timestamp},"query":${JSON.stringify(query)},"domain":"chat","intent":"chat","payload":{},"offline":false,"answer":{"text":${JSON.stringify(text)},"isFinal":false}}`;
}
export function asrRunTask(task: string, model: string): string {
  if (!/^[a-f0-9]{32}$/.test(task) || !/^[a-zA-Z0-9._-]{1,128}$/.test(model)) throw new Error('asr-input');
  return `{"header":{"action":"run-task","task_id":"${task}","streaming":"duplex"},"payload":{"task_group":"audio","task":"asr","function":"recognition","model":${JSON.stringify(model)},"parameters":{"format":"pcm","sample_rate":16000},"input":{}}}`;
}
