#!/usr/bin/env node
// plan.mjs — validate an orchestrator plan artifact and compute aggregate budgets.
// Dependency-free so it runs inside the pi agent image with plain node.
// Contract: plan.schema.json next to this file. See
// docs/knowledge/product/designs/dynamic-orchestration-design.md.
//
// CLI:
//   node plan.mjs validate < plan.json              # exit 1 + errors on invalid
//   node plan.mjs validate --run-budget=JSON < plan.json
//   node plan.mjs budget < plan.json                # print aggregate budget JSON

const STAGE_KINDS = new Set(["research", "refine", "design", "critic", "implement"]);
const GATE_NAMES = new Set(["plan", "outcome", "design", "merge"]);
// Stage kinds that must carry at least one Mount and may never fan out
// (gate-producing stages stay sequential).
const MOUNT_KINDS = new Set(["research", "refine", "design", "implement"]);
const SEQUENTIAL_KINDS = new Set(["refine", "design"]);

export function computeAggregateBudget(stages, parallelGroups = []) {
  const groups = new Set(parallelGroups.filter((g) => g != null));

  // Wall-clock: sequential stages add; each parallel group contributes the max
  // over its members (the critical path). Tokens and cost: always additive.
  const sequentialStages = stages.filter(
    (s) => s.parallelGroup == null || !groups.has(s.parallelGroup)
  );
  const groupStages = new Map();
  for (const s of stages) {
    if (s.parallelGroup != null && groups.has(s.parallelGroup)) {
      if (!groupStages.has(s.parallelGroup)) groupStages.set(s.parallelGroup, []);
      groupStages.get(s.parallelGroup).push(s);
    }
  }

  const timeoutSec =
    byKindTime(sequentialStages) +
    [...groupStages.values()].reduce(
      (acc, members) => acc + Math.max(...members.map(byStageTime)),
      0
    );

  return {
    timeoutSec,
    maxTokens: stages.reduce((sum, s) => sum + s.budget.maxTokens * s.retry.maxAttempts, 0),
    maxCost: stages.reduce((sum, s) => sum + s.budget.maxCost * s.retry.maxAttempts, 0),
  };
}

function byStageTime(s) {
  return s.budget.timeoutSec * s.retry.maxAttempts;
}
function byKindTime(stages) {
  return stages.reduce((sum, s) => sum + byStageTime(s), 0);
}

export function validatePlan(plan, opts = {}) {
  const errors = [];
  const err = (m) => errors.push(m);

  if (plan == null || typeof plan !== "object") {
    return { ok: false, errors: ["plan is not an object"] };
  }

  if (plan.planVersion !== 1) err(`planVersion must be 1, got ${JSON.stringify(plan.planVersion)}`);
  if (typeof plan.runId !== "string" || !/^[a-z0-9]{6,16}$/.test(plan.runId ?? ""))
    err("runId must match ^[a-z0-9]{6,16}$");
  if (!isIssue(plan.issue)) err("issue must be { repo: string, number: int >= 1 }");
  if (!["proposed", "approved"].includes(plan.status)) err("status must be proposed|approved");

  if (!Array.isArray(plan.stages) || plan.stages.length === 0) {
    err("stages must be a non-empty array");
    return { ok: false, errors };
  }
  if (!Array.isArray(plan.edges)) err("edges must be an array of [from, to] pairs");
  if (!Array.isArray(plan.gates) || plan.gates.length === 0) err("gates must be a non-empty array");

  const ids = new Set();
  const byId = new Map();
  for (const s of plan.stages) {
    if (!isStage(s)) {
      err(`stage ${JSON.stringify(s?.id ?? s)} is malformed`);
      continue;
    }
    if (ids.has(s.id)) err(`duplicate stage id "${s.id}"`);
    ids.add(s.id);
    byId.set(s.id, s);

    if (!STAGE_KINDS.has(s.kind)) err(`stage "${s.id}": unknown kind "${s.kind}"`);
    if (s.retry.maxAttempts < 1) err(`stage "${s.id}": maxAttempts must be >= 1`);
    if (s.leadsToGate != null && !GATE_NAMES.has(s.leadsToGate))
      err(`stage "${s.id}": unknown gate "${s.leadsToGate}"`);
    if (s.leadsToGate != null && !plan.gates.includes(s.leadsToGate))
      err(`stage "${s.id}": leadsToGate "${s.leadsToGate}" missing from gates array`);
    if (MOUNT_KINDS.has(s.kind) && s.mounts.length === 0)
      err(`stage "${s.id}" (${s.kind}): must bind at least one Mount`);
    if (s.kind === "critic" && s.mounts.length > 0)
      err(`stage "${s.id}" (critic): must have no Mounts (read-only by construction)`);
    if (SEQUENTIAL_KINDS.has(s.kind) && s.parallelGroup != null)
      err(`stage "${s.id}" (${s.kind}): gate-producing stages stay sequential (parallelGroup must be null)`);
  }

  // Gate invariant: Gate 0 precedes everything and the declared gates are sane.
  if (Array.isArray(plan.gates)) {
    if (!plan.gates.includes("plan")) err('gates must include "plan" (Gate 0)');
    for (const g of plan.gates) if (!GATE_NAMES.has(g)) err(`unknown gate "${g}" in gates`);
    if (new Set(plan.gates).size !== plan.gates.length) err("gates must not contain duplicates");
  }

  // Edge integrity: every edge endpoint is a declared stage; no cycles.
  const indegree = new Map([...ids].map((id) => [id, 0]));
  for (const e of plan.edges ?? []) {
    if (!Array.isArray(e) || e.length !== 2) {
      err(`edge ${JSON.stringify(e)} must be [from, to]`);
      continue;
    }
    const [from, to] = e;
    if (!ids.has(from)) err(`edge from "${from}" references an undeclared stage`);
    if (!ids.has(to)) err(`edge to "${to}" references an undeclared stage`);
    else indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const topo = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of topo) {
    const outs = (plan.edges ?? []).filter(([f]) => f === id).map(([, t]) => t);
    for (const t of outs) {
      indegree.set(t, indegree.get(t) - 1);
      if (indegree.get(t) === 0) topo.push(t);
    }
  }
  if (topo.length !== ids.size) err("stage graph has a cycle");

  // Dependencies must reference declared stages (duplicate edges are tolerated).
  for (const s of plan.stages ?? []) {
    if (!byId.has(s.id)) continue; // malformed stage already reported
    for (const d of s.dependencies ?? []) if (!ids.has(d)) err(`stage "${s.id}": dependency "${d}" is undeclared`);
  }

  // Parallel groups: no internal edges, no shared Mounts.
  const groupMembers = new Map();
  for (const s of plan.stages ?? []) {
    if (s.parallelGroup == null || !isStage(s)) continue;
    if (!groupMembers.has(s.parallelGroup)) groupMembers.set(s.parallelGroup, []);
    groupMembers.get(s.parallelGroup).push(s);
  }
  for (const [g, members] of groupMembers) {
    if (members.length < 2) continue;
    const memberIds = new Set(members.map((m) => m.id));
    for (const [f, t] of plan.edges ?? []) {
      if (memberIds.has(f) && memberIds.has(t))
        err(`parallel group "${g}": internal edge "${f}" -> "${t}" (parallel stages must be independent)`);
    }
    const sources = new Set();
    for (const m of members) {
      for (const mount of m.mounts) {
        if (sources.has(mount.source))
          err(`parallel group "${g}": two children share Mount "${mount.source}" (one Mount per child)`);
        sources.add(mount.source);
      }
    }
  }

  // Budget invariant: the graph's aggregate must fit the declared aggregate.
  if (isBudget(plan.aggregateBudget)) {
    const validStages = (plan.stages ?? []).filter(isStage);
    const agg = computeAggregateBudget(validStages, plan.parallelGroups ?? []);
    for (const dim of ["timeoutSec", "maxTokens", "maxCost"]) {
      if (agg[dim] > plan.aggregateBudget[dim])
        err(`aggregate ${dim}: graph needs ${agg[dim]}, plan declares ${plan.aggregateBudget[dim]}`);
    }
    if (isBudget(opts.runBudget)) {
      for (const dim of ["timeoutSec", "maxTokens", "maxCost"]) {
        if (plan.aggregateBudget[dim] > opts.runBudget[dim])
          err(`aggregate ${dim} ${plan.aggregateBudget[dim]} exceeds policy runBudget ${opts.runBudget[dim]}`);
      }
    }
  } else {
    err("aggregateBudget must be { timeoutSec, maxTokens, maxCost }");
  }

  return { ok: errors.length === 0, errors };
}

