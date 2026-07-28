const SIZE_CAP = 10_000;

export function renderLogEntry(
  event: Record<string, any>,
  turnCount: number,
  entryIndex?: number,
  runId?: string
): { html: string | null; turnCount: number } {

  switch (event.type) {
    case "turn_start":
      turnCount++;
      return { html: `<div class="log-turn">--- Turn ${turnCount} ---</div>`, turnCount };

    case "agent_start":
      return { html: `<div class="log-agent-start">Agent started</div>`, turnCount };

    case "message_end": {
      const msg = event.message;
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

    case "tool_execution_start": {
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

    case "tool_execution_end": {
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
  <details id="log-entry-${entryIndex}">
    <summary>Show output (truncated)</summary>
    <pre class="log-pre">${escapeHtml(resultStr.substring(0, SIZE_CAP))}</pre>
    <div class="log-truncated">
      Truncated &mdash; ${formatSize(sizeBytes)} total
      <button style="margin-left:8px"
              hx-get="/agents/${runId}/log-entry/${entryIndex}"
              hx-target="#log-entry-${entryIndex}"
              hx-swap="outerHTML"
              class="outline small">Expand full</button>
    </div>
  </details>
</div>`,
        turnCount,
      };
    }

    case "agent_end":
      return { html: renderAgentEnd(event), turnCount };

    default:
      return { html: null, turnCount };
  }
}

export function renderLogEntryFull(event: Record<string, any>): string | null {
  switch (event.type) {
    case "tool_execution_end": {
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
      const result = renderLogEntry(event, 0);
      return result.html;
  }
}

function renderAgentEnd(event: Record<string, any>): string {
  const parts: string[] = [];
  const r = event.result ?? event;
  if (r?.exitCode !== undefined) parts.push(`exit ${r.exitCode}`);
  if (r?.totalTokens) parts.push(`${r.totalTokens} tokens`);
  if (r?.durationMs) parts.push(formatDuration(r.durationMs));
  const suffix = parts.length ? `: ${parts.join(" | ")}` : "";
  return `<div class="log-agent-end">Agent finished${suffix}</div>`;
}

function stringify(val: any): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
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

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
}
