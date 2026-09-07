import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAggregateBudget, validatePlan } from "./plan.mjs";

const budget = (timeoutSec = 100, maxTokens = 1000, maxCost = 1) => ({ timeoutSec, maxTokens, maxCost });
const retry = (maxAttempts = 1, on = ["failure"]) => ({ maxAttempts, on });

function stage(overrides) {
  return {
    id: "s1",
    kind: "refine",
    role: "refine stage",
    dependencies: [],
    parallelGroup: null,
    connectors: ["github"],
    mounts: [{ source: "agent-land", target: "/data/agent-land", seed: "clone" }],
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    budget: budget(),
    retry: retry(),
    leadsToGate: "outcome",
    ...overrides,
  };
}

function validPlan(overrides = {}) {
  const refine = stage({ id: "refine" });
  const design = stage({
    id: "design",
    kind: "design",
    dependencies: ["refine"],
    leadsToGate: "design",
  });
  const critic = stage({
    id: "critic",
    kind: "critic",
    dependencies: ["design"],
    connectors: ["github-ro"],
    mounts: [],
    leadsToGate: "design",
  });
  const agg = { timeoutSec: 2000, maxTokens: 10000, maxCost: 10 };
  return {
    planVersion: 1,
    runId: "a5060d50",
    issue: { repo: "marcoklein/agent-land", number: 57 },
    status: "proposed",
    stages: [refine, design, critic],
    edges: [["refine", "design"], ["design", "critic"]],
    parallelGroups: [],
    gates: ["plan", "outcome", "design"],
    aggregateBudget: agg,
    deviations: [],
    ...overrides,
  };
}

test("computeAggregateBudget: sequential stages add on every dimension", () => {
  const stages = [
    stage({ id: "a", budget: budget(100, 1000, 1), retry: retry(2) }),
    stage({ id: "b", budget: budget(200, 2000, 2), retry: retry(3) }),
  ];
  assert.deepEqual(computeAggregateBudget(stages, []), {
    timeoutSec: 100 * 2 + 200 * 3,
    maxTokens: 1000 * 2 + 2000 * 3,
    maxCost: 1 * 2 + 2 * 3,
  });
});

test("computeAggregateBudget: parallel group takes the wall-clock max, tokens/cost stay additive", () => {
  const stages = [
    stage({ id: "pre", budget: budget(100, 1000, 1), retry: retry(1) }),
    stage({ id: "p1", budget: budget(300, 1000, 1), retry: retry(2), parallelGroup: "g" }),
    stage({ id: "p2", budget: budget(500, 2000, 2), retry: retry(1), parallelGroup: "g" }),
    stage({ id: "post", budget: budget(100, 1000, 1), retry: retry(1) }),
  ];
  assert.deepEqual(computeAggregateBudget(stages, ["g"]), {
    // wall clock: pre + max(p1, p2) + post = 100 + max(600, 500) + 100
    timeoutSec: 100 + Math.max(300 * 2, 500 * 1) + 100,
    maxTokens: 1000 + 1000 * 2 + 2000 + 1000,
    maxCost: 1 + 1 * 2 + 2 + 1,
  });
});

test("validatePlan: the reference plan is valid", () => {
  const { ok, errors } = validatePlan(validPlan());
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
});

test("validatePlan: rejects an unknown stage kind", () => {
  const { ok, errors } = validatePlan(validPlan({ stages: [stage({ kind: "vibe-check" })] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("unknown kind")));
});

test("validatePlan: rejects duplicate stage ids", () => {
  const s = stage({ id: "dup" });
  const { ok, errors } = validatePlan(validPlan({ stages: [s, { ...s }] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("duplicate stage id")));
});

test("validatePlan: rejects a graph with a cycle", () => {
  const a = stage({ id: "a", dependencies: ["b"] });
  const b = stage({ id: "b", dependencies: ["a"] });
  const { ok, errors } = validatePlan(validPlan({ stages: [a, b], edges: [["a", "b"], ["b", "a"]] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("cycle")));
});

test("validatePlan: rejects edges referencing undeclared stages", () => {
  const { ok, errors } = validatePlan(validPlan({ edges: [["refine", "ghost"]] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("undeclared stage")));
});

test("validatePlan: rejects undeclared dependencies", () => {
  const { ok, errors } = validatePlan(validPlan({ stages: [stage({ dependencies: ["ghost"] })] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('dependency "ghost" is undeclared')));
});

test("validatePlan: rejects a leadsToGate missing from the gates array (gate bypass)", () => {
  const { ok, errors } = validatePlan(validPlan({ gates: ["plan", "outcome"] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('missing from gates array')));
});

test("validatePlan: rejects missing plan gate", () => {
  const { ok, errors } = validatePlan(validPlan({ gates: ["outcome", "design"] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('gates must include "plan"')));
});

test("validatePlan: rejects parallel stages with an internal edge", () => {
  const a = stage({ id: "a", parallelGroup: "g" });
  const b = stage({ id: "b", parallelGroup: "g", dependencies: ["a"] });
  const { ok, errors } = validatePlan(validPlan({ stages: [a, b], edges: [["a", "b"]] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("parallel stages must be independent")));
});

test("validatePlan: rejects two parallel children sharing a Mount", () => {
  const a = stage({ id: "a", parallelGroup: "g" });
  const b = stage({ id: "b", parallelGroup: "g" });
  const { ok, errors } = validatePlan(validPlan({ stages: [a, b] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('share Mount "agent-land"')));
});

test("validatePlan: rejects fan-out of a gate-producing stage", () => {
  const { ok, errors } = validatePlan(validPlan({ stages: [stage({ parallelGroup: "g" })] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("gate-producing stages stay sequential")));
});

test("validatePlan: rejects a critic with Mounts", () => {
  const { ok, errors } = validatePlan(
    validPlan({
      stages: [stage({ kind: "critic", connectors: ["github-ro"] })],
    })
  );
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("critic")));
});

test("validatePlan: rejects a mount-requiring kind without mounts", () => {
  const { ok, errors } = validatePlan(validPlan({ stages: [stage({ mounts: [] })] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("must bind at least one Mount")));
});

test("validatePlan: rejects maxAttempts below 1", () => {
  const { ok, errors } = validatePlan(validPlan({ stages: [stage({ retry: retry(0) })] }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("maxAttempts must be >= 1")));
});

test("validatePlan: rejects a plan whose graph exceeds the declared aggregate budget", () => {
  const { ok, errors } = validatePlan(validPlan({ aggregateBudget: budget(1, 1, 0.01) }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("aggregate")));
});

test("validatePlan: rejects an aggregate above the policy runBudget", () => {
  const plan = validPlan();
  const { ok, errors } = validatePlan(plan, { runBudget: budget(1, 1, 0.01) });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes("exceeds policy runBudget")));
});

test("validatePlan: runBudget at or above the aggregate passes", () => {
  const plan = validPlan();
  const { ok } = validatePlan(plan, { runBudget: budget(10000, 100000, 100) });
  assert.equal(ok, true);
});
