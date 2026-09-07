import { describe, it, expect } from "vitest";
import { logSession } from "./log.js";
import type { SseEvent } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function eventLine(ev: Record<string, unknown>): SseEvent {
  return { event: undefined, data: JSON.stringify(ev) };
}

type StreamFn = (
  url: string,
  opts: { authHeader?: string; signal?: AbortSignal }
) => AsyncGenerator<SseEvent>;

function fakeStream(lines: SseEvent[]): StreamFn {
  return async function* (_url, _opts) {
    for (const line of lines) {
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
    },
    urls,
  };
}

describe("logSession", () => {
  it("prints one JSON object per line in json mode (no data: prefix, no extra newlines)", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "status", status: "running", seq: 0 }),
      eventLine({ type: "turn_start", seq: 1 }),
    ];
    const written: string[] = [];
    const out = { write: (t: string) => written.push(t) };

    await logSession(client, "s1", { json: true, out, stream: fakeStream(lines) });

    expect(written).toEqual([
      JSON.stringify({ type: "status", status: "running", seq: 0 }) + "\n",
      JSON.stringify({ type: "turn_start", seq: 1 }) + "\n",
    ]);
  });

  it("never prints an agent-done frame", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "turn_start", seq: 0 }),
      { event: "agent-done", data: '{"status":"stopped"}' },
    ];
    const written: string[] = [];
    const out = { write: (t: string) => written.push(t) };

    await logSession(client, "s1", { json: true, out, stream: fakeStream(lines) });

    expect(written).toEqual([JSON.stringify({ type: "turn_start", seq: 0 }) + "\n"]);
  });

  it("prints a duplicate seq only once", async () => {
    const { client } = makeClient();
    const lines = [
      eventLine({ type: "turn_start", seq: 12 }),
      eventLine({ type: "turn_start", seq: 12 }),
    ];
    const written: string[] = [];
    const out = { write: (t: string) => written.push(t) };

    await logSession(client, "s1", { json: true, out, stream: fakeStream(lines) });

    expect(written).toEqual([JSON.stringify({ type: "turn_start", seq: 12 }) + "\n"]);
  });

  it("delegates non-json mode to the renderer", async () => {
    const { client } = makeClient();
    const lines = [eventLine({ type: "turn_start", seq: 0 })];
    const written: string[] = [];
    const out = { write: (t: string) => written.push(t) };

    await logSession(client, "s1", { out, stream: fakeStream(lines) });

    expect(written).toEqual(["── turn 1 ──\n"]);
  });
});
