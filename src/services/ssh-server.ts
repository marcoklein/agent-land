import { randomUUID, timingSafeEqual } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import ssh2 from "ssh2";
import type { Connection, Session, ServerChannel } from "ssh2";

const { Server, utils } = ssh2;
import { AgentRunner } from "./agent-runner.js";
import { DockerService, SESSION_VOLUME_NAME, buildPiCmd } from "./docker.js";
import type { InteractiveExec } from "./docker.js";
import type { SopsService } from "./sops.js";
import type { Config } from "../config.js";

interface Deps {
  sops: SopsService;
  docker: DockerService;
  config: Config;
}

type ResizeFn = (h: number, w: number) => void;

const USAGE = [
  "usage: ssh agent-land@<host> -p <port> -i <key> <command>",
  "",
  "  new-session [--model m] [--connectors a,b]   create a long-lived interactive container",
  "  attach <id>                                 attach to an interactive pi TUI",
  "  list                                        list running interactive sessions",
  "",
].join("\n");

interface ParsedCommand {
  verb: "new-session" | "attach" | "list" | "usage";
  model?: string;
  connectors?: string[];
  id?: string;
}

function parseCommand(command: string): ParsedCommand {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const [verb, ...rest] = tokens;

  if (verb === "list") return { verb: "list" };

  if (verb === "new-session") {
    const parsed: ParsedCommand = { verb: "new-session" };
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t === "--model" && rest[i + 1]) parsed.model = rest[++i];
      else if (t === "--connectors" && rest[i + 1]) {
        parsed.connectors = rest[++i].split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return parsed;
  }

  if (verb === "attach") return { verb: "attach", id: rest[0] ?? "" };

  return { verb: "usage" };
}

function writeUsage(stream: ServerChannel): void {
  stream.stderr.write(USAGE);
  stream.exit(1);
  stream.end();
}

function checkValue(input: Buffer, allowed: Buffer): boolean {
  const autoReject = input.length !== allowed.length;
  if (autoReject) allowed = input;
  const isMatch = timingSafeEqual(input, allowed);
  return !autoReject && isMatch;
}

async function ensureHostKey(hostKeyFile: string): Promise<string> {
  try {
    return await readFile(hostKeyFile, "utf-8");
  } catch {
    const keyPair = utils.generateKeyPairSync("ed25519");
    await mkdir(path.dirname(hostKeyFile), { recursive: true });
    await writeFile(hostKeyFile, keyPair.private, { mode: 0o600 });
    return keyPair.private;
  }
}

async function handleNewSession(deps: Deps, stream: ServerChannel, cmd: ParsedCommand): Promise<void> {
  try {
    const connectors = cmd.connectors ?? [];
    const runner = new AgentRunner(deps.sops, deps.docker);
    const envMap = await runner.resolveAgentEnv(connectors);
    await deps.docker.ensureAgentImage(deps.config.agentImage);
    const id = randomUUID().slice(0, 8);
    await deps.docker.createInteractiveContainer({
      id,
      envVars: Object.fromEntries(envMap),
      image: deps.config.agentImage,
      sessionVolume: SESSION_VOLUME_NAME,
    });
    stream.write(`${id}\n`);
    stream.exit(0);
    stream.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.stderr.write(`new-session failed: ${message}\n`);
    stream.exit(1);
    stream.end();
  }
}

async function handleList(deps: Deps, stream: ServerChannel): Promise<void> {
  try {
    const sessions = await deps.docker.listInteractiveContainers();
    for (const s of sessions) {
      stream.write(`${s.id}\t${s.name}\t${s.status}\n`);
    }
    stream.exit(0);
    stream.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.stderr.write(`list failed: ${message}\n`);
    stream.exit(1);
    stream.end();
  }
}

async function handleAttach(
  deps: Deps,
  stream: ServerChannel,
  cmd: ParsedCommand,
  setResize: (fn: ResizeFn) => void
): Promise<void> {
  if (!cmd.id) {
    writeUsage(stream);
    return;
  }

  const containerId = `agent-land-pi-${cmd.id}`;
  const args = [
    ...buildPiCmd(deps.config.defaultModel, { interactive: true }),
    "--session-dir", `/sessions/${cmd.id}`,
  ];

  let exec: InteractiveExec;
  try {
    exec = await deps.docker.execInteractive(containerId, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stream.stderr.write(`attach failed: ${message}\n`);
    stream.exit(1);
    stream.end();
    return;
  }

  setResize((h, w) => { void exec.resize(h, w); });

  exec.stream.pipe(stream, { end: false });
  stream.pipe(exec.stream, { end: false });

  let finished = false;
  const closeChannel = () => {
    if (finished) return;
    finished = true;
    try { stream.exit(0); } catch {}
    try { stream.end(); } catch {}
  };
  const closeExec = () => {
    if (finished) return;
    finished = true;
    try { exec.stream.end(); } catch {}
  };

  exec.stream.on("close", closeChannel);
  exec.stream.on("error", closeChannel);
  stream.on("close", closeExec);
  stream.on("error", closeExec);
}

export function startSshServer(deps: Deps): Promise<void> {
  if (!deps.config.sshAuthorizedKey) {
    console.warn("SSH server disabled: SSH_AUTHORIZED_KEY is not set.");
    return Promise.resolve();
  }

  return (async () => {
    const hostKey = await ensureHostKey(deps.config.sshHostKeyFile);

    const parsedKey = utils.parseKey(deps.config.sshAuthorizedKey);
    if (parsedKey instanceof Error) {
      console.error("SSH server disabled: invalid SSH_AUTHORIZED_KEY:", parsedKey.message);
      return;
    }
    const allowedPubKey = parsedKey;

    const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
      client.on("authentication", (ctx) => {
        if (ctx.method !== "publickey") return ctx.reject();

        const keyMatches =
          ctx.key.algo === allowedPubKey.type &&
          checkValue(ctx.key.data, allowedPubKey.getPublicSSH());

        if (!keyMatches) return ctx.reject();

        if (ctx.signature && allowedPubKey.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) !== true) {
          return ctx.reject();
        }

        ctx.accept();
      });

      client.on("ready", () => {
        client.on("session", (accept) => {
          const session: Session = accept();
          let execResize: ResizeFn | null = null;

          session.on("pty", (acceptPty) => acceptPty());

          session.on("window-change", (acceptChange, _reject, info) => {
            execResize?.(info.rows, info.cols);
            acceptChange();
          });

          session.on("exec", (acceptExec, _reject, info) => {
            const stream: ServerChannel = acceptExec();
            const cmd = parseCommand(info.command);

            if (cmd.verb === "new-session") {
              void handleNewSession(deps, stream, cmd);
            } else if (cmd.verb === "list") {
              void handleList(deps, stream);
            } else if (cmd.verb === "attach") {
              void handleAttach(deps, stream, cmd, (fn) => { execResize = fn; });
            } else {
              writeUsage(stream);
            }
          });
        });
      });
    });

    server.listen(deps.config.sshPort, deps.config.sshHost, () => {
      console.log(`SSH server listening on ${deps.config.sshHost}:${deps.config.sshPort}`);
    });
  })();
}
