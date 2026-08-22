import { describe, it, expect } from "vitest";
import { runSession, watchSession, createSeqFilter } from "./ops.js";
import type { SseEvent } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function eventLine(ev: Record<string, unknown>): SseEvent {
  return { event: undefined, data: JSON.stringify(ev) };
}

type StreamFn = (
  url: string,
  opts: { authHeader?: string; signal?: AbortSignal }
) => AsyncGenerator<SseEvent>;

function fakeStream(lines: SseEvent[], { onAbort }: { onAbort?: () => void } = {}): StreamFn {
  return async function* (url, { signal }) {
    for (const line of lines) {
      if (signal && signal.aborted) {
        if (onAbort) onAbort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      yield line;
      await sleep(1);
    }
  };
}

function makeClient() {
  const urls: string[] = [];
  return {
    client: {
      eventsUrl: (id: string) => {
        const url = `https://example.test/api/sessions/${id}/events`;
        urls.push(url);
        return url;
      },
      authHeader: "Basic x",
      respond: async () => {},
    },
    urls,
  };
}

describe("runSession", () => {
  it("settles and extracts the final message", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "status", status: "running", seq: 0 }),
      eventLine({ type: "message_delta", text: "Hel", seq: 1 }),
      eventLine({ type: "message_delta", text: "lo", seq: 2 }),
      eventLine({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
        seq: 3,
      }),
      eventLine({ type: "agent_settled", seq: 4 }),
    ];
    const out = { write: () => {} };

    const result = await runSession(client, "s1", { out, stream: fakeStream(lines) });

    expect(result.settled).toBe(true);
    expect(result.finalMessage).toBe("Hello");
  });

  it("falls back to streamed text when message_end has no message", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "message_delta", text: "streamed", seq: 0 }),
      eventLine({ type: "message_end", message: null, seq: 1 }),
      eventLine({ type: "agent_settled", seq: 2 }),
    ];

    const result = await runSession(client, "s1", {
      out: { write: () => {} },
      stream: fakeStream(lines),
    });

    expect(result.finalMessage).toBe("streamed");
  });

  it("skips duplicate sequences after a reconnect", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "message_delta", text: "once", seq: 10 }),
      eventLine({ type: "message_end", message: null, seq: 11 }),
      eventLine({ type: "agent_settled", seq: 12 }),
      eventLine({ type: "agent_settled", seq: 12 }),
    ];

    const result = await runSession(client, "s1", {
      out: { write: () => {} },
      stream: fakeStream(lines),
    });

    expect(result.finalMessage).toBe("once");
  });

  it("reports stopped on agent-done", async () => {
    const { client } = makeClient();
    const result = await runSession(client, "s1", {
      out: { write: () => {} },
      stream: fakeStream([{ event: "agent-done", data: '{"status":"stopped"}' }]),
    });

    expect(result.stopped).toBe(true);
    expect(result.settled).toBe(false);
  });

  it("times out when the stream never settles", async () => {
    const { client } = makeClient();
    const never: StreamFn = async function* (_url, { signal }) {
      while (!signal?.aborted) {
        yield { event: "comment", data: "" };
        await sleep(5);
      }
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };

    const result = await runSession(client, "s1", {
      timeoutMs: 100,
      out: { write: () => {} },
      stream: never,
    });

    expect(result.timedOut).toBe(true);
  });

  it("answers dialogs through the onDialog hook", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({
        type: "waiting_for_input",
        requestId: "r1",
        method: "confirm",
        prompt: "proceed?",
        seq: 0,
      }),
      eventLine({ type: "input_received", requestId: "r1", seq: 1 }),
      eventLine({ type: "agent_settled", seq: 2 }),
    ];

    const result = await runSession(client, "s1", {
      out: { write: () => {} },
      onDialog: async () => ({ confirmed: true }),
      stream: fakeStream(lines),
    });

    expect(result.settled).toBe(true);
  });

  it("stops when a dialog cannot be answered", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "waiting_for_input", requestId: "r1", method: "input", seq: 0 }),
    ];

    const result = await runSession(client, "s1", {
      out: { write: () => {} },
      stream: fakeStream(lines),
    });

    expect(result.stopped).toBe(true);
  });

  it("rethrows when a dialog response fails instead of deadlocking", async () => {
    const client = {
      eventsUrl: () => "https://example.test/api/sessions/s1/events",
      authHeader: "Basic x",
      respond: async () => {
        throw new Error("HTTP 409");
      },
    };
    const lines = [
      eventLine({ type: "waiting_for_input", requestId: "r1", method: "confirm", seq: 0 }),
    ];

    await expect(
      runSession(client, "s1", {
        out: { write: () => {} },
        onDialog: async () => ({ confirmed: true }),
        stream: fakeStream(lines),
      })
    ).rejects.toThrow(/respond failed/);
  });

  it("honors the timeout across reconnects with a single controller", async () => {
    const { client } = makeClient();
    const neverSettling: StreamFn = async function* (_url, { signal }) {
      while (!signal?.aborted) {
        yield { event: "comment", data: "" };
        await sleep(5);
      }
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };

    const result = await runSession(client, "s1", {
      timeoutMs: 100,
      out: { write: () => {} },
      stream: neverSettling,
    });

    expect(result.timedOut).toBe(true);
  });
});

