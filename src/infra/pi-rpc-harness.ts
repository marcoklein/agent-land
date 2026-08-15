import { Transform } from "stream";
import type { AgentHarness, AgentHandle, EventStream } from "../core/harness.js";
import { piRpcPreset } from "../core/harness.js";
import type { SessionEvent } from "../core/events.js";
import type { AgentSession } from "../core/types.js";
import type { DockerPort } from "../core/ports.js";

type RpcEvent = Record<string, any>;

export class PiRpcHarness implements AgentHarness {
  constructor(private docker: DockerPort) {}

  async start(session: AgentSession): Promise<AgentHandle> {
    const containerId = `agent-land-pi-${session.id}`;
    const preset = piRpcPreset(session);
    const { stream } = await this.docker.execInteractive(containerId, preset.argv, preset.tty);

    const handlers = new Set<(e: SessionEvent) => void>();
    const emit = (e: SessionEvent) => {
      for (const h of handlers) h(e);
    };

    const accumulated: { text: string } = { text: "" };

    const parser = new RpcOutputParser((line) => {
      let raw: RpcEvent;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      if (!raw || typeof raw.type !== "string") return;
      const events = mapRpcEvent(raw, accumulated);
      if (Array.isArray(events)) {
        for (const e of events) emit(e);
      } else if (events) {
        emit(events);
      }
    });

    stream.pipe(parser);

    let closed = false;
    stream.on("close", () => {
      closed = true;
      emit({ type: "status", status: "stopped" });
    });
    stream.on("error", () => {
      closed = true;
      emit({ type: "status", status: "stopped" });
    });

    const write = (obj: Record<string, unknown>) => {
      if (closed) throw new Error("harness stream is closed");
      stream.write(JSON.stringify(obj) + "\n");
    };

    const events = (): EventStream => ({
      subscribe: (handler) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    });

    const handle: AgentHandle = {
      events,
      prompt: async (message, behavior) => {
        const cmd: Record<string, unknown> = { type: "prompt", message };
        if (behavior) cmd.streamingBehavior = behavior;
        write(cmd);
      },
      respond: async (requestId, value) => {
        write({ type: "extension_ui_response", id: requestId, ...value });
      },
      abort: async () => {
        write({ type: "abort" });
      },
      stop: async () => {
        try {
          stream.end();
        } catch {}
      },
    };

    return handle;
  }
}

const DIALOG_METHODS = new Set(["confirm", "input", "select", "editor"]);

function mapRpcEvent(
  raw: RpcEvent,
  accumulated: { text: string }
): SessionEvent | SessionEvent[] | null {
  switch (raw.type) {
    case "agent_start":
      return { type: "status", status: "running" };

    case "agent_settled":
      return { type: "agent_settled" };

    case "agent_end":
      return null;

    case "turn_start":
      return { type: "turn_start" };

    case "turn_end":
      return {
        type: "turn_end",
        message: raw.message,
        toolResults: raw.toolResults,
      };

    case "message_start":
      accumulated.text = "";
      return null;

    case "message_update": {
      const ame = raw.assistantMessageEvent;
      if (ame && ame.type === "text_delta") {
        const delta: string = ame.delta ?? "";
        accumulated.text += delta;
        return { type: "message_delta", text: delta };
      }
      return null;
    }

    case "message_end": {
      const message: any = raw.message ?? {};
      if (accumulated.text && !extractText(message)) {
        message.content = accumulated.text;
      }
      accumulated.text = "";
      return { type: "message_end", message };
    }

    case "tool_execution_start":
      return {
        type: "tool_start",
        toolCallId: raw.toolCallId ?? "",
        toolName: raw.toolName ?? "",
        args: raw.args,
      };

    case "tool_execution_update":
      return {
        type: "tool_update",
        toolCallId: raw.toolCallId ?? "",
        toolName: raw.toolName ?? "",
        partial: raw.partialResult ?? raw.partial ?? raw.output,
      };

    case "tool_execution_end":
      return {
        type: "tool_end",
        toolCallId: raw.toolCallId ?? "",
        toolName: raw.toolName ?? "",
        result: raw.result,
        isError: !!raw.isError,
      };

    case "extension_ui_request": {
      const method = raw.method;
      if (!DIALOG_METHODS.has(method)) return null;
      return {
        type: "waiting_for_input",
        requestId: raw.id ?? "",
        method,
        prompt: raw.title ?? raw.message,
        options: raw.options,
      };
    }

    default:
      return null;
  }
}

function extractText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b?.text ?? "")
      .join("");
  }
  return "";
}

class RpcOutputParser extends Transform {
  private buffer = Buffer.alloc(0);
  private multiplexed: boolean | null = null;
  private lineBuffer = "";

  constructor(private onLine: (line: string) => void) {
    super();
  }

  _transform(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
    callback();
  }

  _flush(callback: () => void): void {
    this.drain();
    if (this.lineBuffer.length > 0) {
      this.onLine(this.lineBuffer);
      this.lineBuffer = "";
    }
    callback();
  }

  private drain(): void {
    if (this.multiplexed === null) this.detect();

    if (this.multiplexed) {
      while (this.buffer.length >= 8) {
        const streamType = this.buffer.readUInt8(0);
        const frameSize = this.buffer.readUInt32BE(4);
        if (streamType < 1 || streamType > 2) {
          this.multiplexed = false;
          break;
        }
        if (frameSize < 0 || frameSize > 64 * 1024 * 1024) {
          this.multiplexed = false;
          break;
        }
        if (this.buffer.length < 8 + frameSize) break;
        const payload = this.buffer.subarray(8, 8 + frameSize);
        this.buffer = this.buffer.subarray(8 + frameSize);
        this.feed(payload.toString("utf-8"));
      }
    }

    if (this.multiplexed === false && this.buffer.length > 0) {
      this.feed(this.buffer.toString("utf-8"));
      this.buffer = Buffer.alloc(0);
    }
  }

  private detect(): void {
    if (this.buffer.length < 8) return;
    const streamType = this.buffer.readUInt8(0);
    const frameSize = this.buffer.readUInt32BE(4);
    this.multiplexed = (streamType >= 1 && streamType <= 2) && frameSize >= 0 && frameSize <= 64 * 1024 * 1024;
  }

  private feed(text: string): void {
    this.lineBuffer += text;
    let idx: number;
    while ((idx = this.lineBuffer.indexOf("\n")) !== -1) {
      let line = this.lineBuffer.slice(0, idx);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      if (line.length > 0) this.onLine(line);
    }
  }
}
