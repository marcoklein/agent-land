import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.js";
import type { Express } from "express";

function writeBoard(dir: string): string {
  const file = path.join(dir, "board.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      generatedAt: "2026-09-19T20:00:00Z",
      tickets: [
        {
          id: "alt-inflight",
          title: "In-flight ticket",
          status: "in_progress",
          type: "feature",
          priority: 1,
          assignee: "Marco",
          created: "2026-09-19T00:00:00Z",
          updatedAt: null,
          lastStatus: "STATUS: PROGRESS",
          phase: "needs-implementation",
          parked: false,
          tags: ["loop", "needs-implementation"],
          deps: [],
        },
        {
          id: "alt-done",
          title: "Done ticket",
          status: "closed",
          type: "chore",
          priority: 3,
          assignee: "Marco",
          created: "2026-09-19T00:00:00Z",
          updatedAt: null,
          lastStatus: null,
          phase: null,
          parked: true,
          tags: ["loop", "human"],
          deps: [],
        },
      ],
    })
  );
  return file;
}

describe("board route", () => {
  it("renders the funnel when a board file is configured", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-ui-"));
    const boardFile = writeBoard(dir);
    const app: Express = createApp({
      engineUrl: "",
      port: 0,
      quietMs: 50,
      boardFile,
    });

    const res = await request(app).get("/board");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Tickets board");
    expect(res.text).toContain("In-flight ticket");
    expect(res.text).toContain("needs-implementation");
    expect(res.text).toContain("closed");
  });

  it("renders the nav link for the board plugin", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-ui-"));
    const boardFile = writeBoard(dir);
    const app: Express = createApp({
      engineUrl: "",
      port: 0,
      quietMs: 50,
      boardFile,
    });

    const res = await request(app).get("/board");
    expect(res.text).toContain('href="/board"');
  });

  it("shows an empty state when no board file is configured", async () => {
    const app: Express = createApp({ engineUrl: "", port: 0, quietMs: 50 });
    const res = await request(app).get("/board");
    expect(res.status).toBe(200);
    expect(res.text).toContain("No ticket board configured");
  });

  it("shows an error when the board file is unreadable", async () => {
    const app: Express = createApp({
      engineUrl: "",
      port: 0,
      quietMs: 50,
      boardFile: "/nonexistent/board.json",
    });
    const res = await request(app).get("/board");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Error");
  });
});
