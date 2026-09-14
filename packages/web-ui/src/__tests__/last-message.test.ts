import { describe, it, expect } from "vitest";
import { lastAssistantText, createSeqFilter, messageText, createLastMessageCache } from "../last-message.js";
import type { SessionEvent } from "@agent-land/contracts";

describe("messageText", () => {
  it("extracts text blocks from a message", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "Hello" }, { type: "text", text: "World" }] };
    expect(messageText(msg)).toBe("Hello\nWorld");
  });

  it("filters non-text blocks", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "Hi" }, { type: "tool_use", name: "bash" }] };
    expect(messageText(msg)).toBe("Hi");
  });

  it("returns empty string for non-object", () => {
    expect(messageText(null)).toBe("");
    expect(messageText(undefined)).toBe("");
    expect(messageText("string")).toBe("");
  });

  it("returns empty for missing content", () => {
    expect(messageText({})).toBe("");
  });
});

describe("createSeqFilter", () => {
  it("deduplicates by seq number", () => {
    const filter = createSeqFilter();
    const makeEvent = (type: string, seq: number) => ({ type, seq } as SessionEvent & { seq: number });
    expect(filter(makeEvent("message_delta", 1))).toBe(false);
    expect(filter(makeEvent("message_delta", 1))).toBe(true);
    expect(filter(makeEvent("message_delta", 0))).toBe(true);
    expect(filter(makeEvent("message_delta", 2))).toBe(false);
  });

  it("handles events without seq", () => {
    const filter = createSeqFilter();
    expect(filter({ type: "turn_start" } as SessionEvent)).toBe(false);
    expect(filter({ type: "turn_start" } as SessionEvent)).toBe(false);
  });
});

describe("lastAssistantText", () => {
  it("takes text from the last message_end", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "First" }] } },
      { type: "message_delta", text: "Second " },
      { type: "message_delta", text: "half" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Second full" }] } },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("Second full");
  });

  it("falls back to streaming text when message_end has no message", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "Streaming " },
      { type: "message_delta", text: "content" },
      { type: "message_end", message: {} },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("Streaming content");
  });

  it("falls back to streaming on agent_settled", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "Last words" },
      { type: "agent_settled" },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("Last words");
  });

  it("resets streaming on turn_start", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "Before" },
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "After" }] } },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("After");
  });

  it("resets streaming on turn_end", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "Lost" },
      { type: "turn_end" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Kept" }] } },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("Kept");
  });

  it("returns empty for empty events", () => {
    expect(lastAssistantText([])).toBe("");
  });

  it("ignores non-text messages", () => {
    const events: SessionEvent[] = [
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "tool_use", name: "bash" }] } },
    ] as SessionEvent[];
    expect(lastAssistantText(events)).toBe("");
  });
});

describe("createLastMessageCache", () => {
  it("caches by id and updatedAt", () => {
    const cache = createLastMessageCache();
    cache.set("s1", "2026-01-01", "msg1");
    expect(cache.get("s1", "2026-01-01")).toBe("msg1");
    expect(cache.get("s1", "2026-01-02")).toBeNull();
    expect(cache.get("s2", "2026-01-01")).toBeNull();
  });

  it("returns null on empty cache", () => {
    const cache = createLastMessageCache();
    expect(cache.get("s1", "t")).toBeNull();
  });

  it("overwrites existing entry", () => {
    const cache = createLastMessageCache();
    cache.set("s1", "t1", "old");
    cache.set("s1", "t1", "new");
    expect(cache.get("s1", "t1")).toBe("new");
  });
});