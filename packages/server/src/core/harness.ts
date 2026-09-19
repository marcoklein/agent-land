import type { AgentSession } from "./types.js";
import { DEFAULT_PROVIDER_ID } from "./types.js";
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

export function agentContainerId(sessionId: string): string {
  return `agent-land-pi-${sessionId}`;
}

export function piArgv(id: string, provider: string | undefined, model: string): string[] {
  return [
    "pi",
    "--mode",
    "rpc",
    "--provider",
    provider ?? DEFAULT_PROVIDER_ID,
    "--model",
    model,
    "--session-dir",
    `/sessions/${id}`,
    "--session-id",
    id,
  ];
}
