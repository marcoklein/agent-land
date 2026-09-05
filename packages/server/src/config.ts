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
  ageKeyFile: string;
  opencodeGoApiKey: string;
  opencodeGoUrl: string;
  defaultModel: string;
  sseHeartbeatMs: number;
  gitUserName: string;
  gitUserEmail: string;
  agentLandUrl: string;
  operatorBasicAuth?: OperatorBasicAuth;
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

  let operatorBasicAuth: OperatorBasicAuth | undefined;
  if (process.env.AGENT_LAND_BASIC_AUTH) {
    operatorBasicAuth = parseBasicAuthValue(process.env.AGENT_LAND_BASIC_AUTH);
  } else if (process.env.AGENT_LAND_AUTH_USER && process.env.AGENT_LAND_AUTH_PASSWORD) {
    operatorBasicAuth = {
      user: process.env.AGENT_LAND_AUTH_USER,
      password: process.env.AGENT_LAND_AUTH_PASSWORD,
    };
  }

  return {
    port,
    secretsDir: path.resolve(process.env.SECRETS_DIR || "./secrets"),
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    agentImage: process.env.AGENT_IMAGE || "agent-land-pi:latest",
    ageKeyFile: path.resolve(process.env.AGE_KEY_FILE || "./.age-key"),
    opencodeGoUrl: process.env.OPENCODE_API_URL || "https://opencode.ai/zen/go/v1",
    opencodeGoApiKey: process.env.OPENCODE_API_KEY || "",
    defaultModel: process.env.DEFAULT_MODEL || "deepseek-v4-pro",
    sseHeartbeatMs,
    gitUserName: process.env.GIT_USER_NAME ?? "",
    gitUserEmail: process.env.GIT_USER_EMAIL ?? "",
    agentLandUrl: (process.env.AGENT_LAND_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    operatorBasicAuth,
  };
}
