import path from "path";

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
  };
}