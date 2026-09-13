import express, { type Request, type Response } from "express";
import type { SessionEvent } from "@agent-land/contracts";
import type { Server } from "http";

export class FakeEngine {
  private app = express();
  private server: Server | null = null;
  private _sessions: any[] = [];
  private _events: Map<string, SessionEvent[]> = new Map();
  private _connectors: any[] = [];
  private _providers: any[] = [];
  private _mounts: any[] = [];
  private _should401 = false;
  private _should500 = false;
  broken = false;
  connectionCounts: Map<string, number> = new Map();
  requestCount = 0;
  authHeader: string | null = null;

  constructor() {
    const engine = this;

    function checkAuth(req: Request, res: Response): boolean {
      engine.authHeader = req.headers.authorization ?? null;
      if (req.headers.authorization !== "Basic dGVzdDp0ZXN0") {
        res.status(401).json({ error: "unauthorized" });
        return false;
      }
      engine.requestCount++;
      return true;
    }

    this.app.get("/api/sessions", (req, res) => {
      if (engine._should500) { res.status(500).json({ error: "boom" }); return; }
      if (!checkAuth(req, res)) return;
      res.json({ sessions: engine._sessions });
    });

    this.app.get("/api/sessions/:id", (req, res) => {
      if (engine._should500) { res.status(500).json({ error: "boom" }); return; }
      if (!checkAuth(req, res)) return;
      const id = String(req.params.id);
      const s = engine._sessions.find((x) => x.id === id);
      if (!s) { res.status(404).json({ error: "not found" }); return; }
      res.json({ session: s });
    });

    this.app.get("/api/sessions/:id/events", (req, res) => {
      if (engine._should500) { res.status(500).end(); return; }
      if (!checkAuth(req, res)) return;
      const id = String(req.params.id);
      engine.connectionCounts.set(id, (engine.connectionCounts.get(id) ?? 0) + 1);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const sseWrite = (data: string) => {
        res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
      };

      const events = engine._events.get(id) ?? [];
      let seq = 0;
      for (const ev of events) {
        sseWrite(JSON.stringify({ ...ev, seq: seq++ }));
      }

      const session = engine._sessions.find((x) => x.id === id);
      if (session?.status === "stopped") {
        res.write('event: agent-done\ndata: {"status":"stopped"}\n\n');
        res.end();
        return;
      }

      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(`: ping\n\n`);
      }, 1000);

      req.on("close", () => {
        clearInterval(heartbeat);
      });
    });

    this.app.get("/api/connectors", (req, res) => {
      if (!checkAuth(req, res)) return;
      res.json({ connectors: engine._connectors });
    });

    this.app.get("/api/providers", (req, res) => {
      if (!checkAuth(req, res)) return;
      res.json({ providers: engine._providers });
    });

    this.app.get("/api/mounts", (req, res) => {
      if (!checkAuth(req, res)) return;
      res.json({ mounts: engine._mounts });
    });
  }

  setSessions(sessions: any[]) { this._sessions = sessions; }
  setEvents(id: string, events: SessionEvent[]) { this._events.set(id, events); }
  setConnectors(connectors: any[]) { this._connectors = connectors; }
  setProviders(providers: any[]) { this._providers = providers; }
  setMounts(mounts: any[]) { this._mounts = mounts; }
  fail401() { this._should401 = true; }
  fail500() { this._should500 = true; }
  break() { this.broken = true; }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(0, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not get port"));
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => err ? reject(err) : resolve());
      } else {
        resolve();
      }
    });
  }

  get url(): string {
    const addr = this.server?.address();
    if (addr && typeof addr === "object") {
      return `http://127.0.0.1:${addr.port}`;
    }
    throw new Error("Engine not started");
  }
}