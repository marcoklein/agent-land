import type { SseEvent } from "./types.js";

export function parseSseEvent(raw: string): SseEvent | null {
  let eventName: string | undefined;
  const dataLines: string[] = [];
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
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const parsed = parseSseEvent(raw);
      if (parsed !== null) events.push(parsed);
    }
    return events;
  }

  flush(): SseEvent[] {
    if (this.buffer.length === 0) return [];
    const parsed = parseSseEvent(this.buffer);
    this.buffer = "";
    return parsed !== null ? [parsed] : [];
  }
}

interface StreamOptions {
  authHeader?: string;
  signal?: AbortSignal;
}

export async function* streamSse(
  url: string,
  { authHeader, signal }: StreamOptions
): AsyncGenerator<SseEvent> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (authHeader) headers.Authorization = authHeader;

  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(`SSE request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const parser = new SseParser();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
      yield ev;
    }
  }
  for (const ev of parser.flush()) {
    yield ev;
  }
}
