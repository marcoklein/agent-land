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

  al ls [--json]
      list sessions with status, age, model, workspace and connectors

  al rm <session-id> [-y|--yes]
      delete a session (prompts y/N when it is still running)

  al log <session-id> [--follow] [--json]
      print the full event history; --follow keeps tailing, --json prints raw events

  al models
      list available models

  al connectors ls
      list connectors (name, type, url — never secrets)

  al connectors add --name <n> --type <type> --url <u> [--field KEY=VALUE ...] [--content <yaml>]
      create a connector; typed connectors take --field, custom types take --content

  al connectors rm <name> [-y|--yes]
      delete a connector (prompts y/N)

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
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--follow") opts.follow = true;
    else if (a === "--name") opts.name = argv[++i];
    else if (a === "--type") opts.type = argv[++i];
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--content") opts.content = argv[++i];
    else if (a === "--field") (opts.fields ||= []).push(argv[++i]);
    else if (a === "--help" || a === "-h") process.stdout.write(USAGE) || process.exit(0);
    else if (cmd === null && (a === "new" || a === "chat" || a === "ls" || a === "rm" || a === "log" || a === "models" || a === "connectors"))
      cmd = a;
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

function formatAge(createdAt) {
  const s = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

function statusColor(status) {
  if (status === "idle") return green;
  if (status === "running" || status === "waiting_for_input") return yellow;
  return dim;
}

function sessionLine(s) {
  const workspace = s.workspace
    ? ` · ${s.workspace.repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "")}${
        s.workspace.ref ? `@${s.workspace.ref}` : ""
      }`
    : "";
  const connectors = s.connectors && s.connectors.length ? ` · ${s.connectors.join(",")}` : "";
  const status = s.status.padEnd(8);
  return `${s.id}  ${statusColor(s.status)(status)}${formatAge(s.createdAt).padEnd(7)}${s.model}${workspace}${connectors}`;
}

async function listSessions(client, { json } = {}) {
  const { sessions } = await client.listSessions();
  if (!sessions || sessions.length === 0) {
    process.stdout.write(json ? "[]\n" : "no sessions\n");
    return;
  }
  const sorted = [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (json) {
    process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
    return;
  }
  for (const s of sorted) process.stdout.write(sessionLine(s) + "\n");
}

function askYesNo(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y/i.test(answer.trim()));
    });
  });
}

async function confirmOrFail(prompt, { yes, what }) {
  if (yes) return;
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    fail(`refusing to ${what} non-interactively; pass --yes to confirm`);
  }
  const answer = await askYesNo(prompt);
  if (!answer) {
    process.stdout.write("aborted\n");
    process.exit(0);
  }
}

async function listConnectors(client) {
  const { connectors } = await client.listConnectors();
  if (!connectors || connectors.length === 0) {
    process.stdout.write("no connectors\n");
    return;
  }
  const nameWidth = Math.max(6, ...connectors.map((c) => c.name.length));
  const typeWidth = Math.max(4, ...connectors.map((c) => c.type.length));
  for (const c of connectors) {
    process.stdout.write(
      `${c.name.padEnd(nameWidth)}  ${c.type.padEnd(typeWidth)}  ${c.url}\n`
    );
  }
}

async function addConnector(client, opts) {
  const { name, type, url, content } = opts;
  if (!name || !type || !url) fail("connectors add requires --name, --type and --url");

  const { fields } = await client.connectorFields(type);
  const payload = { name, type, url };

  if (fields) {
    const provided = {};
    for (const f of opts.fields || []) {
      const eq = f.indexOf("=");
      if (eq === -1) fail(`--field expects KEY=VALUE, got "${f}"`);
      provided[f.slice(0, eq).trim()] = f.slice(eq + 1);
    }
    for (const def of fields) {
      if (!provided[def.envVar]) fail(`missing --field ${def.envVar} (${def.label})`);
    }
    payload.fields = provided;
  } else if (content) {
    payload.content = content;
  } else {
    fail(`type "${type}" is custom: provide --content "<yaml>"`);
  }

  const { connector } = await client.createConnector(payload);
  process.stdout.write(`created connector "${connector.name}" (${connector.type})\n`);
}

async function logSession(client, sessionId, { json, follow }) {
  const renderer = createEventRenderer();
  let maxSeq = -1;
  let stop = false;
  let ac = null;
  let quietTimer = null;

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
        if (json) {
          process.stdout.write(JSON.stringify(parsed) + "\n");
        } else {
          for (const line of renderer.render(parsed)) process.stdout.write(line.text + "\n");
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
  } else if (cmd === "ls") {
    try {
      await listSessions(client, { json: opts.json });
    } catch (err) {
      fail(`list failed: ${err.message}`);
    }
  } else if (cmd === "rm") {
    const sessionId = positional[0];
    if (!sessionId) fail("rm requires a session id");
    let session;
    try {
      ({ session } = await client.getSession(sessionId));
    } catch (err) {
      fail(`session ${sessionId}: ${err.message}`);
    }
    if (session.status !== "stopped") {
      await confirmOrFail(`kill session ${sessionId} (${session.status})? [y/N] `, {
        yes: opts.yes,
        what: "delete a running session",
      });
    }
    try {
      await client.deleteSession(sessionId);
      process.stdout.write(`deleted ${sessionId}\n`);
    } catch (err) {
      fail(`delete failed: ${err.message}`);
    }
  } else if (cmd === "log") {
    const sessionId = positional[0];
    if (!sessionId) fail("log requires a session id");
    try {
      await client.getSession(sessionId);
    } catch (err) {
      fail(`session ${sessionId}: ${err.message}`);
    }
    try {
      await logSession(client, sessionId, { json: opts.json, follow: opts.follow });
    } catch (err) {
      fail(`log failed: ${err.message}`);
    }
  } else if (cmd === "models") {
    try {
      const { models } = await client.listModels();
      for (const m of models) process.stdout.write(m + "\n");
    } catch (err) {
      fail(`models failed: ${err.message}`);
    }
  } else if (cmd === "connectors") {
    const sub = positional[0] || "ls";
    try {
      if (sub === "ls") {
        await listConnectors(client);
      } else if (sub === "add") {
        await addConnector(client, opts);
      } else if (sub === "rm") {
        const name = positional[1];
        if (!name) fail("connectors rm requires a name");
        await confirmOrFail(`delete connector "${name}"? [y/N] `, {
          yes: opts.yes,
          what: "delete a connector",
        });
        await client.deleteConnector(name);
        process.stdout.write(`deleted connector "${name}"\n`);
      } else {
        fail(`connectors: unknown subcommand "${sub}"`);
      }
    } catch (err) {
      fail(`connectors ${sub} failed: ${err.message}`);
    }
  }
}

main();
