import { board } from "./board.js";
import type { CliCommand } from "./types.js";

export const commands: CliCommand[] = [board];

export const commandNames = commands.map((c) => c.name);

export const commandFlags: Record<string, string[]> = Object.fromEntries(
  commands.map((c) => [c.name, (c.flags ?? []).map((f) => f.flag)])
);

export const flagSpecs = Object.fromEntries(
  commands.flatMap((c) => (c.flags ?? []).map((f) => [f.flag, f]))
);
