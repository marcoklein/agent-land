---
type: Design
title: Dynamic Orchestration
description: The orchestrator recipe becomes a planner — it emits an inspectable per-task plan (a new pre-execution gate), then realizes that plan as child sessions over the loopback, with per-stage models, budgets, retries, and one-Mount-per-parallel-child worktrees. No engine change.
status: draft
generated: { by: pi/deepseek-v4-pro, at: 2026-09-05T20:30:00Z }
sources:
  - id: feature
    resource: /product/features/dynamic-orchestration.md
    title: Dynamic Orchestration Feature note
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: mount-design
    resource: /product/designs/mount-design.md
    title: Mount design — single-writer invariant
  - id: kill-switch
    resource: /adrs/011-kill-switch.md
    title: Per-Run Kill-Switch with Incremental Token and Cost Tracking
  - id: providers-adr
    resource: /adrs/015-providers-as-config-records-projected-into-pi.md
    title: Providers are config records projected into pi
  - id: product-adr
    resource: /adrs/017-product-layer-okf-memory.md
    title: Build a Product Layer on OKF Memory with an Agentic Pipeline
  - id: orchestrator-skill
    resource: agent-image/skills/orchestrator/SKILL.md
    title: The static orchestrator recipe (Phase 2)
  - id: session-contract
    resource: packages/contracts/src/session.ts
    title: Session contracts (zod) — child-create fields
  - id: routes
    resource: packages/contracts/src/routes.ts
    title: Canonical API surface
  - id: pipeline
    resource: /product/pipeline.md
    title: The product pipeline — the three human gates
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding strategy — trust ladder, success signals
  - id: roadmap
    resource: /multi-agent-workflow.md
    title: Multi-agent workflow — Phase 4
---

# Dynamic Orchestration

