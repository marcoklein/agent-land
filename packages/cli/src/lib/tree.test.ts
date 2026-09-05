import { describe, it, expect } from "vitest";
import { buildSessionTree, renderSessionTree } from "./tree.js";

interface Sess {
  id: string;
  parentSessionId?: string;
  label: string;
}

function make(items: Array<[string, string | undefined, string]>): Sess[] {
  return items.map(([id, parentSessionId, label]) => ({ id, parentSessionId, label }));
}

const fmt = (s: Sess) => `${s.id} ${s.label}`;

describe("buildSessionTree", () => {
  it("groups children under parents and leaves orphans as roots", () => {
    const forest = buildSessionTree(
      make([
        ["a", undefined, "root"],
        ["b", "a", "child"],
        ["c", "b", "grandchild"],
        ["d", "missing-parent", "orphan"],
      ])
    );

    expect(forest.map((n) => n.value.id)).toEqual(["a", "d"]);
    expect(forest[0].children.map((n) => n.value.id)).toEqual(["b"]);
    expect(forest[0].children[0].children.map((n) => n.value.id)).toEqual(["c"]);
  });

  it("returns an empty forest for an empty list", () => {
    expect(buildSessionTree([])).toEqual([]);
  });
});

describe("renderSessionTree", () => {
  it("renders roots without a connector and children indented", () => {
    const forest = buildSessionTree(
      make([
        ["a", undefined, "root"],
        ["b", "a", "child"],
        ["c", "a", "child"],
        ["d", "b", "grandchild"],
      ])
    );

    expect(renderSessionTree(forest, fmt)).toEqual([
      "a root",
      "├─ b child",
      "│  └─ d grandchild",
      "└─ c child",
    ]);
  });

  it("renders multiple roots as a flat list", () => {
    const forest = buildSessionTree(make([["x", undefined, "one"], ["y", undefined, "two"]]));
    expect(renderSessionTree(forest, fmt)).toEqual(["x one", "y two"]);
  });
});
