import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { SopsService, extractAgePublicKey, parseSecretYaml } from "../infra/sops.js";

describe("extractAgePublicKey", () => {
  it("extracts a plain age key", () => {
    expect(extractAgePublicKey("creation_rules:\n  - age: age1abcdef\n")).toBe("age1abcdef");
  });

  it("extracts an indented key", () => {
    expect(extractAgePublicKey("creation_rules:\n    - age: age1zzz\n")).toBe("age1zzz");
  });

  it("ignores commented-out age lines", () => {
    expect(extractAgePublicKey("# age: age1commented\ncreation_rules:\n  - age: age1real\n")).toBe(
      "age1real"
    );
  });

  it("throws when no key is present", () => {
    expect(() => extractAgePublicKey("creation_rules: []\n")).toThrow(/age public key/);
  });
});

describe("parseSecretYaml", () => {
  it("parses scalar string values", () => {
    expect(parseSecretYaml("TOKEN: abc123\nURL: https://example.com\n")).toEqual(
      new Map([
        ["TOKEN", "abc123"],
        ["URL", "https://example.com"],
      ])
    );
  });

  it("strips quotes and comments, coerces numbers and booleans", () => {
    expect(
      parseSecretYaml('TOKEN: "abc123" # inline comment\nPORT: 8080\nFLAG: true\n')
    ).toEqual(
      new Map([
        ["TOKEN", "abc123"],
        ["PORT", "8080"],
        ["FLAG", "true"],
      ])
    );
  });

  it("supports block scalars and multi-line values", () => {
    const content = "PRIVATE_KEY: |\n  -----BEGIN KEY-----\n  line1\n  line2\n  -----END KEY-----\n";
    const map = parseSecretYaml(content);
    expect(map.get("PRIVATE_KEY")).toBe("-----BEGIN KEY-----\nline1\nline2\n-----END KEY-----\n");
  });

  it("returns an empty map for empty content", () => {
    expect(parseSecretYaml("")).toEqual(new Map());
  });

  it("throws on non-mapping content", () => {
    expect(() => parseSecretYaml("- just\n- a\n- list\n")).toThrow(/not a YAML mapping/);
  });

  it("throws on nested values", () => {
    expect(() => parseSecretYaml("NESTED:\n  key: value\n")).toThrow(/not a scalar/);
  });

  it("throws on malformed yaml", () => {
    expect(() => parseSecretYaml("a: [unclosed\n")).toThrow(/invalid YAML/);
  });
});

describe("SopsService path containment", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "sops-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function service() {
    return new SopsService(dir, path.join(dir, "unused-age-key"));
  }

  it("rejects parent traversal in decrypt", async () => {
    await expect(service().decrypt("../etc/passwd.yaml")).rejects.toThrow(/Invalid secret filename/);
  });

  it("rejects absolute paths in decrypt", async () => {
    await expect(service().decrypt("/etc/passwd")).rejects.toThrow(/Invalid secret filename/);
  });

  it("rejects nested paths in decrypt", async () => {
    await expect(service().decrypt("sub/dir.yaml")).rejects.toThrow(/Invalid secret filename/);
  });

  it("rejects parent traversal in deleteSecret", async () => {
    await expect(service().deleteSecret("../age-key")).rejects.toThrow(/Invalid secret filename/);
  });

  it("rejects traversal in secretExists", async () => {
    await expect(service().secretExists("../../.ssh/id_rsa")).rejects.toThrow(/Invalid secret filename/);
  });

  it("allows plain filenames inside the secrets dir", async () => {
    await expect(service().secretExists("does-not-exist")).resolves.toBe(false);
  });
});
