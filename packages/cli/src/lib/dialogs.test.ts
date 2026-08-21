import { describe, it, expect } from "vitest";
import { parseDialogAnswer, parseSelectAnswer } from "./dialogs.js";

describe("parseDialogAnswer", () => {
  it("maps confirm to a boolean", () => {
    expect(parseDialogAnswer("confirm", undefined, "yes")).toEqual({ confirmed: true });
    expect(parseDialogAnswer("confirm", undefined, "n")).toEqual({ confirmed: false });
  });

  it("maps a select index to the option, falling back to raw input", () => {
    expect(parseDialogAnswer("select", ["a", "b"], "2")).toEqual({ value: "b" });
    expect(parseDialogAnswer("select", ["a", "b"], "b")).toEqual({ value: "b" });
    expect(parseDialogAnswer("select", ["a", "b"], "99")).toEqual({ value: "99" });
  });

  it("maps input/editor to a raw value", () => {
    expect(parseDialogAnswer("input", undefined, "hello")).toEqual({ value: "hello" });
    expect(parseDialogAnswer("editor", undefined, "code")).toEqual({ value: "code" });
  });
});

describe("parseSelectAnswer", () => {
  it("maps a single 1-based index to a 0-based index", () => {
    expect(parseSelectAnswer("2", 3)).toEqual([1]);
    expect(parseSelectAnswer("1", 3)).toEqual([0]);
  });

  it("rejects out-of-range and non-numeric input", () => {
    expect(parseSelectAnswer("0", 3)).toBeNull();
    expect(parseSelectAnswer("4", 3)).toBeNull();
    expect(parseSelectAnswer("abc", 3)).toBeNull();
    expect(parseSelectAnswer("", 3)).toBeNull();
  });

  it("requires exactly one token for single selection", () => {
    expect(parseSelectAnswer("1,2", 3)).toBeNull();
  });

  it("maps multiple comma-separated indices and de-dupes", () => {
    expect(parseSelectAnswer("1,3", 3, { multiple: true })).toEqual([0, 2]);
    expect(parseSelectAnswer("2,2", 3, { multiple: true })).toEqual([1]);
  });

  it("treats empty, 0 and none as no selection for multiple", () => {
    expect(parseSelectAnswer("", 3, { multiple: true })).toEqual([]);
    expect(parseSelectAnswer("0", 3, { multiple: true })).toEqual([]);
    expect(parseSelectAnswer("none", 3, { multiple: true })).toEqual([]);
  });

  it("rejects invalid tokens in a multiple selection", () => {
    expect(parseSelectAnswer("1,99", 3, { multiple: true })).toBeNull();
  });
});
