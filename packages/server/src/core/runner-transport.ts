import type { AgentSession } from "./types.js";
import type { RunnerMessage } from "./runner-protocol.js";

/** A live, bidirectional channel between the control plane and one runner. */
export interface RunnerConnection {
  send(message: RunnerMessage): Promise<void>;
  onMessage(handler: (message: RunnerMessage) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): Promise<void>;
}

/** Accepts a runner's registration for a session and yields its channel. */
export interface RunnerTransport {
  accept(
    session: AgentSession,
    opts: { lastAckedSeq: number; timeoutMs?: number }
  ): Promise<RunnerConnection>;
  abandon(sessionId: string): void;
}