describe("createSeqFilter", () => {
  it("drops duplicate and out-of-order sequences", () => {
    const filter = createSeqFilter();
    expect(filter({ type: "turn_start", seq: 1 })).toBe(false);
    expect(filter({ type: "turn_start", seq: 1 })).toBe(true);
    expect(filter({ type: "turn_start", seq: 0 })).toBe(true);
    expect(filter({ type: "turn_start", seq: 2 })).toBe(false);
  });

  it("passes events without a sequence number", () => {
    const filter = createSeqFilter();
    expect(filter({ type: "agent_settled" })).toBe(false);
    expect(filter({ type: "agent_settled" })).toBe(false);
  });
});

describe("watchSession", () => {
  it("uses live mode and prints settle/stop notifications", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "agent_settled", seq: 7 }),
      eventLine({ type: "agent_settled", seq: 7 }),
      eventLine({ type: "status", status: "stopped", seq: 8 }),
    ];
    const printed: string[] = [];
    const out = { write: (t: string) => printed.push(t) };
    const seenUrls: string[] = [];
    const base = fakeStream(lines);
    const stream: StreamFn = async function* (url, opts) {
      seenUrls.push(url);
      yield* base(url, opts);
    };

    await watchSession(client, "s1", { out, stream });

    expect(seenUrls[0]).toContain("?live=1");
    expect(printed).toEqual(["s1: settled\n", "s1: stopped\n"]);
  });

  it("ignores history events when attached without live mode is not used", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "turn_start", seq: 0 }),
      eventLine({ type: "status", status: "stopped", seq: 1 }),
    ];
    const printed: string[] = [];
    const out = { write: (t: string) => printed.push(t) };

    await watchSession(client, "s1", { out, live: false, stream: fakeStream(lines) });

    expect(printed).toEqual(["s1: stopped\n"]);
  });

  it("fails fast on a 404 instead of retrying forever", async () => {
    const { client } = makeClient();
    const stream = async function* () {
      throw Object.assign(new Error("SSE request failed: HTTP 404"), { status: 404 });
    };

    await expect(watchSession(client, "s1", { out: { write: () => {} }, stream })).rejects.toThrow(
      /HTTP 404/
    );
  });

  it("reports stopped when the stream ends with agent-done", async () => {
    const { client } = makeClient();
    const printed: string[] = [];
    const out = { write: (t: string) => printed.push(t) };
    const stream: StreamFn = async function* () {
      yield { event: "agent-done", data: '{"status":"stopped"}' };
    };

    await watchSession(client, "s1", { out, stream });

    expect(printed).toEqual(["s1: stopped\n"]);
  });
});
