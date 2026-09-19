export const RUNNER_PROTOCOL_VERSION = 1;

export function encodeMessage(message) {
  return JSON.stringify({ v: RUNNER_PROTOCOL_VERSION, ...message });
}

export function decodeMessage(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.v !== RUNNER_PROTOCOL_VERSION) {
    throw new Error(`unsupported runner protocol version: ${parsed.v}`);
  }
  const { v, ...message } = parsed;
  return message;
}
