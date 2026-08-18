#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";
import { loadConfig } from "./lib/config.mjs";
import { streamSse } from "./lib/sse.mjs";
import { createEventRenderer, wrapText } from "./lib/render.mjs";
import { createApiClient } from "./lib/api.mjs";

const USAGE = `al — terminal chat client for agent-land

Usage:
  al new [--workspace <repoUrl>] [--ref <branch>] [--connectors a,b,c] [--model <m>] [--manual]
      create a session and enter the chat overlay

  al chat <session-id>
      attach to an existing session (history replays, then live events)

Config (env):
  AGENT_LAND_URL             default https://agent-land.host.impromat.app
  AGENT_LAND_AUTH_USER       basic auth user
  AGENT_LAND_AUTH_PASSWORD   basic auth password
  AGENT_LAND_BASIC_AUTH      alternative: "user:password" in one var

In chat:
  /quit, /exit   detach (session keeps running; re-attach with al chat <id>)
  ctrl-c         abort the current turn (once); again to detach
  /help          show this hint
`;

function fail(message) {
  process.stderr.write(`al: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { connectors: [] };
  const positional = [];
  let cmd = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") opts.workspace = argv[++i];
    else if (a === "--ref") opts.ref = argv[++i];
    else if (a === "--connectors") opts.connectors = (argv[++i] || "").split(",").filter(Boolean);
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--manual") opts.manual = true;
    else if (a === "--help" || a === "-h") process.stdout.write(USAGE) || process.exit(0);
    else if (a === "new" || a === "chat") cmd = a;
    else positional.push(a);
  }

  return { cmd, opts, positional };
}

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};
const dim = (s) => `${c.dim}${s}${c.reset}`;
const cyan = (s) => `${c.cyan}${s}${c.reset}`;
const green = (s) => `${c.green}${s}${c.reset}`;
const red = (s) => `${c.red}${s}${c.reset}`;
const yellow = (s) => `${c.yellow}${s}${c.reset}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(client, sessionId, { hintOnQuit } = {}) {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const out = process.stdout;

  let running = true;
  let agentRunning = false;
  let abortSent = false;
  let dialog = null;
  let sseAbort = null;

  const renderer = createEventRenderer();
  let streamBlock = { text: "", height: 0, appendOnly: false };

  if (isTTY) {
    out.write("\x1b[?1049h");
    out.write("\x1b[2J\x1b[H");
    process.stdin.setRawMode(true);
  }
  readline.emitKeypressEvents(process.stdin);

  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: isTTY });
  rl.setPrompt("you> ");

  function setPrompt(p) {
    rl.setPrompt(p);
    if (isTTY) rl.prompt(true);
  }

  function printLine(text) {
    if (isTTY) {
      out.write("\r\x1b[2K" + text + "\n");
      rl.prompt(true);
    } else {
      out.write(text + "\n");
    }
  }

  function printLines(lines) {
    for (const line of lines) {
      let text = line.text;
      if (isTTY) {
        if (line.kind === "turn") text = cyan(text);
        else if (line.kind === "meta") text = dim(text);
        else if (line.kind === "ok") text = green(text);
        else if (line.kind === "error") text = red(text);
        else if (line.kind === "dialog") text = yellow(text);
      }
      printLine(text);
    }
  }

  function updateStreamBlock(text) {
    streamBlock.text = text;
    if (!isTTY) return;

    const width = out.columns || 100;
    const lines = wrapText(text, width);

    if (!streamBlock.appendOnly && lines.length > (out.rows || 24) - 6) {
      streamBlock.appendOnly = true;
      for (let i = streamBlock.height; i < lines.length; i++) printLine(lines[i]);
      streamBlock.height = lines.length;
      return;
    }

    if (streamBlock.appendOnly) {
      for (let i = streamBlock.height; i < lines.length; i++) printLine(lines[i]);
      streamBlock.height = lines.length;
      return;
    }

    out.write("\r\x1b[2K");
    if (streamBlock.height > 0) out.write(`\x1b[${streamBlock.height}A`);
    for (const l of lines) out.write("\x1b[2K" + l + "\r\n");
    for (let i = lines.length; i < streamBlock.height; i++) out.write("\x1b[2K\r\n");
    rl.prompt(true);
    streamBlock.height = lines.length;
  }

  function finalizeStreamBlock() {
    if (!isTTY && streamBlock.text) {
      const width = out.columns || 100;
      for (const l of wrapText(streamBlock.text, width)) out.write(l + "\n");
    }
    streamBlock = { text: "", height: 0, appendOnly: false };
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "status":
        if (ev.status === "running") {
          agentRunning = true;
          abortSent = false;
        } else if (ev.status === "idle" || ev.status === "stopped") {
          agentRunning = false;
        }
        if (ev.status !== "waiting_for_input") {
          dialog = null;
          setPrompt("you> ");
        }
        printLines(renderer.render(ev));
        return;

      case "turn_start":
        abortSent = false;
        printLines(renderer.render(ev));
        return;

      case "message_delta":
        renderer.render(ev);
        updateStreamBlock(renderer.state.streamingText);
        return;

      case "message_end":
      case "turn_end": {
        const hadBlock = renderer.state.streamingText.length > 0;
        const lines = renderer.render(ev);
        if (!hadBlock) printLines(lines);
        finalizeStreamBlock();
        return;
      }

      case "waiting_for_input":
        dialog = {
          requestId: ev.requestId,
          method: ev.method,
          options: ev.options,
        };
        setPrompt("answer> ");
        printLines(renderer.render(ev));
        return;

      case "input_received":
        if (dialog && dialog.requestId === ev.requestId) {
          dialog = null;
          setPrompt("you> ");
        }
        printLines(renderer.render(ev));
        return;

      case "agent_settled":
        printLines(renderer.render(ev));
        finalizeStreamBlock();
        return;

      default:
        printLines(renderer.render(ev));
    }
  }

  rl.on("line", async (line) => {
    const trimmed = line.trim();

    if (dialog) {
      const { requestId, method, options } = dialog;
      dialog = null;
      let value;
      if (method === "confirm") {
        value = { confirmed: /^y/i.test(trimmed) };
      } else if (method === "select") {
        const n = parseInt(trimmed, 10);
        value = {
          value: !Number.isNaN(n) && options && options[n - 1] ? options[n - 1] : trimmed,
        };
      } else {
        value = { value: trimmed };
      }
      printLine(dim("· you answered"));
      setPrompt("you> ");
      try {
        await client.respond(sessionId, requestId, value);
      } catch (err) {
        printLine(red(`respond failed: ${err.message}`));
      }
      return;
    }

    if (!trimmed) {
      if (isTTY) rl.prompt();
      return;
    }
    if (trimmed === "/quit" || trimmed === "/exit") {
      quit();
      return;
    }
    if (trimmed === "/help") {
      printLine(dim("/quit detach · ctrl-c abort turn · ctrl-c again detach"));
      return;
    }

    try {
      await client.prompt(sessionId, trimmed, agentRunning ? "followUp" : undefined);
    } catch (err) {
      printLine(red(`prompt failed: ${err.message}`));
    }
  });

  if (isTTY) {
    process.stdin.on("keypress", (_ch, key) => {
      if (!key || !key.ctrl || key.name !== "c") return;
      if (dialog) {
        dialog = null;
        printLine(dim("· dialog cancelled"));
        setPrompt("you> ");
        return;
      }
      if (agentRunning && !abortSent) {
        abortSent = true;
        client.abort(sessionId).catch(() => {});
        printLine(dim("· aborting turn…"));
        return;
      }
      quit();
    });
  }
  process.on("SIGINT", () => {
    if (!isTTY) quit();
  });
  process.on("SIGTERM", () => quit());

  function quit() {
    if (!running) return;
    running = false;
    if (sseAbort) sseAbort.abort();
    rl.close();
    if (isTTY) {
      process.stdin.setRawMode(false);
      out.write("\x1b[?1049l");
    }
    if (hintOnQuit) {
      out.write(dim(`detached — session ${sessionId} still running\n`));
      out.write(dim(`re-attach: npm run al -- chat ${sessionId}\n`));
    }
    process.exit(0);
  }

  async function attach() {
    let maxSeq = -1;
    while (running) {
      const ac = new AbortController();
      sseAbort = ac;
      let done = false;
      try {
        for await (const ev of streamSse(client.eventsUrl(sessionId), {
          authHeader: client.authHeader,
          signal: ac.signal,
        })) {
          if (ev.event === "agent-done") {
            done = true;
            break;
          }
          if (ev.data === undefined) continue;
          let parsed;
          try {
            parsed = JSON.parse(ev.data);
          } catch {
            continue;
          }
          if (typeof parsed.seq === "number") {
            if (maxSeq >= 0 && parsed.seq <= maxSeq) continue;
            maxSeq = Math.max(maxSeq, parsed.seq);
          }
          handleEvent(parsed);
        }
      } catch {
        if (!running) return;
      }
      if (done || !running) break;
      await sleep(1000);
    }
    if (running) {
      printLine(dim("· session stopped"));
      quit();
    }
  }

  rl.prompt();
  await attach();
}

async function main() {
  const { cmd, opts, positional } = parseArgs(process.argv.slice(2));
  if (!cmd) fail("missing command\n\n" + USAGE);

  const config = loadConfig();
  const client = createApiClient(config);

  if (cmd === "new") {
    const payload = {
      ...(opts.connectors.length > 0 ? { connectors: opts.connectors } : {}),
      ...(opts.manual ? { permissionPolicy: "manual" } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.workspace
        ? { workspace: { repoUrl: opts.workspace, ...(opts.ref ? { ref: opts.ref } : {}) } }
        : {}),
    };
    try {
      const { session } = await client.createSession(payload);
      await chat(client, session.id, { hintOnQuit: true });
    } catch (err) {
      fail(`create failed: ${err.message}`);
    }
  } else if (cmd === "chat") {
    const sessionId = positional[0];
    if (!sessionId) fail("chat requires a session id");
    try {
      await client.getSession(sessionId);
    } catch (err) {
      fail(`session ${sessionId}: ${err.message}`);
    }
    await chat(client, sessionId, { hintOnQuit: true });
  }
}

main();
