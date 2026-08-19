const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "authorized"; accessToken: string };

export interface CopilotToken {
  token: string;
  expiresAt: number;
}

export async function startDeviceFlow(clientId: string = COPILOT_CLIENT_ID): Promise<DeviceFlowStart> {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "read:user" }),
  });
  const body = await parseJson(res);
  if (!res.ok || !body.device_code || !body.user_code) {
    throw new Error(`GitHub device flow start failed: HTTP ${res.status}`);
  }
  return {
    deviceCode: body.device_code as string,
    userCode: body.user_code as string,
    verificationUri: (body.verification_uri as string) ?? "https://github.com/login/device",
    expiresIn: Number(body.expires_in ?? 900),
    interval: Number(body.interval ?? 5),
  };
}

export async function pollDeviceToken(
  deviceCode: string,
  clientId: string = COPILOT_CLIENT_ID
): Promise<PollResult> {
  const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = await parseJson(res);
  if (!res.ok || body.error) {
    const error = String(body.error ?? `HTTP ${res.status}`);
    switch (error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "expired_token":
        return { status: "expired" };
      case "access_denied":
        return { status: "denied" };
      default:
        return { status: "pending" };
    }
  }
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    return { status: "pending" };
  }
  return { status: "authorized", accessToken: body.access_token };
}

export async function exchangeCopilotToken(githubToken: string): Promise<CopilotToken> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "GitHubCopilotChat/0.35.0",
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat",
    },
  });
  const body = await parseJson(res);
  if (!res.ok || typeof body.token !== "string") {
    const detail = typeof body.message === "string" ? `: ${body.message}` : "";
    throw new Error(`Copilot token exchange failed (HTTP ${res.status})${detail}`);
  }
  return {
    token: body.token,
    expiresAt: typeof body.expires_at === "number" ? body.expires_at * 1000 : Date.now() + 55 * 60 * 1000,
  };
}

export function buildCopilotSecretYaml(
  copilot: CopilotToken,
  githubToken: string
): string {
  const expires = copilot.expiresAt - 5 * 60 * 1000;
  return `access: ${JSON.stringify(copilot.token)}\nrefresh: ${JSON.stringify(githubToken)}\nexpires: ${expires}\n`;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
