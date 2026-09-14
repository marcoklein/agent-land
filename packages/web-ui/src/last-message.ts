import type { SessionEvent } from "@agent-land/contracts";
import type { SseEvent, StreamFn } from "./sse.js";
import { streamSse } from "./sse.js";

export function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { content?: unknown };
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n");
}

export function createSeqFilter() {
  const seen = { maxSeq: -1 };
  return (parsed: SessionEvent): boolean => {
    const ev = parsed as SessionEvent & { seq?: number };
    if (typeof ev.seq === "number") {
      if (seen.maxSeq >= 0 && ev.seq <= seen.maxSeq) return true;
      seen.maxSeq = Math.max(seen.maxSeq, ev.seq);
    }
    return false;
  };
}

export function lastAssistantText(events: Iterable<SessionEvent>): string {
  let streaming = "";
  let last = "";
  for (const ev of events) {
    if (ev.type === "turn_start") {
      streaming = "";
    } else if (ev.type === "message_delta") {
      streaming += ev.text ?? "";
    } else if (ev.type === "message_end") {
      const text = messageText(ev.message) || streaming;
      if (text) last = text;
      streaming = "";
    } else if (ev.type === "agent_settled") {
      if (!last && streaming) last = streaming;
      streaming = "";
    } else if (ev.type === "turn_end") {
      streaming = "";
    }
  }
  return last;
}

export interface SessionStatusResult {
  lastMessage: string;
}

export async function getSessionStatus(
  eventsUrl: (id: string) => string,
  authHeader: string | undefined,
  sessionId: string,
  opts: { stream?: StreamFn; quietMs?: number } = {}
): Promise<SessionStatusResult> {
  const stream = opts.stream ?? streamSse;
  const quietMs = opts.quietMs ?? 500;

  const dedupe = createSeqFilter();
  const events: SessionEvent[] = [];
  const ac = new AbortController();
  let stop = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleQuietStop = () => {
    if (stop) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      stop = true;
      ac.abort();
    }, quietMs);
  };

  scheduleQuietStop();

  try {
    for await (const ev of stream(eventsUrl(sessionId), {
      authHeader,
      signal: ac.signal,
    })) {
      if (ev.event === "agent-done") break;
      if (ev.data === undefined) continue;
      let parsed: SessionEvent;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (dedupe(parsed)) continue;
      events.push(parsed);
      scheduleQuietStop();
    }
  } catch (err) {
    if (!stop) throw err;
  } finally {
    if (quietTimer) clearTimeout(quietTimer);
  }

  return { lastMessage: lastAssistantText(events) };
}

export function createLastMessageCache() {
  const cache = new Map<string, { updatedAt: string; message: string }>();

  return {
    get(id: string, updatedAt: string): string | null {
      const entry = cache.get(id);
      if (entry && entry.updatedAt === updatedAt) return entry.message;
      return null;
    },
    set(id: string, updatedAt: string, message: string): void {
      cache.set(id, { updatedAt, message });
    },
  };
}