import type { ApiClient } from "../lib/api.js";

export interface CliCommandFlag {
  flag: string;
  key: string;
  type: "value" | "boolean";
  multiple?: boolean;
}

export interface CliCommand {
  name: string;
  usage: string;
  flags?: CliCommandFlag[];
  run: (ctx: CliCommandContext) => Promise<void> | void;
}

export interface CliCommandContext {
  client: ApiClient;
  opts: Record<string, any>;
  positional: string[];
  print: (s: string) => void;
  fail: (message: string) => never;
}
