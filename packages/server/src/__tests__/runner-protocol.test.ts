import { describe, it, expect } from "vitest";
import { encodeRunnerMessage, decodeRunnerMessage } from "../core/runner-protocol.js";
import type { RunnerMessage } from "../core/runner-protocol.js";

describe("runner protocol", () => {
  it("round-trips every message shape", () => {
    const cases: RunnerMessage[] = [
      { type: "register", sessionId: "abc", runnerVersion: "0.1.0", protocolVersion: 1, lastAckedSeq: 3 },
      { type: "event", seq: 7, event: { type: "turn_start" } },
      {
        type: "event_batch",
        events: [{ seq: 1, event: { type: "turn_start" } }, { seq: 2, event: { type: "agent_settled" } }],
      },
      { type: "heartbeat", lastSeq: 9 },
      { type: "command_result", id: "cmd-1", ok: true },
      { type: "error", code: "boom", message: "it broke" },
      { type: "registered", sessionId: "abc", resumeFromSeq: 4, heartbeatIntervalMs: 30000 },
      { type: "command", id: "cmd-1", name: "prompt", payload: { message: "hi" } },
      { type: "ack", seq: 9 },
    ];
    for (const message of cases) {
      expect(decodeRunnerMessage(encodeRunnerMessage(message))).toEqual(message);
    }
  });

  it("rejects a mismatched protocol version", () => {
    expect(() => decodeRunnerMessage(JSON.stringify({ v: 99, type: "ack", seq: 1 }))).toThrow();
  });
});
