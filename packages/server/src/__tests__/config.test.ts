import { describe, it, expect, afterEach } from "vitest";
import { getConfig } from "../config.js";

const ENV_KEYS = ["NODE_ENV", "SESSION_SECRET", "PORT", "SSE_HEARTBEAT_MS"] as const;
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
  it("throws in production when SESSION_SECRET is missing", () => {
    stash();
    setEnv("NODE_ENV", "production");
    setEnv("SESSION_SECRET", undefined);
    expect(() => getConfig()).toThrow(/SESSION_SECRET must be set/);
  });

  it("throws in production when SESSION_SECRET is too short", () => {
    stash();
    setEnv("NODE_ENV", "production");
    setEnv("SESSION_SECRET", "short");
    expect(() => getConfig()).toThrow(/at least 32 characters/);
  });

  it("accepts a strong SESSION_SECRET in production", () => {
    stash();
    setEnv("NODE_ENV", "production");
    setEnv("SESSION_SECRET", "x".repeat(64));
    expect(getConfig().sessionSecret).toBe("x".repeat(64));
  });

  it("falls back to a dev secret outside production", () => {
    stash();
    setEnv("NODE_ENV", undefined);
    setEnv("SESSION_SECRET", undefined);
    expect(getConfig().sessionSecret).toBe("dev-secret-change-me");
  });

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
});
