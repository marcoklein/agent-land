import { encodeMessage, decodeMessage } from "./protocol.mjs";

/** Client for the runner channel: SSE downstream (control → runner) + JSON POST upstream. */
export class RunnerClient {
  constructor(baseUrl, auth, sessionId) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = auth;
    this.sessionId = sessionId;
    this.messageHandlers = [];
    this.closeHandlers = [];
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Basic ${Buffer.from(this.auth).toString("base64")}`,
    };
  }

  async post(message) {
    const res = await fetch(`${this.baseUrl}/engine/runner/${this.sessionId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: encodeMessage(message),
    });
    if (!res.ok) throw new Error(`POST failed: ${res.status}`);
    return res.json();
  }

  async connect() {
    const res = await fetch(`${this.baseUrl}/engine/runner/${this.sessionId}/stream`, {
      headers: this.headers(),
    });
    if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
    this.readLoop(res.body);
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  onClose(handler) {
    this.closeHandlers.push(handler);
  }

  async readLoop(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleFrame(frame);
        }
      }
    } catch {
      // connection dropped — signal close below
    }
    for (const handler of this.closeHandlers) handler();
  }

  handleFrame(frame) {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const message = decodeMessage(line.slice("data: ".length));
        for (const handler of this.messageHandlers) handler(message);
      } catch {
        // malformed frame — ignore
      }
    }
  }
}
