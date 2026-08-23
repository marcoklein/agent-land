import type { AgentEvent, Message, RenderLine } from "./types.js";

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(" ")) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current += " " + word;
      } else {
        lines.push(current);
        current = word;
      }
      while (current.length > width) {
        lines.push(current.slice(0, width));
        current = current.slice(width);
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

export function messageText(message: Message | null | undefined): string {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b === "object" && b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

function errorLines(message: Message | null | undefined, width: number): RenderLine[] {
  if (!message?.errorMessage) return [];
  return wrapText(`error: ${message.errorMessage}`, width).map((l) => ({ kind: "error", text: l }));
}

function shortArgs(args: unknown): string {
  if (!args) return "";
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  } catch {
    return "";
  }
}

export interface EventRenderer {
  render: (event: AgentEvent) => RenderLine[];
  state: { turnCount: number; streamingText: string; messageFinalized: boolean };
}

export function createEventRenderer({ width = 100 }: { width?: number } = {}): EventRenderer {
  const state = { turnCount: 0, streamingText: "", messageFinalized: false };

  function finalizeStreaming(): RenderLine[] {
    const text = state.streamingText;
    state.streamingText = "";
    if (!text) return [];
    return wrapText(text, width).map((l) => ({ kind: "text", text: l }));
  }

  function render(event: AgentEvent): RenderLine[] {
    switch (event.type) {
      case "turn_start":
        state.turnCount += 1;
        state.messageFinalized = false;
        return [{ kind: "turn", text: `── turn ${state.turnCount} ──` }];

      case "message_delta":
        state.streamingText += event.text ?? "";
        return [];

      case "message_end": {
        state.messageFinalized = true;
        const lines = finalizeStreaming();
        if (lines.length > 0) return lines;
        const text = messageText(event.message);
        if (text) return wrapText(text, width).map((l) => ({ kind: "text", text: l }));
        return errorLines(event.message, width);
      }

      case "turn_end": {
        const lines = finalizeStreaming();
        if (lines.length > 0) return lines;
        if (state.messageFinalized) {
          state.messageFinalized = false;
          return [];
        }
        const text = messageText(event.message);
        if (text) return wrapText(text, width).map((l) => ({ kind: "text", text: l }));
        return errorLines(event.message, width);
      }

      case "tool_start": {
        const args = shortArgs(event.args);
        return [{ kind: "meta", text: `▸ ${event.toolName}${args ? " " + args : ""}` }];
      }

      case "tool_end":
        return [
          {
            kind: event.isError ? "error" : "ok",
            text: `${event.isError ? "✗" : "✓"} ${event.toolName}`,
          },
        ];

      case "agent_settled":
        return [{ kind: "meta", text: "· settled" }];

      case "waiting_for_input": {
        const lines: RenderLine[] = [];
        const prompt = event.prompt ? ` ${event.prompt}` : "";
        if (event.method === "confirm") {
          lines.push({ kind: "dialog", text: `[agent asks] confirm:${prompt} [y/N]` });
        } else if (event.method === "select" && Array.isArray(event.options)) {
          lines.push({ kind: "dialog", text: `[agent asks] select:${prompt}` });
          event.options.forEach((o, i) =>
            lines.push({ kind: "dialog", text: ` ${i + 1}) ${o}` })
          );
        } else {
          lines.push({ kind: "dialog", text: `[agent asks] ${event.method}${prompt}` });
        }
        return lines;
      }

      case "input_received":
        return [{ kind: "meta", text: "· answered" }];

      case "status":
        if (event.status === "stopped") {
          return [{ kind: "meta", text: "· session stopped" }];
        }
        return [];

      default:
        return [];
    }
  }

  return { render, state };
}
