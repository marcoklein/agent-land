import { describe, it, expect } from "vitest";
import { PassThrough } from "stream";
import { PiRpcHarness } from "../infra/pi-rpc-harness.js";
import type { DockerPort } from "../core/ports.js";
import type { SessionEvent } from "../core/events.js";
import type { AgentSession } from "../core/types.js";

function makeSession(): AgentSession {
  return {
    id: "abc12345",
    status: "idle",
    permissionPolicy: "auto",
    sessionDir: "/sessions/abc12345",
    connectors: [],
    model: "test-model",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function harnessWithStream(stream: PassThrough) {
  const docker: DockerPort = {
    createInteractiveContainer: async () => ({} as never),
    execInteractive: async () => ({ stream: stream as never, resize: async () => {} }),
    execCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    removeContainer: async () => {},
    removeVolume: async () => {},
    ensureAgentImage: async () => {},
    containerExists: async () => false,
  };
  return new PiRpcHarness(docker);
}

describe("PiRpcHarness", () => {
  it("replays events emitted before the first subscription", async () => {
    const stream = new PassThrough();
    const harness = harnessWithStream(stream);

    const handle = await harness.start(makeSession());

    stream.write('{"type":"agent_start"}\n');
    await new Promise((r) => setImmediate(r));

    const received: SessionEvent[] = [];
    handle.events().subscribe((e) => received.push(e));

    expect(received).toEqual([{ type: "status", status: "running" }]);

    stream.write('{"type":"agent_settled"}\n');
    await new Promise((r) => setImmediate(r));

    expect(received.at(-1)).toEqual({ type: "agent_settled" });
  });

  it("delivers live events to a subscribed handler", async () => {
    const stream = new PassThrough();
    const harness = harnessWithStream(stream);

    const handle = await harness.start(makeSession());
    const received: SessionEvent[] = [];
    handle.events().subscribe((e) => received.push(e));

    stream.write('{"type":"turn_start"}\n');
    await new Promise((r) => setImmediate(r));

    expect(received).toEqual([{ type: "turn_start" }]);
  });

  it("emits a single stopped status on close after error", async () => {
    const stream = new PassThrough();
    const harness = harnessWithStream(stream);

    const handle = await harness.start(makeSession());
    const received: SessionEvent[] = [];
    handle.events().subscribe((e) => received.push(e));

    stream.emit("error", new Error("boom"));
    stream.end();
    await new Promise((r) => setImmediate(r));

    const stopped = received.filter(
      (e) => e.type === "status" && e.status === "stopped"
    );
    expect(stopped.length).toBe(1);
  });
});
