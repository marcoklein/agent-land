import { streamSse } from "./sse.mjs";
import { createEventRenderer, messageText } from "./render.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSeqFilter() {
  const seen = { maxSeq: -1 };
  return (parsed) => {
    if (typeof parsed.seq === "number") {
      if (seen.maxSeq >= 0 && parsed.seq <= seen.maxSeq) return true;
      seen.maxSeq = Math.max(seen.maxSeq, parsed.seq);
    }
    return false;
  };
}

export async function runSession(
  client,
  sessionId,
  { verbose = false, timeoutMs = 0, out = process.stdout, onDialog = null, stream = streamSse } = {}
) {
  const renderer = createEventRenderer();
  const dedupe = createSeqFilter();
  let finalMessage = "";
  let settled = false;
  let stopped = false;
  let timedOut = false;

  const ac = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ac.abort(), timeoutMs) : null;

  while (true) {
    try {
      for await (const ev of stream(client.eventsUrl(sessionId), {
        authHeader: client.authHeader,
        signal: ac.signal,
      })) {
        if (ev.event === "agent-done") {
          stopped = true;
          break;
        }
        if (ev.data === undefined) continue;
        let parsed;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (dedupe(parsed)) continue;

        if (parsed.type === "message_end") {
          finalMessage = messageText(parsed.message) || renderer.state.streamingText;
        }
        if (parsed.type === "agent_settled") {
          settled = true;
          finalMessage = finalMessage || renderer.state.streamingText;
          break;
        }
        if (parsed.type === "status" && parsed.status === "stopped") {
          stopped = true;
          break;
        }
        if (parsed.type === "waiting_for_input") {
          if (!onDialog) {
            stopped = true;
            break;
          }
          const value = await onDialog(parsed);
          if (value === null) {
            stopped = true;
            break;
          }
          try {
            await client.respond(sessionId, parsed.requestId, value);
          } catch (err) {
            throw new Error(`respond failed: ${err.message}`);
          }
        }
        if (verbose) {
          for (const line of renderer.render(parsed)) out.write(line.text + "\n");
        } else {
          renderer.render(parsed);
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        timedOut = true;
      } else {
        throw err;
      }
    }
    if (settled || stopped || timedOut) break;
    if (ac.signal.aborted) {
      timedOut = true;
      break;
    }
    await sleep(1000);
  }

  if (timer) clearTimeout(timer);
  return { settled, stopped, timedOut, finalMessage };
}

export async function watchSession(
  client,
  sessionId,
  { out = process.stdout, live = true, stream = streamSse, signal = null } = {}
) {
  const url = client.eventsUrl(sessionId) + (live ? "?live=1" : "");
  const dedupe = createSeqFilter();

  while (true) {
    try {
      for await (const ev of stream(url, { authHeader: client.authHeader, signal })) {
        if (ev.event === "agent-done") {
          out.write(`${sessionId}: stopped\n`);
          return;
        }
        if (ev.data === undefined) continue;
        let parsed;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (dedupe(parsed)) continue;
        if (parsed.type === "agent_settled") {
          out.write(`${sessionId}: settled\n`);
        }
        if (parsed.type === "status" && parsed.status === "stopped") {
          out.write(`${sessionId}: stopped\n`);
          return;
        }
      }
    } catch (err) {
      if (signal && signal.aborted) return;
      if (err && typeof err.status === "number" && err.status >= 400 && err.status < 500) {
        throw err;
      }
    }
    await sleep(1000);
  }
}
