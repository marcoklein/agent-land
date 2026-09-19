import fs from "node:fs";
import { Router } from "express";
import {
  boardColumn,
  FUNNEL,
  type BoardSnapshot,
  type BoardTicket,
} from "@agent-land/contracts";
import type { WebUiPlugin } from "./types.js";

interface BoardColumn {
  name: string;
  count: number;
  tickets: BoardTicket[];
}

function buildColumns(snapshot: BoardSnapshot): BoardColumn[] {
  const byColumn = new Map<string, BoardTicket[]>();
  for (const t of snapshot.tickets) {
    const col = boardColumn(t);
    const list = byColumn.get(col) ?? [];
    list.push(t);
    byColumn.set(col, list);
  }
  return FUNNEL.map((name) => {
    const tickets = byColumn.get(name) ?? [];
    tickets.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    return { name, count: tickets.length, tickets };
  });
}

export const boardPlugin: WebUiPlugin = {
  path: "/board",
  navLabel: "Board",
  createRouter({ config, renderView }) {
    const router = Router();

    router.get("/", (_req, res) => {
      if (!config.boardFile) {
        return renderView(res, "board", {
          configured: false,
          generatedAt: null,
          columns: [],
          error: null,
        });
      }

      try {
        const raw = fs.readFileSync(config.boardFile, "utf8");
        const snapshot = JSON.parse(raw) as BoardSnapshot;
        return renderView(res, "board", {
          configured: true,
          generatedAt: snapshot.generatedAt ?? null,
          columns: buildColumns(snapshot),
          error: null,
        });
      } catch (err) {
        return renderView(res, "board", {
          configured: true,
          generatedAt: null,
          columns: [],
          error: (err as Error).message,
        });
      }
    });

    return router;
  },
};
