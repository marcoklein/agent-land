import { describe, it, expect } from "vitest";
import { getSessionStatus, lastAssistantText, formatStatus, statusJson } from "./status.js";
import type { AgentEvent, Session, SseEvent } from "./types.js";

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    status: "running",
    permissionPolicy: "auto",
    sessionDir: "/tmp/s1",
    connectors: [],
    model: "deepseek-v4-pro",
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:01:00.000Z",
    ...overrides,
  };
}

function makeClient(session: Session = makeSession()) {
  const urls: string[] = [];
  return {
    client: {
      getSession: async () => ({ session }),
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

describe("lastAssistantText", () => {
  it("takes the text of the last message_end with a message", () => {
    const events: AgentEvent[] = [
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
    ];
    expect(lastAssistantText(events)).toBe("Hello");
  });

  it("falls back to streamed text when message_end has no message", () => {
    const events: AgentEvent[] = [
      { type: "message_delta", text: "streamed" },
      { type: "message_end", message: {} },
    ];
    expect(lastAssistantText(events)).toBe("streamed");
  });

  it("reports the last completed turn's text across two turns", () => {
    const events: AgentEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "first" },
      { type: "message_end", message: { content: [{ type: "text", text: "first" }] } },
      { type: "turn_end" },
      { type: "turn_start" },
      { type: "message_delta", text: "second" },
      { type: "message_end", message: { content: [{ type: "text", text: "second" }] } },
    ];
    expect(lastAssistantText(events)).toBe("second");
  });

  it("reports the previous completed turn for a mid-turn session", () => {
    const events: AgentEvent[] = [
      { type: "turn_start" },
      { type: "message_end", message: { content: [{ type: "text", text: "done" }] } },
      { type: "turn_end" },
      { type: "turn_start" },
      { type: "message_delta", text: "in progress" },
    ];
    expect(lastAssistantText(events)).toBe("done");
  });

  it("returns empty for a mid-turn session with no completed turn", () => {
    const events: AgentEvent[] = [
      { type: "turn_start" },
      { type: "message_delta", text: "in progress" },
    ];
    expect(lastAssistantText(events)).toBe("");
  });

  it("fills from streaming on agent_settled only when nothing is finalized", () => {
    expect(lastAssistantText([
      { type: "turn_start" },
      { type: "message_delta", text: "tail" },
      { type: "agent_settled" },
    ])).toBe("tail");
  });
});

describe("getSessionStatus", () => {
  it("fetches the record and returns it with the last message", async () => {
    const session = makeSession();
    const { client } = makeClient(session);
    const lines = [
      eventLine({ type: "message_delta", text: "Hel", seq: 0 }),
      eventLine({ type: "message_delta", text: "lo", seq: 1 }),
      eventLine({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
        seq: 2,
      }),
    ];

    const result = await getSessionStatus(client, "s1", { stream: fakeStream(lines) });

    expect(result.session).toBe(session);
    expect(result.lastMessage).toBe("Hello");
  });

  it("applies sequence dedupe before reducing", async () => {
    const session = makeSession();
    const { client } = makeClient(session);
    const lines = [
      eventLine({ type: "message_delta", text: "A", seq: 10 }),
      eventLine({ type: "message_delta", text: "B", seq: 10 }),
      eventLine({ type: "message_end", message: {}, seq: 11 }),
    ];

    const result = await getSessionStatus(client, "s1", { stream: fakeStream(lines) });

    expect(result.lastMessage).toBe("A");
  });

  it("stops on agent-done", async () => {
    const session = makeSession();
    const { client } = makeClient(session);
    const lines = [
      eventLine({ type: "message_delta", text: "Hel", seq: 0 }),
      eventLine({ type: "message_delta", text: "lo", seq: 1 }),
      eventLine({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
        seq: 2,
      }),
      { event: "agent-done", data: '{"status":"stopped"}' },
      eventLine({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ignored" }] },
        seq: 3,
      }),
    ];

    const result = await getSessionStatus(client, "s1", { stream: fakeStream(lines) });

    expect(result.lastMessage).toBe("Hello");
  });

  it("rethrows a stream error untouched (e.g. a 404)", async () => {
    const session = makeSession();
    const { client } = makeClient(session);
    const stream = async function* () {
      throw Object.assign(new Error("SSE request failed: HTTP 404"), { status: 404 });
    };

    await expect(getSessionStatus(client, "s1", { stream })).rejects.toThrow(/HTTP 404/);
  });
});

describe("formatStatus", () => {
  it("renders mounts as source:target and (none) when empty", () => {
    const withMounts = formatStatus({
      session: makeSession({
        mounts: [{ source: "repo", target: "/repo" }],
      }),
      lastMessage: "",
    });
    expect(withMounts).toContain("mounts: repo:/repo");

    const empty = formatStatus({ session: makeSession(), lastMessage: "" });
    expect(empty).toContain("mounts: (none)");
    expect(empty).toContain("connectors: (none)");
  });

  it("renders the last message and (none) fallback", () => {
    const lines = formatStatus({
      session: makeSession(),
      lastMessage: "hi there",
    });
    expect(lines).toContain("last message: hi there");

    const none = formatStatus({ session: makeSession(), lastMessage: "" });
    expect(none).toContain("last message: (none)");
  });

  it("includes the waiting-for line only when waitingFor is present", () => {
    const without = formatStatus({ session: makeSession(), lastMessage: "" });
    expect(without.find((l) => l.startsWith("waiting for:"))).toBeUndefined();

    const withWaiting = formatStatus({
      session: makeSession({
        status: "waiting_for_input",
        waitingFor: { requestId: "r1", method: "confirm", prompt: "proceed?" },
      }),
      lastMessage: "",
    });
    expect(withWaiting).toContain("waiting for: confirm — proceed?");
  });
});

describe("statusJson", () => {
  it("emits a single object containing session and lastMessage", () => {
    const session = makeSession();
    const json = statusJson({ session, lastMessage: "hi" });

    expect(json.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ session, lastMessage: "hi" });
  });
});
