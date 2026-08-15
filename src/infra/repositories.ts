import { mkdir, readFile, writeFile, readdir, stat, unlink } from "fs/promises";
import path from "path";
import type { SessionRepository, ConnectorRepository } from "../core/ports.js";
import type { AgentSession, Connector } from "../core/types.js";

export class JsonSessionRepository implements SessionRepository {
  constructor(private dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, "sessions");
  }

  async save(session: AgentSession): Promise<void> {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
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
    await writeFile(this.filePath(), JSON.stringify(list, null, 2));
  }
}
