import type { Config } from "./types.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = (env.AGENT_LAND_URL || "https://agent-land.host.impromat.app").replace(/\/+$/, "");

  let authHeader: string | undefined;
  if (env.AGENT_LAND_BASIC_AUTH) {
    authHeader = "Basic " + Buffer.from(env.AGENT_LAND_BASIC_AUTH).toString("base64");
  } else if (env.AGENT_LAND_AUTH_USER && env.AGENT_LAND_AUTH_PASSWORD) {
    authHeader =
      "Basic " +
      Buffer.from(`${env.AGENT_LAND_AUTH_USER}:${env.AGENT_LAND_AUTH_PASSWORD}`).toString("base64");
  }

  return { url, authHeader };
}
