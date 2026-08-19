import type { AgentSession } from "./types.js";
import type { SessionEvent } from "./events.js";

export type EventStream = {
  subscribe(handler: (e: SessionEvent) => void): () => void;
};

export interface AgentHarness {
  start(session: AgentSession): Promise<AgentHandle>;
}

export interface AgentHandle {
  events(): EventStream;
  prompt(message: string, behavior?: "steer" | "followUp"): Promise<void>;
  respond(
    requestId: string,
    value: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<void>;
  abort(): Promise<void>;
  stop(): Promise<void>;
}

export type ProgramSpec = { argv: string[]; tty: boolean };

export function agentContainerId(sessionId: string): string {
  return `agent-land-pi-${sessionId}`;
}

export function piRpcPreset(session: AgentSession): ProgramSpec {
  return {
    argv: [
      "pi",
      "--mode",
      "rpc",
      "--provider",
      "opencode-go",
      "--model",
      session.model,
      "--session-dir",
      session.sessionDir,
      "--session-id",
      session.id,
    ],
    tty: false,
  };
}
