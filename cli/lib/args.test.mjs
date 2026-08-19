import { describe, it, expect } from "vitest";
import { parseArgs, UsageError } from "./args.mjs";

describe("parseArgs", () => {
  it("detects the command and collects positionals", () => {
    expect(parseArgs(["rm", "abc12345"])).toMatchObject({
      cmd: "rm",
      positional: ["abc12345"],
    });
  });

  it("flags help for --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["rm", "--help"]).help).toBe(true);
    expect(parseArgs(["watch", "-h"]).help).toBe(true);
  });

  it("rejects unknown flags for a command", () => {
    expect(() => parseArgs(["ls", "--url", "x"])).toThrow(UsageError);
    expect(() => parseArgs(["rm", "abc", "--json"])).toThrow(UsageError);
  });

  it("rejects a value flag missing its value", () => {
    expect(() => parseArgs(["new", "--workspace"])).toThrow(/requires a value/);
  });

  it("rejects a value flag followed by another flag", () => {
    expect(() => parseArgs(["new", "--workspace", "--manual"])).toThrow(/requires a value/);
  });

  it("parses boolean and value flags", () => {
    expect(parseArgs(["run", "hello", "--rm", "--timeout", "30", "--verbose"])).toMatchObject({
      cmd: "run",
      opts: { rm: true, timeout: 30, verbose: true },
      positional: ["hello"],
    });
  });

  it("splits --connectors on commas", () => {
    const { opts } = parseArgs(["new", "--connectors", "github,jira"]);
    expect(opts.connectors).toEqual(["github", "jira"]);
  });

  it("collects repeated --field flags", () => {
    const { opts } = parseArgs([
      "connectors", "add", "--name", "n", "--type", "github", "--url", "u",
      "--field", "A=1", "--field", "B=2",
    ]);
    expect(opts.fields).toEqual(["A=1", "B=2"]);
    expect(opts.name).toBe("n");
  });

  it("treats -- as a terminator for positional args", () => {
    expect(parseArgs(["run", "--", "--weird-message"])).toMatchObject({
      cmd: "run",
      positional: ["--weird-message"],
    });
  });

  it("rejects a non-numeric --timeout", () => {
    expect(() => parseArgs(["run", "x", "--timeout", "abc"])).toThrow(/positive integer/);
  });

  it("rejects a non-positive --timeout", () => {
    expect(() => parseArgs(["run", "x", "--timeout", "-5"])).toThrow(/positive integer/);
  });
});
