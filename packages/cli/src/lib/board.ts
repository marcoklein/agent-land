import fs from "node:fs";
import {
  boardColumn,
  FUNNEL,
  type BoardSnapshot,
  type BoardTicket,
} from "@agent-land/contracts";

export type { BoardSnapshot, BoardTicket } from "@agent-land/contracts";

export function readBoardFile(path: string): BoardSnapshot {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as BoardSnapshot;
  if (!Array.isArray(parsed.tickets)) {
    throw new Error(`board file ${path} has no "tickets" array`);
  }
  return parsed;
}

export function renderBoard(snapshot: BoardSnapshot): string {
  const closed = new Set(
    snapshot.tickets.filter((t) => t.status === "closed").map((t) => t.id)
  );

  const lines: string[] = [];
  lines.push(`agent-land-tickets board (generated ${snapshot.generatedAt})`);

  const byColumn = new Map<string, BoardTicket[]>();
  for (const t of snapshot.tickets) {
    const col = boardColumn(t);
    const list = byColumn.get(col) ?? [];
    list.push(t);
    byColumn.set(col, list);
  }

  for (const col of FUNNEL) {
    const items = byColumn.get(col) ?? [];
    items.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    lines.push("");
    lines.push(`${col} (${items.length})`);
    for (const t of items) {
      const progress = t.status === "in_progress" ? " · in progress" : "";
      lines.push(`  ${t.id}  [P${t.priority}] ${t.title}${progress}`);
      if (t.status !== "closed") {
        if (t.lastStatus) lines.push(`      ${t.lastStatus}`);
        const blocked = t.deps.filter((d) => !closed.has(d));
        if (blocked.length > 0) lines.push(`      blocked by: ${blocked.join(", ")}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
