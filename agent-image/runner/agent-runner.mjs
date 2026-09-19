import { spawn } from "node:child_process";
import { RunnerClient } from "./transport.mjs";
import { createRpcLineParser, mapRpcEvent } from "./pi-rpc.mjs";
import { Spool } from "./spool.mjs";

const baseUrl = process.env.AGENT_LAND_URL;
const auth = process.env.AGENT_LAND_BASIC_AUTH;
const sessionId = process.env.AGENT_LAND_SESSION_ID;
const piArgv = JSON.parse(process.env.AGENT_RUNNER_PI_ARGV || "[]");

if (!baseUrl || !auth || !sessionId || piArgv.length === 0) {
  console.error("runner: missing AGENT_LAND_URL / AGENT_LAND_BASIC_AUTH / AGENT_LAND_SESSION_ID / AGENT_RUNNER_PI_ARGV");
  process.exit(2);
}

const spool = new Spool();
const client = new RunnerClient(baseUrl, auth, sessionId);

let seq = 0;
let pi = null;

const nextSeq = () => ++seq;

const sendEvent = (event) => {
  const s = nextSeq();
  spool.append(s, event);
  client
    .post({ type: "event", seq: s, event })
    .then((res) => {
      if (res && typeof res.ack === "number") spool.trimTo(res.ack);
    })
    .catch(() => {});
};

const sendCommandResult = (id, ok, error) => {
  client.post({ type: "command_result", id, ok, error }).catch(() => {});
};

const startPi = () => {
  pi = spawn(piArgv[0], piArgv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });

  const accumulated = { text: "" };
  const parser = createRpcLineParser((line) => {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    if (!raw || typeof raw.type !== "string") return;
    const mapped = mapRpcEvent(raw, accumulated);
    if (Array.isArray(mapped)) {
      for (const e of mapped) sendEvent(e);
    } else if (mapped) {
      sendEvent(mapped);
    }
  });

  pi.stdout.on("data", (chunk) => parser.push(chunk));
  pi.stdout.on("end", () => parser.flush());
  pi.stderr.on("data", () => {});
  pi.on("exit", () => sendEvent({ type: "status", status: "stopped" }));
};

client.onMessage((message) => {
  switch (message.type) {
    case "command": {
      try {
        const { id, name, payload } = message;
        if (name === "prompt") {
          const cmd = { type: "prompt", message: payload?.message };
          if (payload?.behavior) cmd.streamingBehavior = payload.behavior;
          pi.stdin.write(JSON.stringify(cmd) + "\n");
        } else if (name === "respond") {
          pi.stdin.write(JSON.stringify({ type: "extension_ui_response", id: payload?.requestId, ...payload }) + "\n");
        } else if (name === "abort") {
          pi.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
        }
        sendCommandResult(id, true);
      } catch (err) {
        sendCommandResult(message.id, false, String(err));
      }
      break;
    }
    case "registered": {
      const replay = spool.replayFrom(message.resumeFromSeq ?? 1);
      if (replay.length > 0) {
        client.post({ type: "event_batch", events: replay }).catch(() => {});
      }
      break;
    }
    default:
      break;
  }
});

const RECONNECT_DELAY_MS = 2000;
const REGISTER_ATTEMPTS = 10;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function register() {
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt++) {
    try {
      await client.post({
        type: "register",
        sessionId,
        runnerVersion: "0.1.0",
        protocolVersion: 1,
        lastAckedSeq: spool.lastAckedSeq,
      });
      return;
    } catch {
      await delay(RECONNECT_DELAY_MS);
    }
  }
}

async function runChannel() {
  for (;;) {
    let opened = false;
    try {
      await client.open();
      opened = true;
    } catch {
      // control plane unreachable — retry
    }
    if (opened) await register();
    if (opened) {
      // Reconnect after the stream drops; `registered` on the next hop replays
      // the unacked spool from the resume seq the control plane reports.
      await client.waitClose();
    }
    await delay(RECONNECT_DELAY_MS);
  }
}

async function main() {
  startPi(); // pi owns the session before the channel is up, so a control-plane outage cannot block a start
  await runChannel();
}

main().catch((err) => {
  console.error("runner:", err);
  process.exit(1);
});
