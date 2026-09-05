import type { MountRecord } from "./types.js";
import type { DockerPort, MountRepository, SessionRepository } from "./ports.js";
import { slugify } from "./connector-service.js";

export class DuplicateMountError extends Error {
  constructor(name: string) {
    super(`Mount "${name}" already exists.`);
    this.name = "DuplicateMountError";
  }
}

export class MountNotFoundError extends Error {
  constructor(name: string) {
    super(`Mount "${name}" not found.`);
    this.name = "MountNotFoundError";
  }
}

export class MountInUseError extends Error {
  constructor(name: string) {
    super(`Mount "${name}" is bound by a live session; stop it first.`);
    this.name = "MountInUseError";
  }
}

export function mountVolumeName(name: string): string {
  return `agent-land-mount-${slugify(name)}`;
}

export class MountService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private repository: MountRepository,
    private docker: DockerPort,
    private sessions: SessionRepository
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  list(): Promise<MountRecord[]> {
    return this.repository.list();
  }

  create(name: string): Promise<MountRecord> {
    return this.enqueue(() => this.doCreate(name));
  }

  delete(name: string): Promise<void> {
    return this.enqueue(() => this.doDelete(name));
  }

  private async doCreate(name: string): Promise<MountRecord> {
    if (!name) {
      throw new Error("Name is required.");
    }

    const slug = slugify(name);
    if (!slug) {
      throw new Error("Mount name must contain at least one letter or number.");
    }

    const mounts = await this.repository.list();
    if (mounts.some((m) => m.name === name || slugify(m.name) === slug)) {
      throw new DuplicateMountError(name);
    }

    await this.docker.createVolume(mountVolumeName(name), {
      app: "agent-land",
      "agent-land/mount": slug,
    });

    const now = new Date().toISOString();
    const mount: MountRecord = { name, createdAt: now, updatedAt: now };
    mounts.push(mount);
    await this.repository.save(mounts);

    return mount;
  }

  private async doDelete(name: string): Promise<void> {
    const mounts = await this.repository.list();
    const mount = mounts.find((m) => m.name === name);
    if (!mount) throw new MountNotFoundError(name);

    const live = (await this.sessions.list()).filter((s) => s.status !== "stopped");
    const inUse = live.some((s) =>
      (s.mounts ?? []).some((b) => b.source === name || slugify(b.source) === slugify(name))
    );
    if (inUse) throw new MountInUseError(name);

    await this.repository.save(mounts.filter((m) => m.name !== name));
    await this.docker.removeVolume(mountVolumeName(name));
  }
}
