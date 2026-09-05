import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAgentTestApp, setupDataDir, cleanupDataDir } from "./helpers/setup.js";
import { MountInUseError, MountNotFoundError } from "../core/mount-service.js";

type Ctx = ReturnType<typeof createAgentTestApp>;

describe("Mount session binding", () => {
  beforeAll(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("rejects a session that references an unknown mount", async () => {
    const ctx: Ctx = createAgentTestApp();
    await expect(
      ctx.sessionService.createSession({ mounts: [{ source: "nope", target: "/x" }] })
    ).rejects.toThrow(MountNotFoundError);
  });

  it("binds a known mount and passes extraBinds to the container", async () => {
    const ctx: Ctx = createAgentTestApp();
    await ctx.mountService.create("checkout");

    const session = await ctx.sessionService.createSession({
      mounts: [{ source: "checkout", target: "/repo" }],
    });

    expect(session.mounts).toEqual([{ source: "checkout", target: "/repo" }]);
    expect(ctx.mockDocker.created[0].extraBinds).toContain(
      "agent-land-mount-checkout:/repo"
    );
  });

  it("rejects a second live session binding the same mount", async () => {
    const ctx: Ctx = createAgentTestApp();
    await ctx.mountService.create("shared");
    await ctx.sessionService.createSession({ mounts: [{ source: "shared", target: "/a" }] });

    await expect(
      ctx.sessionService.createSession({ mounts: [{ source: "shared", target: "/b" }] })
    ).rejects.toThrow(MountInUseError);
  });
});
