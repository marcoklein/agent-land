import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { computeAgentImageTag } from "../infra/agent-image.js";

async function withFiles(files: Record<string, string>): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "agent-image-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(d, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return d;
}

describe("computeAgentImageTag", () => {
  it("derives a stable content-hashed tag", async () => {
    const d = await withFiles({ "runner/a.mjs": "console.log(1)", "entrypoint.sh": "#!/bin/sh" });
    const t1 = await computeAgentImageTag(d);
    const t2 = await computeAgentImageTag(d);
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^agent-land-pi:[a-f0-9]{12}$/);
    await rm(d, { recursive: true, force: true });
  });

  it("changes when a file's content changes", async () => {
    const d = await withFiles({ "runner/a.mjs": "console.log(1)" });
    const t1 = await computeAgentImageTag(d);
    await writeFile(path.join(d, "runner", "a.mjs"), "console.log(2)");
    const t2 = await computeAgentImageTag(d);
    expect(t1).not.toBe(t2);
    await rm(d, { recursive: true, force: true });
  });

  it("changes when a file is added", async () => {
    const d = await withFiles({ "runner/a.mjs": "console.log(1)" });
    const t1 = await computeAgentImageTag(d);
    await writeFile(path.join(d, "runner", "b.mjs"), "console.log(2)");
    const t2 = await computeAgentImageTag(d);
    expect(t1).not.toBe(t2);
    await rm(d, { recursive: true, force: true });
  });
});
