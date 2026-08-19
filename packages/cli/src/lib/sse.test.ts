import { describe, it, expect } from "vitest";
import { SseParser, parseSseEvent } from "./sse.js";

describe("parseSseEvent", () => {
  it("parses a data event", () => {
    expect(parseSseEvent('data: {"type":"turn_start"}')).toEqual({
      event: undefined,
      data: '{"type":"turn_start"}',
    });
  });

  it("joins multi-line data with newlines", () => {
    expect(parseSseEvent('data: {"a":\ndata: 1}')).toEqual({
      event: undefined,
      data: '{"a":\n1}',
    });
  });

  it("captures the event name", () => {
    expect(parseSseEvent('event: agent-done\ndata: {"status":"stopped"}')).toEqual({
      event: "agent-done",
      data: '{"status":"stopped"}',
    });
  });

  it("ignores comment-only events (heartbeats)", () => {
    expect(parseSseEvent(": ping")).toBeNull();
  });

  it("ignores comments mixed into data events", () => {
    expect(parseSseEvent(": ping\ndata: x")).toEqual({ event: undefined, data: "x" });
  });
});

describe("SseParser", () => {
  it("splits events on blank lines", () => {
    const p = new SseParser();
    expect(p.push('data: a\n\ndata: b\n\n')).toEqual([
      { event: undefined, data: "a" },
      { event: undefined, data: "b" },
    ]);
  });

  it("handles events split across chunks", () => {
    const p = new SseParser();
    expect(p.push("data: hel")).toEqual([]);
    expect(p.push('lo\n\ndata: x\n\n')).toEqual([
      { event: undefined, data: "hello" },
      { event: undefined, data: "x" },
    ]);
  });

  it("drops heartbeat events", () => {
    const p = new SseParser();
    expect(p.push(': ping\n\ndata: real\n\n')).toEqual([{ event: undefined, data: "real" }]);
  });

  it("parses agent-done with its event name", () => {
    const p = new SseParser();
    expect(p.push('event: agent-done\ndata: {"status":"stopped"}\n\n')).toEqual([
      { event: "agent-done", data: '{"status":"stopped"}' },
    ]);
  });

  it("tolerates CRLF line endings", () => {
    const p = new SseParser();
    expect(p.push("data: a\r\n\r\ndata: b\r\n\r\n")).toEqual([
      { event: undefined, data: "a" },
      { event: undefined, data: "b" },
    ]);
  });

  it("flushes an unterminated final event", () => {
    const p = new SseParser();
    expect(p.push("data: a\n\n")).toEqual([{ event: undefined, data: "a" }]);
    expect(p.push("data: tail")).toEqual([]);
    expect(p.flush()).toEqual([{ event: undefined, data: "tail" }]);
    expect(p.flush()).toEqual([]);
  });
});
