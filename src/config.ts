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
}

export function getConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "3000"),
    sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",
    secretsDir: path.resolve(process.env.SECRETS_DIR || "./secrets"),
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    agentImage: process.env.AGENT_IMAGE || "agent-land-pi:latest",
    ageKeyFile: path.resolve(process.env.AGE_KEY_FILE || "./.age-key"),
    opencodeGoUrl: process.env.OPENCODE_API_URL || "https://opencode.ai/zen/go/v1",
    opencodeGoApiKey: process.env.OPENCODE_API_KEY || "",
    defaultModel: process.env.DEFAULT_MODEL || "deepseek-v4-pro",
    gitUserName: process.env.GIT_USER_NAME || "",
    gitUserEmail: process.env.GIT_USER_EMAIL || "",
  };
}
