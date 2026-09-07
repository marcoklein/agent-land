import process from "node:process";
import { streamSse } from "./sse.js";
import { createEventRenderer } from "./render.js";
import { createSeqFilter, type StreamFn } from "./ops.js";
import type { AgentEvent } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LogClient {
  eventsUrl: (id: string) => string;
  authHeader?: string;
}

export interface LogOptions {
  json?: boolean;
  follow?: boolean;
  out?: { write: (text: string) => void };
  stream?: StreamFn;
}

export async function logSession(
  client: LogClient,
  sessionId: string,
  opts: LogOptions = {}
): Promise<void> {
  const { json = false, follow = false, out = process.stdout, stream = streamSse } = opts;
  const renderer = createEventRenderer();
  const dedupe = createSeqFilter();
  let stop = false;
  let ac: AbortController | null = null;
  let quietTimer: NodeJS.Timeout | null = null;

  const onSigint = () => {
    stop = true;
    if (ac) ac.abort();
  };
  process.on("SIGINT", onSigint);

  const scheduleQuietStop = () => {
    if (follow || stop) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      stop = true;
      if (ac) ac.abort();
    }, 500);
  };

  while (!stop) {
    ac = new AbortController();
    let done = false;
    try {
      for await (const ev of stream(client.eventsUrl(sessionId), {
        authHeader: client.authHeader,
        signal: ac.signal,
      })) {
        if (ev.event === "agent-done") {
          done = true;
          break;
        }
        if (ev.data === undefined) continue;
        let parsed: AgentEvent;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (dedupe(parsed)) continue;
        if (json) {
          out.write(JSON.stringify(parsed) + "\n");
        } else {
          for (const line of renderer.render(parsed)) out.write(line.text + "\n");
        }
        scheduleQuietStop();
      }
    } catch {
      if (stop) break;
    }
    if (done || !follow || stop) break;
    await sleep(1000);
  }
  if (quietTimer) clearTimeout(quietTimer);
  process.removeListener("SIGINT", onSigint);
}
