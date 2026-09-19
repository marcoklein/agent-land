import type { SessionEvent } from "./events.js";

export const RUNNER_PROTOCOL_VERSION = 1;

/** Runner → control plane. */
export type RunnerToControl =
  | {
      type: "register";
      sessionId: string;
      runnerVersion: string;
      protocolVersion: number;
      lastAckedSeq: number;
    }
  | { type: "event"; seq: number; event: SessionEvent }
  | { type: "event_batch"; events: { seq: number; event: SessionEvent }[] }
  | { type: "heartbeat"; lastSeq: number }
  | { type: "command_result"; id: string; ok: boolean; error?: string }
  | { type: "error"; code: string; message: string };

/** Control plane → runner. */
export type ControlToRunner =
  | { type: "registered"; sessionId: string; resumeFromSeq: number; heartbeatIntervalMs: number }
  | { type: "command"; id: string; name: "prompt" | "respond" | "abort"; payload: unknown }
  | { type: "ack"; seq: number }
  | { type: "error"; code: string; message: string };

export type RunnerMessage = RunnerToControl | ControlToRunner;

/** Encodes a message for the wire, tagging it with the protocol version. */
export function encodeRunnerMessage(message: RunnerMessage): string {
  return JSON.stringify({ v: RUNNER_PROTOCOL_VERSION, ...message });
}

/** Decodes a wire frame. The version tag is validated and stripped. */
export function decodeRunnerMessage(raw: string): RunnerMessage {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("runner frame is not an object");
  }
  if (parsed.v !== RUNNER_PROTOCOL_VERSION) {
    throw new Error(`unsupported runner protocol version: ${String(parsed.v)}`);
  }
  const { v: _v, ...message } = parsed;
  if (typeof message.type !== "string") {
    throw new Error("runner frame missing message type");
  }
  return message as unknown as RunnerMessage;
}
