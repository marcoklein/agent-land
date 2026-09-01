import { describe, it, expect, afterEach } from "vitest";
import { getConfig } from "../config.js";

const ENV_KEYS = ["PORT", "SSE_HEARTBEAT_MS"] as const;
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
});