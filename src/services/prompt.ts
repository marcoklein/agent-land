import { Connector } from "../types.js";

export function buildPrompt(task: string, connectors: Connector[]): string {
  const parts: string[] = [];

  if (connectors.length > 0) {
    parts.push("Connectors available this session:");
    for (const conn of connectors) {
      const envVars = getConnectorEnvVars(conn);
      const envList = envVars.map(v => `$${v}`).join(", ");
      parts.push(`- ${conn.name} (${conn.type}): Credentials in ${envList}`);
    }
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push(task);

  return parts.join("\n");
}

function getConnectorEnvVars(conn: Connector): string[] {
  switch (conn.type) {
    case "github": return ["GITHUB_TOKEN", "GITHUB_API_URL"];
    case "jira":   return ["JIRA_URL", "JIRA_API_TOKEN"];
    case "gmail":  return ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
    default:       return [];
  }
}
