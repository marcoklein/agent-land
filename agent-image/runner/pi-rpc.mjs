const DIALOG_METHODS = new Set(["confirm", "input", "select", "editor"]);

/** Maps one pi-RPC JSON event to zero, one, or more canonical SessionEvents. */
export function mapRpcEvent(raw, accumulated) {
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
      return { type: "turn_end", message: raw.message, toolResults: raw.toolResults };
    case "message_start":
      accumulated.text = "";
      return null;
    case "message_update": {
      const ame = raw.assistantMessageEvent;
      if (ame && ame.type === "text_delta") {
        const delta = ame.delta ?? "";
        accumulated.text += delta;
        return { type: "message_delta", text: delta };
      }
      return null;
    }
    case "message_end": {
      const message = raw.message ?? {};
      if (accumulated.text && !extractText(message)) {
        message.content = accumulated.text;
      }
      accumulated.text = "";
      return { type: "message_end", message };
    }
    case "tool_execution_start":
      return { type: "tool_start", toolCallId: raw.toolCallId ?? "", toolName: raw.toolName ?? "", args: raw.args };
    case "tool_execution_update":
      return { type: "tool_update", toolCallId: raw.toolCallId ?? "", toolName: raw.toolName ?? "", partial: raw.partialResult ?? raw.partial ?? raw.output };
    case "tool_execution_end":
      return { type: "tool_end", toolCallId: raw.toolCallId ?? "", toolName: raw.toolName ?? "", result: raw.result, isError: !!raw.isError };
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

function extractText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === "text")
      .map((b) => b?.text ?? "")
      .join("");
  }
  return "";
}

/**
 * Feeds raw pi stdout bytes to a per-line callback, tolerating both plain
 * newline-delimited JSON and pi's multiplexed 8-byte-header framing.
 */
export function createRpcLineParser(onLine) {
  let buffer = Buffer.alloc(0);
  let multiplexed = null;
  let lineBuffer = "";

  const feed = (text) => {
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf("\n")) !== -1) {
      let line = lineBuffer.slice(0, idx);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lineBuffer = lineBuffer.slice(idx + 1);
      if (line.length > 0) onLine(line);
    }
  };

  const drain = () => {
    if (multiplexed === null) {
      if (buffer.length < 8) return;
      const streamType = buffer.readUInt8(0);
      const frameSize = buffer.readUInt32BE(4);
      multiplexed = streamType >= 1 && streamType <= 2 && frameSize >= 0 && frameSize <= 64 * 1024 * 1024;
    }
    if (multiplexed) {
      while (buffer.length >= 8) {
        const streamType = buffer.readUInt8(0);
        const frameSize = buffer.readUInt32BE(4);
        if (streamType < 1 || streamType > 2 || frameSize < 0 || frameSize > 64 * 1024 * 1024) {
          multiplexed = false;
          break;
        }
        if (buffer.length < 8 + frameSize) break;
        const payload = buffer.subarray(8, 8 + frameSize);
        buffer = buffer.subarray(8 + frameSize);
        feed(payload.toString("utf-8"));
      }
    }
    if (multiplexed === false && buffer.length > 0) {
      feed(buffer.toString("utf-8"));
      buffer = Buffer.alloc(0);
    }
  };

  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      drain();
    },
    flush() {
      drain();
      if (lineBuffer.length > 0) {
        onLine(lineBuffer);
        lineBuffer = "";
      }
    },
  };
}
