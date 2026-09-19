import path from "path";

export interface OperatorBasicAuth {
  user: string;
  password: string;
}

export interface Config {
  port: number;
  secretsDir: string;
  dataDir: string;
  agentImage: string;
  agentImageDir: string;
  ageKeyFile: string;
  opencodeGoApiKey: string;
  opencodeGoUrl: string;
  defaultModel: string;
  sseHeartbeatMs: number;
  gitUserName: string;
  gitUserEmail: string;
  agentLandUrl: string;
  operatorBasicAuth?: OperatorBasicAuth;
  hostMounts: Record<string, string>;
  sessionReapTtlMs: number;
  sessionMaxLive: number;
  sessionReapIntervalMs: number;
}

/** Splits a "user:password" value at the first colon. */
export function parseBasicAuthValue(value: string): OperatorBasicAuth | undefined {
  const idx = value.indexOf(":");
  if (idx <= 0) return undefined;
  return { user: value.slice(0, idx), password: value.slice(idx + 1) };
}

export function getConfig(): Config {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT} (expected a positive integer)`);
  }

  const sseHeartbeatMs = Number(process.env.SSE_HEARTBEAT_MS ?? "30000");
  if (!Number.isFinite(sseHeartbeatMs) || sseHeartbeatMs <= 0) {
    throw new Error(`Invalid SSE_HEARTBEAT_MS: ${process.env.SSE_HEARTBEAT_MS} (expected a positive number)`);
  }

  const sessionReapTtlMs = parseNonNegativeInt("SESSION_REAP_TTL_MS", 21_600_000);
  const sessionMaxLive = parseNonNegativeInt("SESSION_MAX_LIVE", 100);
  const sessionReapIntervalMs = parsePositiveInt("SESSION_REAP_INTERVAL_MS", 60_000);

  let operatorBasicAuth: OperatorBasicAuth | undefined;
  if (process.env.AGENT_LAND_BASIC_AUTH) {
    operatorBasicAuth = parseBasicAuthValue(process.env.AGENT_LAND_BASIC_AUTH);
  } else if (process.env.AGENT_LAND_AUTH_USER && process.env.AGENT_LAND_AUTH_PASSWORD) {
    operatorBasicAuth = {
      user: process.env.AGENT_LAND_AUTH_USER,
      password: process.env.AGENT_LAND_AUTH_PASSWORD,
    };
  }

  const hostMounts = parseHostMounts(process.env.AGENT_LAND_HOST_MOUNTS);

  return {
    port,
    secretsDir: path.resolve(process.env.SECRETS_DIR || "./secrets"),
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    agentImage: process.env.AGENT_IMAGE || "agent-land-pi:latest",
    agentImageDir: path.resolve(process.env.AGENT_IMAGE_DIR || "/agent-image"),
    ageKeyFile: path.resolve(process.env.AGE_KEY_FILE || "./.age-key"),
    opencodeGoUrl: process.env.OPENCODE_API_URL || "https://opencode.ai/zen/go/v1",
    opencodeGoApiKey: process.env.OPENCODE_API_KEY || "",
    defaultModel: process.env.DEFAULT_MODEL || "deepseek-v4-pro",
    sseHeartbeatMs,
    gitUserName: process.env.GIT_USER_NAME ?? "",
    gitUserEmail: process.env.GIT_USER_EMAIL ?? "",
    agentLandUrl: (process.env.AGENT_LAND_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    operatorBasicAuth,
    hostMounts,
    sessionReapTtlMs,
    sessionMaxLive,
    sessionReapIntervalMs,
  };
}

function parseNonNegativeInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${envKey}: ${raw} (expected a non-negative integer)`);
  }
  return value;
}

function parsePositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${envKey}: ${raw} (expected a positive integer)`);
  }
  return value;
}

function parseHostMounts(raw?: string): Record<string, string> {
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const item of raw.split(",")) {
    const idx = item.indexOf(":");
    if (idx <= 0) continue;
    const name = item.slice(0, idx).trim();
    const hostPath = item.slice(idx + 1).trim();
    if (name && hostPath) map[name] = path.resolve(hostPath);
  }
  return map;
}
