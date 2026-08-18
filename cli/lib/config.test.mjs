import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.mjs";

describe("loadConfig", () => {
  it("uses the default hosted URL", () => {
    const { url, authHeader } = loadConfig({});
    expect(url).toBe("https://agent-land.host.impromat.app");
    expect(authHeader).toBeUndefined();
  });

  it("strips trailing slashes from the URL", () => {
    expect(loadConfig({ AGENT_LAND_URL: "http://localhost:3000///" }).url).toBe(
      "http://localhost:3000"
    );
  });

  it("builds basic auth from user and password", () => {
    const { authHeader } = loadConfig({ AGENT_LAND_AUTH_USER: "u", AGENT_LAND_AUTH_PASSWORD: "p" });
    expect(authHeader).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });

  it("prefers the combined AGENT_LAND_BASIC_AUTH var", () => {
    const { authHeader } = loadConfig({
      AGENT_LAND_BASIC_AUTH: "a:b",
      AGENT_LAND_AUTH_USER: "u",
      AGENT_LAND_AUTH_PASSWORD: "p",
    });
    expect(authHeader).toBe("Basic " + Buffer.from("a:b").toString("base64"));
  });
});
