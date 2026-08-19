import { describe, it, expect, vi, afterEach } from "vitest";
import { pollDeviceToken, copilotApiBaseUrl, parseCopilotModelList } from "../infra/copilot-auth.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("pollDeviceToken", () => {
  it("maps authorization_pending to pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "authorization_pending" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({ status: "pending" });
  });

  it("maps slow_down to slow_down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "slow_down" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({ status: "slow_down" });
  });

  it("maps expired_token to expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "expired_token" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({ status: "expired" });
  });

  it("maps access_denied to denied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "access_denied" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({ status: "denied" });
  });

  it("maps unknown errors to failed instead of pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { error: "incorrect_device_code" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({
      status: "failed",
      message: "incorrect_device_code",
    });
  });

  it("returns authorized with the access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "ghu_x" })));
    await expect(pollDeviceToken("code")).resolves.toEqual({ status: "authorized", accessToken: "ghu_x" });
  });
});

describe("copilotApiBaseUrl", () => {
  it("derives the api host from proxy-ep", () => {
    expect(
      copilotApiBaseUrl("tid=1;exp=2;proxy-ep=proxy.business.githubcopilot.com;sku=x")
    ).toBe("https://api.business.githubcopilot.com");
  });

  it("falls back to individual when proxy-ep is absent", () => {
    expect(copilotApiBaseUrl("tid=1;exp=2")).toBe("https://api.individual.githubcopilot.com");
  });
});

describe("parseCopilotModelList", () => {
  it("keeps only pickable, tool-capable, non-disabled models", () => {
    const body = {
      data: [
        { id: "claude-sonnet-4.6", model_picker_enabled: true, policy: { state: "enabled" }, capabilities: { supports: { tool_calls: true } } },
        { id: "gpt-4", model_picker_enabled: false, policy: { state: "enabled" }, capabilities: { supports: { tool_calls: true } } },
        { id: "text-embedding-3-small", model_picker_enabled: true, policy: { state: "enabled" }, capabilities: { supports: { tool_calls: false } } },
        { id: "disabled-model", model_picker_enabled: true, policy: { state: "disabled" }, capabilities: { supports: { tool_calls: true } } },
      ],
    };
    expect(parseCopilotModelList(body)).toEqual(["claude-sonnet-4.6"]);
  });
});
