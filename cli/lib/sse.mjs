export function parseSseEvent(raw) {
  let eventName;
  const dataLines = [];
  let hasData = false;

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      hasData = true;
    }
  }

  if (!hasData && !eventName) return null;
  return { event: eventName, data: hasData ? dataLines.join("\n") : undefined };
}

export class SseParser {
  constructor() {
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk;
    const events = [];
    let idx;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseSseEvent(raw);
      if (parsed !== null) events.push(parsed);
    }
    return events;
  }
}

export async function* streamSse(url, { authHeader, signal }) {
  const headers = { Accept: "text/event-stream" };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    throw new Error(`SSE request failed: HTTP ${res.status}`);
  }

  const parser = new SseParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
      yield ev;
    }
  }
}
