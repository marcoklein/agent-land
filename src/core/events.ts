import type { SessionStatus } from "./types.js";

export type SessionEvent =
  | { type: "status"; status: SessionStatus }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
  | { type: "message_delta"; text: string }
  | { type: "message_end"; message: unknown }
  | { type: "tool_start"; toolCallId: string; toolName: string; args?: unknown }
  | { type: "tool_update"; toolCallId: string; toolName: string; partial?: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result?: unknown; isError: boolean }
  | { type: "agent_settled" }
  | { type: "waiting_for_input"; requestId: string; method: string; prompt?: string; options?: string[] }
  | { type: "input_received"; requestId: string };

export type SequencedEvent = { seq: number; event: SessionEvent };

export type SequencedEventStream = {
  subscribe(handler: (e: SequencedEvent) => void): () => void;
};
