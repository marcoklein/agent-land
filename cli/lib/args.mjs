const COMMANDS = new Set(["new", "chat", "ls", "rm", "log", "models", "connectors", "run", "watch"]);

const FLAGS = {
  "--workspace": { key: "workspace", type: "value" },
  "--ref": { key: "ref", type: "value" },
  "--connectors": { key: "connectors", type: "value" },
  "--model": { key: "model", type: "value" },
  "--manual": { key: "manual", type: "boolean" },
  "--yes": { key: "yes", type: "boolean" },
  "-y": { key: "yes", type: "boolean" },
  "--json": { key: "json", type: "boolean" },
  "--follow": { key: "follow", type: "boolean" },
  "--rm": { key: "rm", type: "boolean" },
  "--verbose": { key: "verbose", type: "boolean" },
  "--all": { key: "all", type: "boolean" },
  "--timeout": { key: "timeout", type: "value" },
  "--name": { key: "name", type: "value" },
  "--type": { key: "type", type: "value" },
  "--url": { key: "url", type: "value" },
  "--content": { key: "content", type: "value" },
  "--field": { key: "field", type: "value", multiple: true },
};

const COMMAND_FLAGS = {
  new: ["--workspace", "--ref", "--connectors", "--model", "--manual"],
  chat: [],
  ls: ["--json"],
  rm: ["--yes", "-y"],
  log: ["--follow", "--json"],
  models: [],
  connectors: ["--yes", "-y", "--name", "--type", "--url", "--field", "--content"],
  run: ["--workspace", "--ref", "--connectors", "--model", "--manual", "--rm", "--timeout", "--verbose"],
  watch: ["--all"],
};

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv) {
  let cmd = null;
  for (const a of argv) {
    if (COMMANDS.has(a)) {
      cmd = a;
      break;
    }
  }

  const opts = { connectors: [], fields: [] };
  const positional = [];
  let help = false;

  if (!cmd) {
    if (argv.includes("--help") || argv.includes("-h")) help = true;
    return { cmd: null, opts, positional, help };
  }

  const allowed = new Set(["--help", "-h", ...(COMMAND_FLAGS[cmd] ?? [])]);
  let endOfFlags = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === cmd) continue;
    if (endOfFlags) {
      positional.push(a);
      continue;
    }
    if (a === "--") {
      endOfFlags = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a.startsWith("--") || a === "-y") {
      if (!allowed.has(a)) throw new UsageError(`unknown flag "${a}" for command "${cmd}"`);
      const spec = FLAGS[a];
      if (spec.type === "boolean") {
        opts[spec.key] = true;
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || FLAGS[value]) {
        throw new UsageError(`flag "${a}" requires a value`);
      }
      i += 1;
      if (spec.multiple) opts.fields.push(value);
      else if (spec.key === "connectors") opts.connectors = value.split(",").filter(Boolean);
      else opts[spec.key] = value;
      continue;
    }
    positional.push(a);
  }

  if (opts.timeout !== undefined) {
    const t = Number(opts.timeout);
    if (!Number.isInteger(t) || t <= 0) {
      throw new UsageError(
        `--timeout expects a positive integer number of seconds, got "${opts.timeout}"`
      );
    }
    opts.timeout = t;
  }

  return { cmd, opts, positional, help };
}
