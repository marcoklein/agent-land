import { streamSse } from "./sse.js";
import { messageText } from "./render.js";
import { createSeqFilter, type StreamFn } from "./ops.js";
import type { AgentEvent, Session } from "./types.js";

export interface SessionStatusResult {
  session: Session;
  lastMessage: string;
}

export interface StatusClient {
  getSession: (id: string) => Promise<{ session: Session }>;
  eventsUrl: (id: string) => string;
  authHeader?: string;
}

/** Pure reducer: last completed assistant message, runSession-style fallback. */
export function lastAssistantText(events: Iterable<AgentEvent>): string {
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

/** Fetch the record, replay the stream once, return record + last message. */
export async function getSessionStatus(
  client: StatusClient,
  sessionId: string,
  { stream = streamSse }: { stream?: StreamFn } = {}
): Promise<SessionStatusResult> {
  const { session } = await client.getSession(sessionId);

  const dedupe = createSeqFilter();
  const events: AgentEvent[] = [];
  const ac = new AbortController();
  let stop = false;
  let quietTimer: NodeJS.Timeout | null = null;

  const scheduleQuietStop = () => {
    if (stop) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      stop = true;
      ac.abort();
    }, 500);
  };

  // Arm up front so a live session with an empty history cannot stream forever.
  scheduleQuietStop();

  try {
    for await (const ev of stream(client.eventsUrl(sessionId), {
      authHeader: client.authHeader,
      signal: ac.signal,
    })) {
      if (ev.event === "agent-done") break;
      if (ev.data === undefined) continue;
      let parsed: AgentEvent;
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

  return { session, lastMessage: lastAssistantText(events) };
}

export function formatStatus(result: SessionStatusResult): string[] {
  const { session, lastMessage } = result;
  const lines: string[] = [];

  lines.push(`${session.id}  ${session.status}`);

  const mounts =
    session.mounts && session.mounts.length
      ? session.mounts.map((m) => `${m.source}:${m.target}`).join(", ")
      : "(none)";
  lines.push(`mounts: ${mounts}`);

  const connectors =
    session.connectors && session.connectors.length
      ? session.connectors.join(", ")
      : "(none)";
  lines.push(`connectors: ${connectors}`);

  const provider = session.provider ? `${session.provider}/` : "";
  lines.push(`model: ${provider}${session.model}`);

  lines.push(`created: ${session.createdAt}`);
  lines.push(`updated: ${session.updatedAt}`);
  lines.push(`last message: ${lastMessage || "(none)"}`);

  if (session.waitingFor) {
    const prompt = session.waitingFor.prompt ? ` — ${session.waitingFor.prompt}` : "";
    lines.push(`waiting for: ${session.waitingFor.method}${prompt}`);
  }

  return lines;
}

export function statusJson(result: SessionStatusResult): string {
  return JSON.stringify({ session: result.session, lastMessage: result.lastMessage }, null, 2) + "\n";
}
