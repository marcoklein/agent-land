import type { SessionEvent } from "../../core/events.js";

const SIZE_CAP = 10_000;

export interface RenderOpts {
  entryIndex?: number;
  sessionId?: string;
}

export function renderSessionEvent(
  event: SessionEvent,
  turnCount: number,
  opts?: RenderOpts
): { html: string | null; turnCount: number } {
  switch (event.type) {
    case "turn_start":
      turnCount++;
      return { html: `<div class="log-turn">--- Turn ${turnCount} ---</div>`, turnCount };

    case "status":
      if (event.status === "running") {
        return { html: `<div class="log-agent-start">Agent running</div>`, turnCount };
      }
      if (event.status === "stopped") {
        return { html: `<div class="log-agent-end">Agent stopped</div>`, turnCount };
      }
      return { html: null, turnCount };

    case "agent_settled":
      return { html: `<div class="log-agent-end">Agent settled</div>`, turnCount };

    case "waiting_for_input":
      return {
        html: `<div class="log-tool log-tool-err">Waiting for input (${escapeHtml(event.method)}): ${escapeHtml(event.prompt ?? "")}</div>`,
        turnCount,
      };

    case "message_end": {
      const msg = event.message as any;
      if (!msg) return { html: null, turnCount };
      const text = extractText(msg.content);
      if (!text) return { html: null, turnCount };
      if (msg.role === "assistant") {
        return { html: `<div class="log-assistant">${escapeHtml(text)}</div>`, turnCount };
      }
      if (msg.role === "user") {
        return {
          html: `<div class="log-user"><details><summary>User prompt</summary><pre class="log-pre">${escapeHtml(text)}</pre></details></div>`,
          turnCount,
        };
      }
      return { html: null, turnCount };
    }

    case "tool_start": {
      const argsStr = stringify(event.args);
      const name = escapeHtml(event.toolName);
      if (argsStr.length <= 120) {
        return {
          html: `<div class="log-tool"><span class="log-tool-name">${name}</span> ${escapeHtml(argsStr)}</div>`,
          turnCount,
        };
      }
      return {
        html: `<div class="log-tool">
  <details>
    <summary><span class="log-tool-name">${name}</span> ${escapeHtml(argsStr.substring(0, 117))}...</summary>
    <pre class="log-pre">${escapeHtml(argsStr)}</pre>
  </details>
</div>`,
        turnCount,
      };
    }

    case "tool_end": {
      const resultStr = stringify(event.result);
      const sizeBytes = new TextEncoder().encode(resultStr).length;
      const name = escapeHtml(event.toolName);

      if (event.isError) {
        return {
          html: `<div class="log-tool log-tool-err"><span class="log-tool-name">${name}</span> failed: ${escapeHtml(truncate(resultStr, 200))}</div>`,
          turnCount,
        };
      }

      if (sizeBytes <= SIZE_CAP) {
        return {
          html: `<div class="log-tool log-tool-ok">
  <details>
    <summary><span class="log-tool-name">${name}</span> completed (${formatSize(sizeBytes)})</summary>
    <pre class="log-pre">${escapeHtml(resultStr)}</pre>
  </details>
</div>`,
          turnCount,
        };
      }

      return {
        html: `<div class="log-tool log-tool-ok">
  <div><span class="log-tool-name">${name}</span> completed (${formatSize(sizeBytes)})</div>
  <details id="log-entry-${opts?.entryIndex}">
    <summary>Show output (truncated)</summary>
    <pre class="log-pre">${escapeHtml(resultStr.substring(0, SIZE_CAP))}</pre>
    <div class="log-truncated">
      Truncated &mdash; ${formatSize(sizeBytes)} total
      <button style="margin-left:8px"
              hx-get="/agents/${opts?.sessionId}/event/${opts?.entryIndex}"
              hx-target="#log-entry-${opts?.entryIndex}"
              hx-swap="outerHTML"
              class="outline small">Expand full</button>
    </div>
  </details>
</div>`,
        turnCount,
      };
    }

    case "input_received":
    case "message_delta":
    case "tool_update":
    case "turn_end":
    default:
      return { html: null, turnCount };
  }
}

export function renderSessionEventFull(event: SessionEvent): string | null {
  switch (event.type) {
    case "tool_end": {
      const resultStr = stringify(event.result);
      const name = escapeHtml(event.toolName);
      const sizeBytes = new TextEncoder().encode(resultStr).length;
      return `<div class="log-tool log-tool-ok">
  <details open>
    <summary><span class="log-tool-name">${name}</span> completed (${formatSize(sizeBytes)}) &mdash; full</summary>
    <pre class="log-pre">${escapeHtml(resultStr)}</pre>
  </details>
</div>`;
    }
    default:
      const result = renderSessionEvent(event, 0);
      return result.html;
  }
}

function stringify(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b?.text ?? "")
      .join("");
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.substring(0, len - 3) + "..." : s;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
