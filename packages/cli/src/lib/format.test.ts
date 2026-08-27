import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatAge } from "./format.js";

describe("formatAge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds", () => {
    expect(formatAge("2025-01-01T00:00:00.000Z")).toBe("0s");
    expect(formatAge("2024-12-31T23:59:30.000Z")).toBe("30s");
    expect(formatAge("2024-12-31T23:59:01.000Z")).toBe("59s");
  });

  it("formats minutes", () => {
    expect(formatAge("2024-12-31T23:59:00.000Z")).toBe("1m");
    expect(formatAge("2024-12-31T23:00:01.000Z")).toBe("59m");
  });

  it("formats hours", () => {
    expect(formatAge("2024-12-31T23:00:00.000Z")).toBe("1h0m");
    expect(formatAge("2024-12-31T13:30:00.000Z")).toBe("10h30m");
    expect(formatAge("2024-12-31T00:01:00.000Z")).toBe("23h59m");
  });

  it("formats days", () => {
    expect(formatAge("2024-12-31T00:00:00.000Z")).toBe("1d0h");
    expect(formatAge("2024-12-30T00:00:00.000Z")).toBe("2d0h");
    expect(formatAge("2024-12-29T12:00:00.000Z")).toBe("2d12h");
  });

  it("clamps future timestamps to zero seconds", () => {
    expect(formatAge("2025-01-01T00:00:05.000Z")).toBe("0s");
  });
});
