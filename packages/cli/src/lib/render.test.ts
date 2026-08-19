import { describe, it, expect } from "vitest";
import { wrapText, messageText, createEventRenderer } from "./render.js";

describe("wrapText", () => {
  it("wraps long lines at the width", () => {
    expect(wrapText("a b c d", 5)).toEqual(["a b c", "d"]);
  });

  it("keeps short lines intact", () => {
    expect(wrapText("short", 20)).toEqual(["short"]);
  });

  it("preserves empty lines", () => {
    expect(wrapText("a\n\nb", 20)).toEqual(["a", "", "b"]);
  });

  it("hard-breaks words longer than the width", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("messageText", () => {
  it("joins text blocks with newlines", () => {
    expect(
      messageText({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] })
    ).toBe("one\ntwo");
  });

  it("returns empty for non-messages", () => {
    expect(messageText(null)).toBe("");
    expect(messageText({ content: [{ type: "tool" }] })).toBe("");
  });
});

describe("createEventRenderer", () => {
  it("numbers turns", () => {
    const r = createEventRenderer();
    expect(r.render({ type: "turn_start" })).toEqual([{ kind: "turn", text: "── turn 1 ──" }]);
    expect(r.render({ type: "turn_start" })).toEqual([{ kind: "turn", text: "── turn 2 ──" }]);
  });

  it("streams deltas and finalizes on message_end", () => {
    const r = createEventRenderer();
    expect(r.render({ type: "message_delta", text: "hello " })).toEqual([]);
    expect(r.render({ type: "message_delta", text: "world" })).toEqual([]);
    expect(r.render({ type: "message_end", message: {} })).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  it("falls back to message content when no deltas were seen", () => {
    const r = createEventRenderer();
    const lines = r.render({
      type: "message_end",
      message: { content: [{ type: "text", text: "from content" }] },
    });
    expect(lines).toEqual([{ kind: "text", text: "from content" }]);
  });

  it("finalizes a streaming block on turn_end", () => {
    const r = createEventRenderer();
    r.render({ type: "message_delta", text: "partial" });
    const lines = r.render({ type: "turn_end", message: { content: [] } });
    expect(lines).toEqual([{ kind: "text", text: "partial" }]);
    expect(r.state.streamingText).toBe("");
  });

  it("does not duplicate text on turn_end after message_end", () => {
    const r = createEventRenderer();
    r.render({ type: "message_delta", text: "hi" });
    expect(r.render({ type: "message_end", message: { content: [] } })).toEqual([
      { kind: "text", text: "hi" },
    ]);
    expect(
      r.render({ type: "turn_end", message: { content: [{ type: "text", text: "hi" }] } })
    ).toEqual([]);
  });

  it("renders turn_end message content when no message_end preceded", () => {
    const r = createEventRenderer();
    expect(
      r.render({ type: "turn_end", message: { content: [{ type: "text", text: "done" }] } })
    ).toEqual([{ kind: "text", text: "done" }]);
  });

  it("renders tool start and end", () => {
    const r = createEventRenderer();
    expect(r.render({ type: "tool_start", toolCallId: "c1", toolName: "bash", args: { cmd: "ls" } })).toEqual([
      { kind: "meta", text: '▸ bash {"cmd":"ls"}' },
    ]);
    expect(r.render({ type: "tool_end", toolCallId: "c1", toolName: "bash", isError: false })).toEqual([
      { kind: "ok", text: "✓ bash" },
    ]);
    expect(r.render({ type: "tool_end", toolCallId: "c1", toolName: "bash", isError: true })).toEqual([
      { kind: "error", text: "✗ bash" },
    ]);
  });

  it("renders dialogs per method", () => {
    const r = createEventRenderer();
    expect(r.render({ type: "waiting_for_input", requestId: "r1", method: "confirm", prompt: "Go?" })).toEqual([
      { kind: "dialog", text: "[agent asks] confirm: Go? [y/N]" },
    ]);
    const select = r.render({
      type: "waiting_for_input",
      requestId: "r2",
      method: "select",
      prompt: "Pick",
      options: ["a", "b"],
    });
    expect(select).toEqual([
      { kind: "dialog", text: "[agent asks] select: Pick" },
      { kind: "dialog", text: " 1) a" },
      { kind: "dialog", text: " 2) b" },
    ]);
    expect(r.render({ type: "waiting_for_input", requestId: "r3", method: "input", prompt: "Name?" })).toEqual([
      { kind: "dialog", text: "[agent asks] input Name?" },
    ]);
  });

  it("renders meta lines and ignores passing statuses", () => {
    const r = createEventRenderer();
    expect(r.render({ type: "agent_settled" })).toEqual([{ kind: "meta", text: "· settled" }]);
    expect(r.render({ type: "input_received", requestId: "r1" })).toEqual([{ kind: "meta", text: "· answered" }]);
    expect(r.render({ type: "status", status: "running" })).toEqual([]);
    expect(r.render({ type: "status", status: "stopped" })).toEqual([{ kind: "meta", text: "· session stopped" }]);
  });
});
