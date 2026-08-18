import path from "path";

export interface Config {
  port: number;
  sessionSecret: string;
  secretsDir: string;
  dataDir: string;
  agentImage: string;
  ageKeyFile: string;
  opencodeGoApiKey: string;
  opencodeGoUrl: string;
  defaultModel: string;
  gitUserName: string;
  gitUserEmail: string;
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

  const isProd = process.env.NODE_ENV === "production";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (isProd && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error(
      "SESSION_SECRET must be set to a random value of at least 32 characters in production"
    );
  }
  if (!isProd && !sessionSecret) {
    console.warn("SESSION_SECRET is not set; using insecure development fallback");
  }

  return {
    port,
    sessionSecret: sessionSecret || "dev-secret-change-me",
    secretsDir: path.resolve(process.env.SECRETS_DIR || "./secrets"),
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    agentImage: process.env.AGENT_IMAGE || "agent-land-pi:latest",
    ageKeyFile: path.resolve(process.env.AGE_KEY_FILE || "./.age-key"),
    opencodeGoUrl: process.env.OPENCODE_API_URL || "https://opencode.ai/zen/go/v1",
    opencodeGoApiKey: process.env.OPENCODE_API_KEY || "",
    defaultModel: process.env.DEFAULT_MODEL || "deepseek-v4-pro",
    gitUserName: process.env.GIT_USER_NAME || "",
    gitUserEmail: process.env.GIT_USER_EMAIL || "",
    sseHeartbeatMs,
  };
}
