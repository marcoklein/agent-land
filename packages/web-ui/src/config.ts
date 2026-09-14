export interface Config {
  engineUrl: string;
  authHeader?: string;
  port: number;
  quietMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const engineUrl = (env.AGENT_LAND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");

  let authHeader: string | undefined;
  if (env.AGENT_LAND_BASIC_AUTH) {
    authHeader = "Basic " + Buffer.from(env.AGENT_LAND_BASIC_AUTH).toString("base64");
  } else if (env.AGENT_LAND_AUTH_USER && env.AGENT_LAND_AUTH_PASSWORD) {
    authHeader =
      "Basic " +
      Buffer.from(`${env.AGENT_LAND_AUTH_USER}:${env.AGENT_LAND_AUTH_PASSWORD}`).toString("base64");
  }

  const port = parseInt(env.PORT || "5000", 10);
  const quietMs = parseInt(env.QUIET_MS || "500", 10);

  return { engineUrl, authHeader, port, quietMs };
}