function isIssue(v) {
  return (
    v != null &&
    typeof v.repo === "string" &&
    v.repo.length > 0 &&
    Number.isInteger(v.number) &&
    v.number >= 1
  );
}
function isBudget(v) {
  return (
    v != null &&
    typeof v.timeoutSec === "number" &&
    v.timeoutSec >= 1 &&
    typeof v.maxTokens === "number" &&
    v.maxTokens >= 1 &&
    typeof v.maxCost === "number" &&
    v.maxCost >= 0.01
  );
}
function isStage(v) {
  return (
    v != null &&
    typeof v.id === "string" &&
    typeof v.kind === "string" &&
    typeof v.role === "string" &&
    Array.isArray(v.dependencies) &&
    v.dependencies.every((d) => typeof d === "string") &&
    (v.parallelGroup == null || typeof v.parallelGroup === "string") &&
    Array.isArray(v.connectors) &&
    v.connectors.length >= 1 &&
    v.connectors.every((c) => typeof c === "string" && c.length > 0) &&
    Array.isArray(v.mounts) &&
    v.mounts.every(
      (m) =>
        m != null &&
        typeof m.source === "string" &&
        m.source.length > 0 &&
        typeof m.target === "string" &&
        m.target.length > 0
    ) &&
    typeof v.provider === "string" &&
    typeof v.model === "string" &&
    isBudget(v.budget) &&
    v.retry != null &&
    Number.isInteger(v.retry.maxAttempts) &&
    Array.isArray(v.retry.on) &&
    (v.leadsToGate == null || typeof v.leadsToGate === "string")
  );
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/plan.mjs") || process.argv[1].endsWith("\\plan.mjs") || process.argv[1] === "plan.mjs");

if (isMain) {
  const cmd = process.argv[2];
  const runBudgetArg = process.argv.find((a) => a.startsWith("--run-budget="));
  const runBudget = runBudgetArg ? JSON.parse(runBudgetArg.slice("--run-budget=".length)) : undefined;

  readStdin().then((stdin) => {
    let plan;
    try {
      plan = JSON.parse(stdin);
    } catch {
      console.error("plan.mjs: stdin is not valid JSON");
      process.exit(1);
    }

    if (cmd === "validate") {
      const { ok, errors } = validatePlan(plan, { runBudget });
      if (!ok) {
        for (const e of errors) console.error(`- ${e}`);
        process.exit(1);
      }
      console.log("plan valid");
      process.exit(0);
    }

    if (cmd === "budget") {
      console.log(JSON.stringify(computeAggregateBudget(plan.stages, plan.parallelGroups)));
      process.exit(0);
    }

    console.error("usage: node plan.mjs [validate|budget] [--run-budget=JSON] < plan.json");
    process.exit(2);
  });
}
