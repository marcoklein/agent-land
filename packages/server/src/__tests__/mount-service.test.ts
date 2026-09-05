import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MountService, mountVolumeName, MountInUseError, DuplicateMountError } from "../core/mount-service.js";
import { JsonMountRepository, JsonSessionRepository } from "../infra/repositories.js";
import { setupDataDir, cleanupDataDir, getDataDir, MockDockerPort } from "./helpers/setup.js";
import type { AgentSession } from "../core/types.js";

describe("MountService", () => {
  beforeAll(async () => {
    await setupDataDir();
  });

  afterAll(async () => {
    await cleanupDataDir();
  });

  it("creates a volume with labels and a registry entry", async () => {
    const repo = new JsonMountRepository(getDataDir());
    const docker = new MockDockerPort();
    const sessions = new JsonSessionRepository(getDataDir());
    const service = new MountService(repo, docker, sessions);

    const mount = await service.create("My Repo");

    expect(mount.name).toBe("My Repo");
    expect(docker.createdVolumes).toHaveLength(1);
    expect(docker.createdVolumes[0].name).toBe(mountVolumeName("My Repo"));
    expect(docker.createdVolumes[0].labels["agent-land/mount"]).toBe("my-repo");
    const names = (await service.list()).map((m) => m.name);
    expect(names).toContain("My Repo");
  });

  it("rejects duplicate names", async () => {
    const repo = new JsonMountRepository(getDataDir());
    const docker = new MockDockerPort();
    const sessions = new JsonSessionRepository(getDataDir());
    const service = new MountService(repo, docker, sessions);

    await service.create("dup");
    await expect(service.create("dup")).rejects.toThrow(DuplicateMountError);
  });

  it("refuses to delete a mount bound by a live session", async () => {
    const repo = new JsonMountRepository(getDataDir());
    const docker = new MockDockerPort();
    const sessions = new JsonSessionRepository(getDataDir());
    const service = new MountService(repo, docker, sessions);

    await service.create("live-bound");
    const liveSession: AgentSession = {
      id: "sess-1",
      status: "running",
      permissionPolicy: "auto",
      sessionDir: "/sessions/sess-1",
      connectors: [],
      mounts: [{ source: "live-bound", target: "/repo" }],
      model: "m",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await sessions.save(liveSession);

    await expect(service.delete("live-bound")).rejects.toThrow(MountInUseError);
  });

  it("deletes a free mount and removes its volume", async () => {
    const repo = new JsonMountRepository(getDataDir());
    const docker = new MockDockerPort();
    const sessions = new JsonSessionRepository(getDataDir());
    const service = new MountService(repo, docker, sessions);

    await service.create("free");
    await service.delete("free");
    const names = (await service.list()).map((m) => m.name);
    expect(names).not.toContain("free");
    expect(docker.removedVolumes).toContain(mountVolumeName("free"));
  });
});
