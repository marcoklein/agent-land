import { describe, it, expect, vi, afterEach } from "vitest";
import { pollDeviceToken } from "../infra/copilot-auth.js";

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
