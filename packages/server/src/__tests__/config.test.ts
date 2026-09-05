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
});