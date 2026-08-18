import { streamSse } from "./sse.mjs";
import { createEventRenderer, messageText } from "./render.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dedupe(seen, parsed) {
  if (typeof parsed.seq === "number") {
    if (seen.maxSeq >= 0 && parsed.seq <= seen.maxSeq) return true;
    seen.maxSeq = Math.max(seen.maxSeq, parsed.seq);
  }
  return false;
}

export async function runSession(
  client,
  sessionId,
  { verbose = false, timeoutMs = 0, out = process.stdout, onDialog = null, stream = streamSse } = {}
) {
  const renderer = createEventRenderer();
  const seen = { maxSeq: -1 };
  let finalMessage = "";
  let settled = false;
  let stopped = false;
  let timedOut = false;
  let ac = new AbortController();
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
        if (dedupe(seen, parsed)) continue;

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
          await client.respond(sessionId, parsed.requestId, value);
        }
        if (verbose) {
          for (const line of renderer.render(parsed)) out.write(line.text + "\n");
        } else {
          renderer.render(parsed);
        }
      }
    } catch (err) {
      if (err && err.name === "AbortError") timedOut = true;
    }
    if (settled || stopped || timedOut) break;
    await sleep(1000);
    ac = new AbortController();
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
  const seen = { maxSeq: -1 };

  while (true) {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const ev of stream(url, { authHeader: client.authHeader, signal: ac.signal })) {
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
        if (dedupe(seen, parsed)) continue;
        if (parsed.type === "agent_settled") {
          out.write(`${sessionId}: settled\n`);
        }
        if (parsed.type === "status" && parsed.status === "stopped") {
          out.write(`${sessionId}: stopped\n`);
          return;
        }
      }
    } catch {
      if (signal && signal.aborted) return;
    }
    await sleep(1000);
  }
}
