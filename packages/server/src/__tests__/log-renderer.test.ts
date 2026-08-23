import { describe, it, expect } from "vitest";
import { renderSessionEvent } from "../presentation/http/log-renderer.js";

describe("renderSessionEvent", () => {
  it("renders a model error when the message has no text", () => {
    const { html } = renderSessionEvent(
      {
        type: "message_end",
        message: { role: "assistant", content: [], errorMessage: "401 Model is disabled" },
      },
      0
    );
    expect(html).toContain("Model error:");
    expect(html).toContain("401 Model is disabled");
  });

  it("returns null for an empty assistant message without an error", () => {
    const { html } = renderSessionEvent(
      { type: "message_end", message: { role: "assistant", content: [] } },
      0
    );
    expect(html).toBeNull();
  });

  it("escapes HTML in the model error", () => {
    const { html } = renderSessionEvent(
      {
        type: "message_end",
        message: { role: "assistant", content: [], errorMessage: '<script>"x"</script>' },
      },
      0
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
  });
});
