import { describe, it, expect } from "vitest";
import { renderBoard, readBoardFile } from "./board.js";
import type { BoardSnapshot } from "./board.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function snapshot(): BoardSnapshot {
  return {
    generatedAt: "2026-09-19T20:00:00Z",
    tickets: [
      {
        id: "alt-closed",
        title: "Closed ticket",
        status: "closed",
        type: "chore",
        priority: 3,
        assignee: "Marco",
        created: "2026-09-19T00:00:00Z",
        updatedAt: "2026-09-19T20:00:00Z",
        lastStatus: null,
        phase: null,
        parked: true,
        tags: ["loop", "human"],
        deps: [],
      },
      {
        id: "alt-running",
        title: "In-flight ticket",
        status: "in_progress",
        type: "feature",
        priority: 1,
        assignee: "Marco",
        created: "2026-09-19T00:00:00Z",
        updatedAt: "2026-09-19T20:00:00Z",
        lastStatus: "STATUS: PROGRESS",
        phase: "needs-implementation",
        parked: false,
        tags: ["loop", "needs-implementation"],
        deps: ["alt-blocked-dep"],
      },
      {
        id: "alt-blocked-dep",
        title: "Unfinished dependency",
        status: "open",
        type: "task",
        priority: 1,
        assignee: "Marco",
        created: "2026-09-19T00:00:00Z",
        updatedAt: null,
        lastStatus: null,
        phase: null,
        parked: false,
        tags: ["loop"],
        deps: [],
      },
      {
        id: "alt-parked",
        title: "Waiting on human",
        status: "open",
        type: "feature",
        priority: 2,
        assignee: "Marco",
        created: "2026-09-19T00:00:00Z",
        updatedAt: "2026-09-19T20:00:00Z",
        lastStatus: "STATUS: COMPLETED",
        phase: null,
        parked: true,
        tags: ["loop", "human"],
        deps: [],
      },
    ],
  };
}

describe("renderBoard", () => {
  it("groups tickets into funnel columns in order", () => {
    const out = renderBoard(snapshot());
    const loop = out.indexOf("loop (1)");
    const impl = out.indexOf("needs-implementation (1)");
    const human = out.indexOf("human (1)");
    const closed = out.indexOf("closed (1)");
    expect([loop, impl, human, closed].every((i) => i >= 0)).toBe(true);
    expect(loop).toBeLessThan(impl);
    expect(impl).toBeLessThan(human);
    expect(human).toBeLessThan(closed);
  });

  it("marks an in-progress ticket and its unresolved blockers", () => {
    const out = renderBoard(snapshot());
    expect(out).toContain("alt-running  [P1] In-flight ticket · in progress");
    expect(out).toContain("STATUS: PROGRESS");
    expect(out).toContain("blocked by: alt-blocked-dep");
  });

  it("does not show lastStatus or blockers on closed tickets", () => {
    const out = renderBoard(snapshot());
    const closedSection = out.slice(out.indexOf("closed (1)"));
    expect(closedSection).toContain("alt-closed  [P3] Closed ticket");
    expect(closedSection).not.toContain("blocked by");
  });
});

describe("readBoardFile", () => {
  it("parses a valid snapshot and rejects a malformed one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
    const file = path.join(dir, "board.json");
    fs.writeFileSync(file, JSON.stringify(snapshot()));
    expect(readBoardFile(file).tickets).toHaveLength(4);

    fs.writeFileSync(file, JSON.stringify({ nope: true }));
    expect(() => readBoardFile(file)).toThrow(/no "tickets" array/);
  });
});
