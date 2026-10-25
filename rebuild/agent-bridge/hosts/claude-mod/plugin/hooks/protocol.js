export const MOD_NAME = 'io-agent-session-bridge';
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const stamp = id => `[iO operation ${id}]\n`;
export function reservedBridgeText(text) {
  return typeof text === 'string' && (text.startsWith('[iO operation ') ||
    text.startsWith(`The ${MOD_NAME} plugin sent a message:\n`));
}
// Observed in the actual 2.1.308 stream-json turn, not guessed from a marker
// search. Only the entire authenticated input with this exact host wrapper is
// accepted; added text or a changed attribution deliberately fails closed.
export function matchesBoundTurn(text, pendingText) {
  if (typeof text !== 'string' || typeof pendingText !== 'string') return false;
  return text === pendingText || text === `The ${MOD_NAME} plugin sent a message:\n${pendingText}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.`;
}
export function validateConnection(value) {
  return object(value) && value.schema_version === 1 && uuid(value.session_id) &&
    typeof value.cwd === 'string' && value.cwd.startsWith('/') &&
    typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token) &&
    typeof value.url === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.url);
}
export function validateAction(action, connection) {
  if (!object(action) || !uuid(action.operation_id) || action.session_id !== connection.session_id || action.cwd !== connection.cwd) return false;
  if (action.kind === 'abort') return typeof action.turn_id === 'string' && action.turn_id.length > 0 && action.turn_id.length <= 160;
  return action.kind === 'submit' && typeof action.text === 'string' && action.text.trim().length > 0 &&
    action.text.length <= 32768 && typeof action.expires_at === 'string' && Number.isFinite(Date.parse(action.expires_at));
}
export function parseOperation(text) {
  if (typeof text !== 'string') return null;
  const match = /^\[iO operation ([a-f0-9-]{36})\]\n/.exec(text);
  return match && uuid(match[1]) ? match[1] : null;
}
