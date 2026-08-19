import { describe, it, expect } from "vitest";
import { parseDialogAnswer } from "./dialogs.js";

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
