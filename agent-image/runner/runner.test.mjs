import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeMessage, decodeMessage } from "./protocol.mjs";
import { mapRpcEvent } from "./pi-rpc.mjs";
import { Spool } from "./spool.mjs";

test("protocol round-trips messages", () => {
  const cases = [
    { type: "register", sessionId: "abc", runnerVersion: "0.1.0", protocolVersion: 1, lastAckedSeq: 0 },
    { type: "event", seq: 1, event: { type: "turn_start" } },
    { type: "ack", seq: 3 },
  ];
  for (const m of cases) {
    assert.deepEqual(decodeMessage(encodeMessage(m)), m);
  }
});

test("mapRpcEvent maps pi-RPC events to the canonical vocabulary", () => {
  const accumulated = { text: "" };
  assert.deepEqual(mapRpcEvent({ type: "agent_start" }, accumulated), { type: "status", status: "running" });
  assert.deepEqual(mapRpcEvent({ type: "turn_start" }, accumulated), { type: "turn_start" });
  assert.deepEqual(
    mapRpcEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } }, accumulated),
    { type: "message_delta", text: "hi" }
  );
  assert.deepEqual(
    mapRpcEvent({ type: "extension_ui_request", method: "confirm", id: "r1", title: "ok?" }, accumulated),
    { type: "waiting_for_input", requestId: "r1", method: "confirm", prompt: "ok?", options: undefined }
  );
  assert.equal(mapRpcEvent({ type: "agent_end" }, accumulated), null);
});

test("spool replays from resumeFromSeq and trims to ack", () => {
  const spool = new Spool();
  spool.append(1, { type: "turn_start" });
  spool.append(2, { type: "agent_settled" });
  spool.append(3, { type: "status", status: "stopped" });

  assert.deepEqual(spool.replayFrom(2), [{ seq: 2, event: { type: "agent_settled" } }, { seq: 3, event: { type: "status", status: "stopped" } }]);

  spool.trimTo(2);
  assert.deepEqual(spool.replayFrom(1), [{ seq: 3, event: { type: "status", status: "stopped" } }]);
  assert.equal(spool.lastSeq, 3);
});
