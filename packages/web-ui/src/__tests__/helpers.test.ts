import { describe, it, expect } from "vitest";
import { escapeHtml, linkify, timeAgo, truncateText } from "../helpers.js";

describe("escapeHtml", () => {
  it("escapes HTML special chars", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("handles plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });
});

describe("linkify", () => {
  it("wraps URLs in anchor tags", () => {
    const result = linkify("Check https://github.com/org/repo/pull/123 for details");
    expect(result).toContain('<a href="https://github.com/org/repo/pull/123" target="_blank" rel="noopener">https://github.com/org/repo/pull/123</a>');
  });

  it("escapes HTML then linkifies", () => {
    const result = linkify('<img src=x onerror=alert(1)> https://evil.com');
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
    expect(result).toContain('<a href="https://evil.com"');
  });

  it("handles text with no URLs unchanged after escaping", () => {
    const result = linkify("just plain text <b>nope</b>");
    expect(result).toBe("just plain text &lt;b&gt;nope&lt;/b&gt;");
  });

  it("handles multiple URLs", () => {
    const result = linkify("a: https://a.com b: https://b.com");
    expect(result).toContain('<a href="https://a.com"');
    expect(result).toContain('<a href="https://b.com"');
  });
});

describe("timeAgo", () => {
  it("shows seconds for recent timestamps", () => {
    const now = new Date();
    now.setSeconds(now.getSeconds() - 30);
    expect(timeAgo(now.toISOString())).toMatch(/^\d+s ago$/);
  });

  it("shows minutes", () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - 5);
    const result = timeAgo(now.toISOString());
    expect(result).toMatch(/^\d+m ago$/);
  });

  it("shows hours", () => {
    const now = new Date();
    now.setHours(now.getHours() - 3);
    const result = timeAgo(now.toISOString());
    expect(result).toMatch(/^\d+h ago$/);
  });

  it("shows days for old timestamps", () => {
    const now = new Date();
    now.setDate(now.getDate() - 2);
    const result = timeAgo(now.toISOString());
    expect(result).toMatch(/^\d+d ago$/);
  });
});

describe("truncateText", () => {
  it("returns unchanged if within limit", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis", () => {
    expect(truncateText("hello world", 8)).toBe("hello...");
  });

  it("returns exact length when matching", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });
});