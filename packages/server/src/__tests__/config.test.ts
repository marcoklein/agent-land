import { describe, it, expect, afterEach } from "vitest";
import { getConfig } from "../config.js";

const ENV_KEYS = [
  "PORT",
  "SSE_HEARTBEAT_MS",
  "GIT_USER_NAME",
  "GIT_USER_EMAIL",
  "AGENT_LAND_URL",
  "AGENT_LAND_BASIC_AUTH",
  "AGENT_LAND_AUTH_USER",
  "AGENT_LAND_AUTH_PASSWORD",
  "SESSION_REAP_TTL_MS",
  "SESSION_MAX_LIVE",
  "SESSION_REAP_INTERVAL_MS",
] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) setEnv(key, saved[key]);
});

function stash() {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
}

describe("getConfig", () => {
  it("throws on a non-numeric PORT", () => {
    stash();
    setEnv("PORT", "abc");
    expect(() => getConfig()).toThrow(/Invalid PORT/);
  });

  it("throws on a negative SSE_HEARTBEAT_MS", () => {
    stash();
    setEnv("SSE_HEARTBEAT_MS", "-5");
    expect(() => getConfig()).toThrow(/Invalid SSE_HEARTBEAT_MS/);
  });

  it("reads git identity from env", () => {
    stash();
    setEnv("GIT_USER_NAME", "Jane Doe");
    setEnv("GIT_USER_EMAIL", "jane@example.com");
    expect(getConfig().gitUserName).toBe("Jane Doe");
    expect(getConfig().gitUserEmail).toBe("jane@example.com");
  });

  it("defaults git identity to an empty string when unset", () => {
    stash();
    setEnv("GIT_USER_NAME", undefined);
    setEnv("GIT_USER_EMAIL", undefined);
    expect(getConfig().gitUserName).toBe("");
    expect(getConfig().gitUserEmail).toBe("");
  });

  it("reads the loopback URL from AGENT_LAND_URL", () => {
    stash();
    setEnv("AGENT_LAND_URL", "https://agent-land.example/");
    expect(getConfig().agentLandUrl).toBe("https://agent-land.example");
  });

  it("defaults the loopback URL to localhost with the port", () => {
    stash();
    setEnv("AGENT_LAND_URL", undefined);
    setEnv("PORT", "4321");
    expect(getConfig().agentLandUrl).toBe("http://localhost:4321");
  });

  it("reads the operator credential from AGENT_LAND_BASIC_AUTH", () => {
    stash();
    setEnv("AGENT_LAND_BASIC_AUTH", "op:secret");
    expect(getConfig().operatorBasicAuth).toEqual({ user: "op", password: "secret" });
  });

  it("reads the operator credential from split auth vars", () => {
    stash();
    setEnv("AGENT_LAND_BASIC_AUTH", undefined);
    setEnv("AGENT_LAND_AUTH_USER", "op");
    setEnv("AGENT_LAND_AUTH_PASSWORD", "pw");
    expect(getConfig().operatorBasicAuth).toEqual({ user: "op", password: "pw" });
  });

  it("leaves the operator credential unset when no auth env is present", () => {
    stash();
    setEnv("AGENT_LAND_BASIC_AUTH", undefined);
    setEnv("AGENT_LAND_AUTH_USER", undefined);
    setEnv("AGENT_LAND_AUTH_PASSWORD", undefined);
    expect(getConfig().operatorBasicAuth).toBeUndefined();
  });

  it("defaults session reaping to 6h TTL, 100 live cap, and a 60s interval", () => {
    stash();
    setEnv("SESSION_REAP_TTL_MS", undefined);
    setEnv("SESSION_MAX_LIVE", undefined);
    setEnv("SESSION_REAP_INTERVAL_MS", undefined);
    expect(getConfig().sessionReapTtlMs).toBe(21_600_000);
    expect(getConfig().sessionMaxLive).toBe(100);
    expect(getConfig().sessionReapIntervalMs).toBe(60_000);
  });

  it("reads session reaping settings from env", () => {
    stash();
    setEnv("SESSION_REAP_TTL_MS", "1000");
    setEnv("SESSION_MAX_LIVE", "5");
    setEnv("SESSION_REAP_INTERVAL_MS", "2000");
    const config = getConfig();
    expect(config.sessionReapTtlMs).toBe(1000);
    expect(config.sessionMaxLive).toBe(5);
    expect(config.sessionReapIntervalMs).toBe(2000);
  });

  it("allows a zero TTL and zero cap to disable reaping", () => {
    stash();
    setEnv("SESSION_REAP_TTL_MS", "0");
    setEnv("SESSION_MAX_LIVE", "0");
    expect(getConfig().sessionReapTtlMs).toBe(0);
    expect(getConfig().sessionMaxLive).toBe(0);
  });

  it("throws on a negative SESSION_MAX_LIVE", () => {
    stash();
    setEnv("SESSION_MAX_LIVE", "-1");
    expect(() => getConfig()).toThrow(/Invalid SESSION_MAX_LIVE/);
  });

  it("throws on a non-positive SESSION_REAP_INTERVAL_MS", () => {
    stash();
    setEnv("SESSION_REAP_INTERVAL_MS", "0");
    expect(() => getConfig()).toThrow(/Invalid SESSION_REAP_INTERVAL_MS/);
  });
});