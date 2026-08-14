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
  sshHost: string;
  sshPort: number;
  sshHostKeyFile: string;
  sshAuthorizedKey: string;
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
    sshHost: process.env.SSH_HOST || "127.0.0.1",
    sshPort: parseInt(process.env.SSH_PORT || "2222"),
    sshHostKeyFile: path.resolve(process.env.SSH_HOST_KEY_FILE || "./data/ssh/host_key"),
    sshAuthorizedKey: process.env.SSH_AUTHORIZED_KEY || "",
  };
}
