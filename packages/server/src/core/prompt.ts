import type { Connector } from "./types.js";

export function buildPrompt(task: string, connectors: Connector[]): string {
  const parts: string[] = [];

  if (connectors.length > 0) {
    parts.push("Connectors available this session:");
    for (const conn of connectors) {
      const envKeys = Object.keys(conn.env);
      const envList = envKeys.map((v) => `$${v}`).join(", ");
      parts.push(`- ${conn.name}: Credentials in ${envList}`);
    }
    parts.push("");
  }

  parts.push(task);

  return parts.join("\n");
}