Phase 4 of the [multi-agent roadmap](/multi-agent-workflow.md): the orchestrator stops running the fixed `research → refine → design → critic` script and becomes a **planner**. The recipe shifts from a scripted sequence to **prompt-level policy** — a declaration of roles, tools, gates, budgets, and models — and the orchestrator realizes that policy as child sessions over the loopback [Platform Connector](/engine.md#loopback). This is a **composition change, not an engine change**[^boundary][^engine].

## Approach

The change is a rewrite of one file — the orchestrator recipe — plus two small artifacts it consumes, and one additive field on the Session primitive to complete an already-accepted ADR. The engine gains no workflow executor, no DAG vocabulary, and no vendor catalog; everything new is a recipe concern, exactly where the domain boundary says control flow belongs[^boundary][^product-adr].

The orchestrator's job splits into three phases:

1. **Plan.** On intake, the orchestrator reads the issue and the policy, then composes a per-task **stage graph**: which stages run, in what order (with parallel groups), with which role, connectors, mounts, provider, model, and kill-switch budget. It validates the graph against a fixed **plan schema** and the gate invariant, then posts it to the issue as a **plan artifact** and parks. This is a **new pre-execution gate (Gate 0)** — the human vetoes or amends the plan before any child is spawned.
2. **Execute.** After Gate 0 clears, the orchestrator realizes each stage as a child session over the loopback, passing `model`/`provider`/`connectors`/`mounts` and the stage's kill-switch budget at child-create time. It watches each child, collects its result, retries per policy, and accounts every child's actual spend against an **aggregate run budget** the orchestrator alone holds.
3. **Gate.** The three human gates stay exactly where they are — outcome, design, merge — as `waiting_for_input` parks[^pipeline]. The planner may reorder or reshape stages, but may never remove, merge, or bypass a gate; the plan validator rejects any graph that does.

The orchestrator itself binds **no** Mount (the static recipe's hard-won layout, unchanged)[^orchestrator-skill]. For sequential stages it binds the shared repo Mount one child at a time; for parallel stages it creates **one Mount per child** (§Answers, Q2).

## Interfaces

### 1. Plan artifact contract (the per-task stage graph)

A `plan.json` with a fixed schema. The orchestrator emits it, validates it, posts it to the issue in a fenced JSON code block, and parks at Gate 0.

```json
{
  "planVersion": 1,
  "runId": "a5060d50",
  "issue": { "repo": "marcoklein/agent-land", "number": 57 },
  "status": "proposed",
  "stages": [
    {
      "id": "refine",
      "kind": "refine",
      "role": "refine stage — feature note + spec PR",
      "dependencies": [],
      "parallelGroup": null,
      "connectors": ["github"],
      "mounts": [{ "source": "agent-land", "target": "/data/agent-land", "seed": "clone" }],
      "provider": "opencode-go",
      "model": "deepseek-v4-pro",
      "killSwitch": { "timeoutSec": 1200, "maxTokens": 100000, "maxCost": 1.00 },
      "retry": { "maxAttempts": 2, "on": ["failure"] },
      "leadsToGate": "outcome"
    }
  ],
  "edges": [["research", "refine"], ["refine", "design"]],
  "parallelGroups": [],
  "gates": ["plan", "outcome", "design", "merge"],
  "aggregateBudget": { "timeoutSec": 14400, "maxTokens": 800000, "maxCost": 15.00 },
  "deviations": [
    { "default": "research", "actual": "skip", "reason": "issue body already specifies the outcome; policy allows skip-research for well-specified issues" }
  ]
}
```

- **Home.** The canonical copy is the **issue comment** (durable, human-inspectable, survives redeploys). The orchestrator also writes it to its own session working directory as a re-load cache. On resume after a redeploy, the orchestrator re-fetches the issue comment if the local file is missing.
- **Inspectable before execution.** The plan is posted and Gate 0 parks **before the first child is spawned**. The human sees the exact stages, order, models, budgets, and gate points, and replies `approved` or `feedback: …`.
- **Gate.** Yes — the plan is a new, additive gate. It does not replace the three existing gates; it precedes them.

### 2. Policy schema (prompt-level, in the agent image)

The recipe becomes a declaration. It lives at `agent-image/skills/orchestrator/policy.yaml`, not in the server. A compact form:

```yaml
version: 1
defaults:
  provider: opencode-go
  model: deepseek-v4-pro
  killSwitch: { timeoutSec: 1800, maxTokens: 100000, maxCost: 1.00 }
runBudget: { timeoutSec: 14400, maxTokens: 800000, maxCost: 15.00 }   # aggregate, orchestrator-held
stages:
  research:
    role: "research stage of the product pipeline"
    connectors: [github]
    provider: opencode-go
    model: deepseek-v4-pro            # cheap
    killSwitch: { timeoutSec: 900, maxTokens: 60000, maxCost: 0.60 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: null
  refine:
    role: "refine stage — feature note + spec PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    killSwitch: { timeoutSec: 1200, maxTokens: 100000, maxCost: 1.00 }
    retry: { maxAttempts: 2, on: [failure] }
    leadsToGate: outcome
  design:
    role: "design stage — design note + design PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    killSwitch: { timeoutSec: 1800, maxTokens: 150000, maxCost: 1.50 }   # strong
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: design
  critic:
    role: "adversarial reviewer — advises only, never merges"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    killSwitch: { timeoutSec: 600, maxTokens: 40000, maxCost: 0.40 }     # small
    retry: { maxAttempts: 1, on: [failure] }
    leadsToGate: design
  implement:
    role: "implementation child — dev loop to a green PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    killSwitch: { timeoutSec: 1800, maxTokens: 200000, maxCost: 2.00 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: merge
gates:
  plan:    { order: 0, mechanism: "issue comment + waiting_for_input" }
  outcome: { order: 1, mechanism: "spec PR review" }
  design:  { order: 2, mechanism: "design PR review" }
  merge:   { order: 3, mechanism: "human PR merge" }
invariants:
  - "gates may never be removed, merged, or bypassed"
  - "parallel children get one Mount each; never a shared live .git"
  - "connectors and mounts resolve by exact name"
```

The `tools` column is declared per stage for **prompt construction and connector scoping only** — the platform has no tool vocabulary to enforce (ADR 016), and that boundary is respected: the only real per-child scoping the platform offers is connector selection[^boundary]. "Tools" in policy means "what the stage prompt tells the child it may use", not a server-enforced capability.

### 3. API / CLI surface

No new endpoints, no new engine concepts. The surfaces already exist or complete an accepted ADR:

- **Child create already accepts `model` and `provider`** (`createSessionInputSchema`)[^session-contract] — per-stage model choice is a child-create field, not a server feature (ADR 015)[^providers-adr].
- **Child create already accepts `mounts`** — one-Mount-per-child parallelism is pure composition (mount-design)[^mount-design]. New parallel mounts are created with the existing `POST /api/mounts`[^routes].
- **Kill-switch budgets.** ADR 011 specifies a per-run `KillSwitch` (`timeoutSec`/`maxTokens`/`maxCost`) at launch[^kill-switch], but the current `createSessionInputSchema` does **not yet surface it** (verified in this checkout). The one server-side touch of this design is an **additive** `killSwitch` field on `POST /api/sessions`, threaded to the already-decided enforcement point — completing ADR 011, not adding a primitive.
- **Model preflight.** The orchestrator resolves models against `GET /api/providers` and `GET /api/models` once per run (already in the canonical API)[^routes].
- **CLI.** No `al` changes are required: children are spawned over the JSON/SSE API, and `al ls --tree` already renders lineage for live children.

## Answers to the Feature note's open questions

1. **Plan contract / home — decided.** A `plan.json` artifact (schema above) is the plan's home. It is **posted to the issue as a new pre-execution gate (Gate 0) before any child is spawned**. The orchestrator validates the plan against the schema and the gate invariant, posts the JSON fenced in a comment, and parks for `approved` / `feedback:`. Local files are a re-load cache; the issue comment is canonical.

2. **Parallelism vs. the single-writer invariant — decided: one Mount per parallel child; the invariant is unchanged.** The Mount single-writer invariant stands exactly as written — no ADR/design-note amendment[^mount-design]. Each parallel child gets its own Mount, so no two live sessions ever bind the same Mount. **Seeding strategy: an independent `git clone` per child** (the child's step 0 clones the repo into its own Mount). `git worktree add` from a shared seed is rejected because it shares one live `.git` across worktrees — precisely the shared-live-writer the invariant forbids; `clone --reference` is rejected because it couples children to a mutable reference repo. **Reconciliation: each child works on its own branch and pushes it; reconciliation is via PRs to `main` — never a shared live `.git`.** Parallel children are given non-overlapping concerns by construction; if two PRs still conflict, the conflict is resolved in PR review by a follow-up child or the human, not by concurrent git writers.

3. **Retry policy — decided.** Three classes:
   - **Failure** — a child settles but its output is missing, invalid, or explicitly reports failure (e.g. spec PR not opened, typecheck red). → **Retry with an adjusted prompt**: a fresh child on the same stage, with the previous attempt's final report and the specific failure reason appended, and an instruction "attempt 1 failed because X; fix X specifically".
   - **Stall** — a child exceeds its kill-switch timeout, or hangs without settling past its budget. → **Re-prompt with numbered steps**: the retry prompt is broken into explicit numbered steps with a smaller scope; the previous child is deleted first to free its Mount.
   - **Escalate-to-human** — a stage exhausts its attempt budget, or a gate would be reached with quality still failing, or the aggregate budget cannot cover another attempt. → The orchestrator posts the collected stage outputs to the issue and parks at the relevant gate asking the human to re-instruct or abort. Escalation is always a park, never an autonomous abandon.
   - **Max attempts: 2 total runs per stage by default** (1 initial + 1 retry); `critic` and other cheap advisory stages get 1. The loop is bounded by `per-stage killSwitch × maxAttempts` **and** the aggregate run budget — whichever is exhausted first stops the loop and escalates.

4. **Budgets — decided.** Per-stage kill-switch budgets are assigned in the policy by stage difficulty: research cheap (900s / 60k tokens / $0.60), design strong (1800s / 150k / $1.50), adversarial reviewer small (600s / 40k / $0.40), implement strong (1800s / 200k / $2.00), with the ADR 011 default (1h / 100k / $1) as the baseline for anything unlisted[^kill-switch]. The **orchestrator computes an aggregate run budget** as `Σ (stage worst-case budget × maxAttempts)`, capped by a policy `runBudget` ceiling (e.g. 4h / 800k tokens / $15). The orchestrator **alone holds the aggregate**; each child carries only its own per-stage kill switch. **Enforcement across children is orchestrator-side accounting**: before each spawn, the orchestrator checks `spent + worst-case-of-this-stage ≤ remaining` and refuses to spawn (falls back to a cheaper model, or escalates) if not; after each child it parses the child's streamed `message_end` usage (already in the event log) and adds actuals to `spent`. Per-child overruns are hard-stopped by the server (ADR 011); the aggregate prevents the *sum* from running away. Until the additive `killSwitch` field lands on session create, the orchestrator enforces the same budgets softly by watching usage events and `DELETE`ing an over-budget child itself.

5. **Model policy — decided.** The per-stage model policy lives in `policy.yaml` in the agent image (the recipe's policy schema above), not in the server. Models are chosen **by name at child-create time**: the orchestrator passes the policy's `provider` and `model` strings on `POST /api/sessions` (ADR 015 projection, already supported)[^providers-adr][^session-contract]. Capability is expressed in policy comments, not queried at runtime — the platform has no in-core capability catalog (ADR 016), and the policy author (a human) picks names. **Fallback when a chosen model/provider is absent:** the orchestrator preflights `GET /api/providers` + `GET /api/models` once per run; if a policy-named provider/model is missing it applies a documented ladder — (1) that provider's `defaultModel`, (2) the platform `DEFAULT_PROVIDER_ID` + server `defaultModel` — and **posts a one-line note to the issue** recording the substitution so the human sees the deviation. If even the default is unavailable, it escalates (parks) rather than spawning blind.

6. **"Visibly differs" and "matching quality" — decided.** *Visibly differs*: the executed graph deviates from the static default in at least one of skip-research, deepen-research, parallel fan-out, added adversarial reviewer, or per-stage model change — evidenced by the plan artifact plus the execution trace comment (§Q7). *Matching quality*: the three human gates still clear with the same artifacts (feature note, design note, green PR) **and** the number of human `feedback:` corrections needed to clear each gate is **≤ the static baseline's** (≤ 1 feedback round per gate); additionally the dogfooding success signals hold — task→green-PR wall-clock not worse than the static baseline, PR still opened by an agent-land session[^dogfooding].

7. **Observability of a dynamic graph — decided.** Children are still `DELETE`d after settling to free their Mounts, so `al ls --tree` shows only the in-flight graph — which is correct and sufficient **while the run is live**. The **durable executed graph** is a `trace.json` the orchestrator maintains (one record per child: `{stage, childId, provider, model, budgetUsed, result, deletedAt}`) and posts to the issue as a final **execution-trace comment** (mermaid graph + JSON) at run end, plus a learnings note in `docs/knowledge/learnings/` after the dogfood run. At each human gate the orchestrator posts the accumulated trace alongside the gate summary, so the human sees both the plan and what actually ran. Keeping children alive is reserved for live debugging; delete-after-settle remains the default.

8. **Adversarial reviewer discipline — decided.** The reviewer is spawned **only when the plan calls for it** (a `critic` stage or `adversarial: true` on a producing stage); a cheap graph may omit it, and the plan gate lets the human demand one. Its report routes back to the orchestrator as the child's final message; the orchestrator either feeds it into the **revise loop** (re-runs the producing stage with the review as feedback) or posts it before the design gate for the human. The reviewer stays **advisory** per the trust ladder[^dogfooding]: its prompt forbids `git push`, PR comments, and merges — its only output is the report in its final message, and merge is human-gated regardless. Hardening to a read-only `github-ro` connector is a future option if the reviewer is ever allowed to run unattended; not required now.

9. **Gate discipline under dynamic planning — decided.** The three gates are **declared explicitly in the plan** (`gates` array, and each stage's `leadsToGate`). The planner may reorder or reshape stages around them, but **may never remove, merge, or bypass a gate** — this is a hard invariant in both the policy and the plan validator, which rejects any graph missing a declared gate. The expected answer stands: **no**.

10. **State across redeploys — decided: both, with the issue as source of truth.** The orchestrator's own session event history survives redeploys (engine recovery re-attaches the session)[^engine], giving it live in-memory state; the **issue comments carry the durable external state** (plan artifact, per-stage progress comments, gate statuses, execution trace). The orchestrator additionally writes a `run-state.json` checkpoint to its session working directory at every transition. On resume it re-reads the issue comments and its local checkpoint, re-derives position (which gate, which stages done, spend so far), and continues. This resolves the roadmap's open question: it is *both*, issue-as-canonical[^roadmap].

## Risks & mitigations

- **Plan gate adds a human touchpoint / latency.** Mitigation: the gate is lightweight (approve or amend once, pre-execution) and is the entire point of "inspect before execute"; it can later default-approve for trusted issue types, but never silently skip.
- **Fan-out spend explosion.** Mitigation: per-child kill switches (hard, ADR 011) plus the orchestrator's aggregate budget with refuse-to-spawn accounting; escalation when the ceiling is reached[^kill-switch].
- **Parallel git reconciliation conflicts.** Mitigation: one Mount per child with independent clones and per-child branches, non-overlapping concerns by construction, PR-to-main reconciliation; conflicts surface in review, never as concurrent writers[^mount-design].
- **Planner composes a bad graph.** Mitigation: the plan validator (schema + gate invariant + budgets ≤ aggregate) plus the Gate 0 human veto, and the planner may only pick from stage kinds declared in the policy.
- **Silent model fallback.** Mitigation: preflight + a one-line issue note on every substitution, so model drift is visible (§Q5).
- **Observability loss from deleting children.** Mitigation: `trace.json` + execution-trace comment + learnings note (§Q7).
- **Kill-switch not yet surfaced on session create.** Mitigation: the additive `killSwitch` field is in the minimal change set below; until it lands, the orchestrator enforces soft budgets by watching usage events and `DELETE`ing over-budget children itself.
- **State loss across redeploys.** Mitigation: issue comments as source of truth + local checkpoint cache (§Q10).

## ADR pointers

**No new ADR is required.** Each architecturally adjacent decision reuses an existing record:

- **Mount single-writer invariant** (mount-design.md) is **unchanged** — one Mount per parallel child is pure composition, so no amendment. If a future fan-out genuinely needs a shared live checkout, that would be the moment to amend the invariant to soft+`force`; this design explicitly does not[^mount-design].
- **Per-run budgets** — ADR 011 governs the per-child kill switch; the aggregate run budget is a recipe-level convention built on top of it, not a new server mechanism[^kill-switch].
- **Per-stage models** — ADR 015 governs provider records projected into pi and the child-create `model`/`provider` fields; no in-core routing is added[^providers-adr].
- **The plan artifact and Gate 0** are product-layer conventions under ADR 017 (product layer on OKF memory, pipeline outside the engine), not engine concepts[^product-adr].

## Minimal change set

- `agent-image/skills/orchestrator/SKILL.md` — replace the fixed stage list with the plan → execute → gate planner loop, the plan gate, retry/budget/observability rules. **The core change.**
- `agent-image/skills/orchestrator/policy.yaml` — new prompt-level policy schema (roles/tools/gates/budgets/models per stage) with the defaults above.
- `agent-image/skills/orchestrator/plan.schema.json` — new plan artifact contract the planner validates against.
- `packages/contracts/src/session.ts` — additive `killSwitch?: { timeoutSec?; maxTokens?; maxCost? }` on `createSessionInputSchema` (completes ADR 011).
- `packages/server/src/core/session-service.ts` (+ harness) — thread `killSwitch` from create to the already-decided per-run enforcement (completes ADR 011). The only server-side touch.
- `docs/knowledge/product/pipeline.md` — document Gate 0 (plan) in the gate table.
- Tests — plan-schema validation, budget-accounting helper, kill-switch plumbing.
- Post-dogfood (separate run, not this PR): `docs/knowledge/learnings/` note and a `multi-agent-workflow.md` Phase 4 status update.

No CLI changes and no new endpoints.

[^feature]: [Dynamic Orchestration Feature note](/product/features/dynamic-orchestration.md)
[^engine]: [Agent Land engine](/engine.md) — six primitives, everything else is composition
[^boundary]: [Agent Land domain boundary](/product/goals/boundaries.md)
[^mount-design]: [Mount design](/product/designs/mount-design.md) — hard single-writer invariant
[^kill-switch]: [ADR 011 — per-run kill switch](/adrs/011-kill-switch.md)
[^providers-adr]: [ADR 015 — providers as config records](/adrs/015-providers-as-config-records-projected-into-pi.md)
[^product-adr]: [ADR 017 — product layer on OKF memory](/adrs/017-product-layer-okf-memory.md)
[^orchestrator-skill]: [Static orchestrator recipe](agent-image/skills/orchestrator/SKILL.md)
[^session-contract]: `packages/contracts/src/session.ts`
[^routes]: `packages/contracts/src/routes.ts`
[^pipeline]: [The product pipeline](/product/pipeline.md)
[^dogfooding]: [Dogfooding strategy](/dogfooding.md)
[^roadmap]: [Multi-agent workflow](/multi-agent-workflow.md)
