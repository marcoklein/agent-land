export function renderLogEntry(event: Record<string, any>): string | null {
  switch (event.type) {
    case "agent_start":
      return `<div class="log-agent-start">Agent started</div>`;

    case "turn_start":
      return `<div class="log-turn">--- Turn ---</div>`;

    case "message_end": {
      const msg = event.message;
      if (msg?.role === "assistant") {
        const text = extractText(msg.content);
        if (!text) return null;
        return `<div class="log-assistant">${escapeHtml(text)}</div>`;
      }
      return null;
    }

    case "tool_execution_start":
      return `<div class="log-tool"><span class="log-tool-name">${escapeHtml(event.toolName)}</span> ${truncateArgs(event.args)}</div>`;

    case "tool_execution_end":
      if (event.isError) {
        return `<div class="log-tool log-tool-err">${escapeHtml(event.toolName)} failed: ${escapeHtml(truncate(String(event.result)))}</div>`;
      }
      return `<div class="log-tool log-tool-ok">${escapeHtml(event.toolName)} completed</div>`;

    default:
      return null;
  }
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

function truncateArgs(args: any): string {
  const str = typeof args === "string" ? args : JSON.stringify(args);
  return escapeHtml(str.length > 120 ? str.substring(0, 117) + "..." : str);
}

function truncate(s: string): string {
  return s.length > 200 ? s.substring(0, 197) + "..." : s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
