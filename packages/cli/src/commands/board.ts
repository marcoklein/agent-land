import { readBoardFile, renderBoard } from "../lib/board.js";
import type { CliCommand } from "./types.js";

function resolveBoardPath(opts: Record<string, any>): string {
  if (typeof opts.file === "string" && opts.file.length > 0) return opts.file;
  if (process.env.TICKETS_BOARD_FILE) return process.env.TICKETS_BOARD_FILE;
  if (process.env.TICKETS_REPO_PATH) {
    return `${process.env.TICKETS_REPO_PATH.replace(/\/+$/, "")}/board.json`;
  }
  return "board.json";
}

export const board: CliCommand = {
  name: "board",
  usage: "al board [--file <board.json>]",
  flags: [{ flag: "--file", key: "file", type: "value" }],
  run({ opts, print, fail }) {
    const path = resolveBoardPath(opts);
    let snapshot;
    try {
      snapshot = readBoardFile(path);
    } catch (err) {
      fail(
        `board: cannot read ${path} — generate it in the tickets repo with "tk board > board.json"`
      );
    }
    print(renderBoard(snapshot!));
  },
};
