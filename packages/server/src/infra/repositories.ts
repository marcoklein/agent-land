import { mkdir, readFile, writeFile, readdir, stat, unlink, appendFile, rename } from "fs/promises";
import path from "path";
import type { SessionRepository, ConnectorRepository, SessionEventLog, ProviderRepository } from "../core/ports.js";
import type { AgentSession, Connector, ProviderConfig } from "../core/types.js";
import type { SessionEvent } from "../core/events.js";

export class JsonSessionRepository implements SessionRepository {
  constructor(private dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, "sessions");
  }

  async save(session: AgentSession): Promise<void> {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${session.id}.json`);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(session, null, 2));
    await rename(tmpPath, filePath);
  }

  async get(id: string): Promise<AgentSession | null> {
    const filePath = path.join(this.dir(), `${id}.json`);
    try {
      await stat(filePath);
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async list(): Promise<AgentSession[]> {
    const dir = this.dir();
    try {
      const files = await readdir(dir);
      const sessions: AgentSession[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = await readFile(path.join(dir, file), "utf-8");
          sessions.push(JSON.parse(content));
        } catch {}
      }
      return sessions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch {
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    await unlink(path.join(this.dir(), `${id}.json`)).catch(() => {});
  }
}

export class JsonSessionEventLog implements SessionEventLog {
  private tails = new Map<string, string[]>();
  private chains = new Map<string, Promise<void>>();

  constructor(private dataDir: string) {}

  private filePath(id: string): string {
    return path.join(this.dataDir, "sessions", `${id}.events.jsonl`);
  }

  async append(id: string, event: SessionEvent, cap: number): Promise<void> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(() => this.appendLocked(id, event, cap));
    this.chains.set(id, next.catch(() => {}));
    await next;
  }

  private async appendLocked(id: string, event: SessionEvent, cap: number): Promise<void> {
    const filePath = this.filePath(id);
    await mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify(event);

    let tail = this.tails.get(id);
    if (!tail) {
      tail = await this.readLines(id);
    }
    await appendFile(filePath, line + "\n", "utf-8");
    tail.push(line);
    if (tail.length > cap) {
      tail = tail.slice(tail.length - cap);
      this.tails.set(id, tail);
      await writeFile(filePath, tail.join("\n") + "\n", "utf-8");
    } else {
      this.tails.set(id, tail);
    }
  }

  async read(id: string): Promise<SessionEvent[]> {
    return (await this.readLines(id)).map((line) => JSON.parse(line) as SessionEvent);
  }

  async delete(id: string): Promise<void> {
    this.tails.delete(id);
    this.chains.delete(id);
    await unlink(this.filePath(id)).catch(() => {});
  }

  private async readLines(id: string): Promise<string[]> {
    try {
      const content = await readFile(this.filePath(id), "utf-8");
      return content.split("\n").filter((line) => line.length > 0);
    } catch {
      return [];
    }
  }
}

export class JsonConnectorRepository implements ConnectorRepository {
  constructor(private dataDir: string) {}

  private filePath(): string {
    return path.join(this.dataDir, "connectors.json");
  }

  async list(): Promise<Connector[]> {
    try {
      await stat(this.filePath());
      const content = await readFile(this.filePath(), "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async save(list: Connector[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmpPath = `${this.filePath()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(list, null, 2));
    await rename(tmpPath, this.filePath());
  }
}

export class JsonProviderRepository implements ProviderRepository {
  constructor(private dataDir: string) {}

  private filePath(): string {
    return path.join(this.dataDir, "providers.json");
  }

  async list(): Promise<ProviderConfig[]> {
    try {
      await stat(this.filePath());
      const content = await readFile(this.filePath(), "utf-8");
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ProviderConfig | null> {
    const all = await this.list();
    return all.find((p) => p.id === id) ?? null;
  }

  async save(list: ProviderConfig[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const tmpPath = `${this.filePath()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(list, null, 2));
    await rename(tmpPath, this.filePath());
  }
}
