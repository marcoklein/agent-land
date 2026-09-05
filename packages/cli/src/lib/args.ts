const COMMANDS = new Set(["new", "chat", "ls", "rm", "log", "models", "connectors", "providers", "mounts", "run", "watch"]);

interface FlagSpec {
  key: string;
  type: "value" | "boolean";
  multiple?: boolean;
}

const FLAGS: Record<string, FlagSpec> = {
  "--connectors": { key: "connectors", type: "value" },
  "--model": { key: "model", type: "value" },
  "--provider": { key: "provider", type: "value" },
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
  "--url": { key: "url", type: "value" },
  "--mount": { key: "mount", type: "value", multiple: true },  "--content": { key: "content", type: "value" },
  "--field": { key: "field", type: "value", multiple: true },
  "--id": { key: "id", type: "value" },
  "--api-key": { key: "apiKey", type: "value" },
  "--label": { key: "label", type: "value" },
  "--base-url": { key: "baseUrl", type: "value" },
  "--api": { key: "api", type: "value" },
  "--models": { key: "models", type: "value" },
  "--default-model": { key: "defaultModel", type: "value" },
};

const COMMAND_FLAGS: Record<string, string[]> = {
  new: ["--connectors", "--model", "--provider", "--manual", "--mount"],
  chat: [],
  ls: ["--json"],
  rm: ["--yes", "-y"],
  log: ["--follow", "--json"],
  models: ["--provider"],
  connectors: ["--yes", "-y", "--name", "--url", "--field", "--content"],
  providers: ["--json", "--yes", "-y", "--id", "--label", "--base-url", "--api", "--api-key", "--models", "--default-model", "--field", "--content"],
  mounts: ["--yes", "-y", "--name"],
  run: ["--connectors", "--model", "--provider", "--manual", "--rm", "--timeout", "--verbose", "--mount"],
  watch: ["--all"],
};

export interface ParsedArgs {
  cmd: string | null;
  opts: {
    connectors: string[];
    fields: string[];
    mounts: string[];
    [key: string]: any;
  };
  positional: string[];
  help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  let cmd: string | null = null;
  for (const a of argv) {
    if (COMMANDS.has(a)) {
      cmd = a;
      break;
    }
  }

  const opts: ParsedArgs["opts"] = { connectors: [], fields: [], mounts: [] };
  const positional: string[] = [];
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
      if (spec.key === "connectors") opts.connectors = value.split(",").filter(Boolean);
      else if (spec.key === "mount") opts.mounts.push(value);
      else if (spec.multiple) opts.fields.push(value);
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
