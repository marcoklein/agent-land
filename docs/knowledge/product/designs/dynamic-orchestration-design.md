---
type: Design
title: Dynamic Orchestration
description: The orchestrator recipe becomes a planner — it emits an inspectable per-task plan (a new pre-execution gate), then realizes that plan as child sessions over the loopback, with per-stage models, orchestrator-enforced soft budgets, retries, and one-Mount-per-parallel-child worktrees with explicit GC. No engine change, no server code.
status: draft
generated: { by: pi/deepseek-v4-pro, at: 2026-09-05T20:50:00Z }
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

The change is confined to the **product layer**: the orchestrator recipe and its policy/plan artifacts, the Gate-0 documentation, this design note, and tests. **No server code.** The engine gains no workflow executor, no DAG vocabulary, and no vendor catalog; everything new is a recipe concern, exactly where the domain boundary says control flow belongs[^boundary][^product-adr].

The orchestrator's job splits into three phases:

1. **Plan.** On intake, the orchestrator reads the issue and the policy, then composes a per-task **stage graph**: which stages run, in what order (with parallel groups), with which role, connectors, mounts, provider, model, and budget. It validates the graph against a fixed **plan schema** and the gate invariant, then posts it to the issue as a **plan artifact** and parks. This is a **new pre-execution gate (Gate 0)** — the human vetoes or amends the plan before any child is spawned.
2. **Execute.** After Gate 0 clears, the orchestrator realizes each stage as a child session over the loopback, passing `model`/`provider`/`connectors`/`mounts` at child-create time. It watches each child, collects its result, retries per policy, and accounts every child's actual `message_end` usage against an **aggregate run budget** the orchestrator alone holds — `DELETE`ing any child that exceeds its per-stage budget or the remaining run budget.
3. **Gate.** The three human gates stay exactly where they are — outcome, design, merge — as `waiting_for_input` parks[^pipeline]. The planner may reorder or reshape stages, but may never remove, merge, or bypass a gate; the plan validator rejects any graph that does.

The orchestrator itself binds **no** Mount (the static recipe's hard-won layout, unchanged)[^orchestrator-skill]. For sequential stages it binds the shared repo Mount one child at a time; for parallel stages it creates **one uniquely named Mount per child** — `agent-land-<stage>-<runId>` — and deletes it after that child settles (§Answers, Q2).

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
      "budget": { "timeoutSec": 1200, "maxTokens": 100000, "maxCost": 1.00 },
      "retry": { "maxAttempts": 2, "on": ["failure"] },
      "leadsToGate": "outcome"
    },
    {
      "id": "design",
      "kind": "design",
      "role": "design stage — design note + design PR",
      "dependencies": ["refine"],
      "parallelGroup": null,
      "connectors": ["github"],
      "mounts": [{ "source": "agent-land", "target": "/data/agent-land", "seed": "clone" }],
      "provider": "opencode-go",
      "model": "deepseek-v4-pro",
      "budget": { "timeoutSec": 1800, "maxTokens": 150000, "maxCost": 1.50 },
      "retry": { "maxAttempts": 2, "on": ["failure", "stall"] },
      "leadsToGate": "design"
    },
    {
      "id": "critic",
      "kind": "critic",
      "role": "adversarial reviewer — read-only, advises, never merges",
      "dependencies": ["design"],
      "parallelGroup": null,
      "connectors": ["github-ro"],
      "mounts": [],
      "provider": "opencode-go",
      "model": "deepseek-v4-pro",
      "budget": { "timeoutSec": 600, "maxTokens": 40000, "maxCost": 0.40 },
      "retry": { "maxAttempts": 1, "on": ["failure"] },
      "leadsToGate": "design"
    }
  ],
  "edges": [["refine", "design"], ["design", "critic"]],
  "parallelGroups": [],
  "gates": ["plan", "outcome", "design"],
  "aggregateBudget": { "timeoutSec": 6600, "maxTokens": 580000, "maxCost": 5.40 },
  "deviations": [
    { "default": "research", "actual": "skip", "reason": "issue body already specifies the outcome; policy allows skip-research for well-specified issues" }
  ]
}
```

- **Budget is orchestrator-enforced.** `budget` is a soft, orchestrator-held limit per stage — it is **not** a field the server reads. The orchestrator enforces it by watching `message_end` usage and `DELETE`ing an over-budget child (§Interfaces 3, §Answers 4).
- **`maxAttempts` is TOTAL attempts** — 1 initial run + `(maxAttempts − 1)` retries. `maxAttempts: 2` = 2 total runs; `maxAttempts: 1` = no retry.
- **Mount lifecycle.** Sequential stages bind the shared `agent-land` repo Mount one at a time. Parallel stages each get a uniquely named Mount `agent-land-<stage>-<runId>`, created via `POST /api/mounts` and removed via `DELETE /api/mounts/<name>` in the plan-execute loop's finally/cleanup step after that child settles.
- **Home.** The canonical copy is the **issue comment** (durable, human-inspectable, survives redeploys). The orchestrator also writes it to its own session working directory as a re-load cache. On resume after a redeploy, the orchestrator re-fetches the issue comment if the local file is missing.
- **Inspectable before execution.** The plan is posted and Gate 0 parks **before the first child is spawned**. The human sees the exact stages, order, models, budgets, and gate points, and replies `approved` or `feedback: …`.
- **Gate.** Yes — the plan is a new, additive gate. It does not replace the three existing gates; it precedes them. A run's `gates` array declares only the gates that run crosses; implement/merge are a separate dev-loop run with its own plan.

### 2. Policy schema (prompt-level, in the agent image)

The recipe becomes a declaration. It lives at `agent-image/skills/orchestrator/policy.yaml`, not in the server. A compact form:

```yaml
version: 1
defaults:
  provider: opencode-go
  model: deepseek-v4-pro
  budget: { timeoutSec: 1800, maxTokens: 100000, maxCost: 1.00 }   # orchestrator-enforced soft budget
runBudget: { timeoutSec: 14400, maxTokens: 800000, maxCost: 15.00 }   # aggregate ceiling, orchestrator-held
retry:
  # maxAttempts is TOTAL attempts per stage = 1 initial + (maxAttempts - 1) retries.
  # maxAttempts: 2 = 2 total runs (1 initial + 1 retry); maxAttempts: 1 = no retry.
  default: { maxAttempts: 2, on: [failure] }
  onFailure: "retry with adjusted prompt + the previous attempt's failure reason"
  onStall: "DELETE the stalled child, re-prompt with numbered steps and a smaller scope"
  escalateAfter: "per-stage budget x maxAttempts, or the aggregate run budget — whichever exhausts first"
stages:
  research:
    role: "research stage of the product pipeline"
    connectors: [github]
    provider: opencode-go
    model: deepseek-v4-pro            # cheap
    budget: { timeoutSec: 900, maxTokens: 60000, maxCost: 0.60 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: null
  refine:
    role: "refine stage — feature note + spec PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1200, maxTokens: 100000, maxCost: 1.00 }
    retry: { maxAttempts: 2, on: [failure] }
    leadsToGate: outcome
  design:
    role: "design stage — design note + design PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1800, maxTokens: 150000, maxCost: 1.50 }   # strong
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: design
  critic:
    role: "adversarial reviewer — read-only, advises only, never merges"
    connectors: [github-ro]            # read-only GitHub token: view/diff only, cannot push or open PRs
    mounts: []                         # gh pr view / gh pr diff need no checkout
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 600, maxTokens: 40000, maxCost: 0.40 }     # small
    retry: { maxAttempts: 1, on: [failure] }    # 1 total attempt = no retry
    leadsToGate: design
  implement:
    role: "implementation child — dev loop to a green PR"
    connectors: [github]
    mounts: [{ source: agent-land, target: /data/agent-land, seed: clone }]
    provider: opencode-go
    model: deepseek-v4-pro
    budget: { timeoutSec: 1800, maxTokens: 200000, maxCost: 2.00 }
    retry: { maxAttempts: 2, on: [failure, stall] }
    leadsToGate: merge
decisions:
  skip-research:
    allow: true
    triggers:
      - "issue body already specifies the outcome, constraints, and acceptance criteria (no ambiguity)"
      - "a Feature note already exists on the issue and needs no new research"
    forbid:
      - "issue references docs/ADRs not already summarized in the body"
      - "open questions remain in the Feature note's scope"
    effect: "research stage omitted from the plan; its role moves into the refine prompt's context"
  deepen-research:
    allow: true
    triggers:
      - "the issue or a prior stage raises a design/architecture question the notes must answer"
      - "a referenced ADR/design/trace is contested or partially contradicted by the issue"
    definition: "an extra research pass that reads the specific additional docs, ADRs, and learnings/ trace notes named by the trigger and produces an addendum brief — never a blanket 'read everything'"
    effect: "a second research child (or an expanded research prompt) whose brief is appended to refine's context"
  parallel:
    allow: true
    maxFanOut: 3
    splitBy: "non-overlapping implementation concerns or non-overlapping note sections, each on its own branch + PR"
    forbid:
      - "two children touching the same files"
      - "two children sharing a Mount"
      - "fan-out of gate-producing stages (refine/design stay sequential)"
gates:
  plan:    { order: 0, mechanism: "issue comment + waiting_for_input" }
  outcome: { order: 1, mechanism: "spec PR review" }
  design:  { order: 2, mechanism: "design PR review" }
  merge:   { order: 3, mechanism: "human PR merge" }
invariants:
  - "gates may never be removed, merged, or bypassed"
  - "parallel children get one Mount each, named agent-land-<stage>-<runId>, DELETEd after the child settles; never a shared live .git"
  - "connectors and mounts resolve by exact name"
  - "critic is read-only: github-ro connector only, no mounts"
```

The `decisions` block is what makes the planner **governed, not improvised**. The planner may only deviate along the enumerated axes — skip-research, deepen-research, and parallel fan-out — each with explicit trigger conditions, forbid lists, and effects. Everything else is **residual planner judgment**, bounded by exactly two things: (1) **Gate 0** — the human sees the full plan and can veto or amend it before any child spawns; and (2) the **plan validator invariant** — gates may never be removed/merged/bypassed, and every stage must be a declared stage kind whose connectors and mounts resolve by exact name. The planner cannot invent a new stage kind, a new connector, or a new budget shape.

Tool scoping is prompt-level only: the platform has no tool vocabulary to enforce (ADR 016), and the only real per-child scoping the platform offers is connector selection[^boundary]. The `connectors`/`mounts` fields are the enforceable scope; what the child *may do with its tools* is stated in its stage prompt, not enforced by the server.

### 3. API / CLI surface

No new endpoints, no new engine concepts, and **no server code**. Everything this design needs already exists in the canonical API[^routes]:

- **Child create already accepts `model` and `provider`** (`createSessionInputSchema`)[^session-contract] — per-stage model choice is a child-create field, not a server feature (ADR 015)[^providers-adr].
- **Child create already accepts `mounts`** — one-Mount-per-child parallelism is pure composition (mount-design)[^mount-design]. Parallel children each get their own Mount created with the existing `POST /api/mounts`, named `agent-land-<stage>-<runId>`.
- **Soft budget enforcement is orchestrator-side.** The orchestrator reads each child's `usage` from its streamed `message_end` events, aggregates spend against the per-stage and run budgets, and `DELETE`s (`DELETE /api/sessions/:id`) any child that exceeds its per-stage budget or the remaining run budget. **Hard server-side kill-switch enforcement (watchdog + mid-run token/cost accounting) remains ADR 011 future work and is explicitly out of scope here**[^kill-switch]. The current server exposes only manual abort/kill for live sessions, and this design does **not** add a `killSwitch` field to session create.
- **Mount GC is orchestrator-side.** After each parallel child settles, the orchestrator runs `DELETE /api/mounts/agent-land-<stage>-<runId>` in a finally/cleanup step, so full-clone volumes cannot orphan[^routes].
- **Read-only reviewer.** The operator creates a `github-ro` connector — a read-only GitHub token stored as an ordinary config record via `POST /api/connectors`. The orchestrator's preflight discovers it by exact name and passes **only** that connector to `critic` children, with no Mount. The token cannot push, comment, or open PRs, so the reviewer is read-only by construction, not by prompt discipline.
- **Model preflight.** The orchestrator resolves models against `GET /api/providers` and `GET /api/models` once per run (already in the canonical API)[^routes].
- **CLI.** No `al` changes are required: children are spawned over the JSON/SSE API, and `al ls --tree` already renders lineage for live children.

## Answers to the Feature note's open questions

1. **Plan contract / home — decided.** A `plan.json` artifact (schema above) is the plan's home. It is **posted to the issue as a new pre-execution gate (Gate 0) before any child is spawned**. The orchestrator validates the plan against the schema and the gate invariant, posts the JSON fenced in a comment, and parks for `approved` / `feedback:`. Local files are a re-load cache; the issue comment is canonical.

2. **Parallelism vs. the single-writer invariant — decided: one Mount per parallel child; the invariant is unchanged.** The Mount single-writer invariant stands exactly as written — no ADR/design-note amendment[^mount-design]. Each parallel child gets its own Mount, so no two live sessions ever bind the same Mount. **Seeding strategy: an independent `git clone` per child** (the child's step 0 clones the repo into its own Mount). `git worktree add` from a shared seed is rejected because it shares one live `.git` across worktrees — precisely the shared-live-writer the invariant forbids; `clone --reference` is rejected because it couples children to a mutable reference repo. **Reconciliation: each child works on its own branch and pushes it; reconciliation is via PRs to `main` — never a shared live `.git`.** Parallel children are given non-overlapping concerns by construction; if two PRs still conflict, the conflict is resolved in PR review by a follow-up child or the human, not by concurrent git writers. **Each parallel child's Mount is created with a unique name `agent-land-<stage>-<runId>` and `DELETE /api/mounts/<name>` is called in a finally/cleanup step after that child settles**, so full-clone volumes cannot orphan.

3. **Retry policy — decided.** Three classes:
   - **Failure** — a child settles but its output is missing, invalid, or explicitly reports failure (e.g. spec PR not opened, typecheck red). → **Retry with an adjusted prompt**: a fresh child on the same stage, with the previous attempt's final report and the specific failure reason appended, and an instruction "attempt 1 failed because X; fix X specifically".
   - **Stall** — a child exceeds its per-stage time budget, or hangs without settling past its budget. → **Re-prompt with numbered steps**: the retry prompt is broken into explicit numbered steps with a smaller scope; the previous child is deleted first to free its Mount.
   - **Escalate-to-human** — a stage exhausts its attempt budget, or a gate would be reached with quality still failing, or the aggregate budget cannot cover another attempt. → The orchestrator posts the collected stage outputs to the issue and parks at the relevant gate asking the human to re-instruct or abort. Escalation is always a park, never an autonomous abandon.
   - **`maxAttempts` is the TOTAL number of attempts per stage** — 1 initial run plus `(maxAttempts − 1)` retries. The policy default is `maxAttempts: 2` = 2 total runs (1 initial + 1 retry); `critic` and other cheap advisory stages get `maxAttempts: 1` = no retry. This matches `policy.yaml` exactly: `retry.maxAttempts` everywhere means total runs, never retries. The loop is bounded by `per-stage budget × maxAttempts` **and** the aggregate run budget — whichever is exhausted first stops the loop and escalates.

4. **Budgets — decided.** Per-stage budgets are assigned in the policy by stage difficulty: research cheap (900s / 60k tokens / $0.60), design strong (1800s / 150k / $1.50), adversarial reviewer small (600s / 40k / $0.40), implement strong (1800s / 200k / $2.00), with the ADR 011 default (1h / 100k / $1) as the baseline for anything unlisted[^kill-switch]. The orchestrator computes an **aggregate run budget per dimension**, capped by the policy `runBudget` ceiling (4h / 800k tokens / $15):

   - **Wall-clock (`timeoutSec`)** — sequential stages add; parallel stages overlap: `Σ (sequential stage.timeoutSec × maxAttempts)` **+** `Σ parallel-group max child∈group (child.timeoutSec × child.maxAttempts)`. (The max over a group is its critical path.)
   - **Tokens (`maxTokens`) and cost (`maxCost`)** — always additive: `Σ all stages (stage.maxTokens × maxAttempts)` and `Σ all stages (stage.maxCost × maxAttempts)`. Parallelism overlaps wall-clock but not token/cost spend, so no max is taken.

   The orchestrator **alone holds the aggregate**; each child carries only its own per-stage budget in its plan entry (no server field — §Interfaces 3). **Enforcement is orchestrator-side accounting**: before each spawn the orchestrator checks `spent + worst-case-of-this-stage ≤ remaining` and refuses to spawn (falls back to a cheaper model, or escalates) if not; after each child it parses the child's streamed `message_end` usage (already in the event log) and adds actuals to `spent`. Any child whose actuals exceed its per-stage budget — or whose continued run would blow the remaining run budget — is `DELETE`d by the orchestrator. Hard server-side kill-switch enforcement is ADR 011 future work, out of scope here[^kill-switch].

5. **Model policy — decided.** The per-stage model policy lives in `policy.yaml` in the agent image (the recipe's policy schema above), not in the server. Models are chosen **by name at child-create time**: the orchestrator passes the policy's `provider` and `model` strings on `POST /api/sessions` (ADR 015 projection, already supported)[^providers-adr][^session-contract]. Capability is expressed in policy comments, not queried at runtime — the platform has no in-core capability catalog (ADR 016), and the policy author (a human) picks names. **Fallback when a chosen model/provider is absent:** the orchestrator preflights `GET /api/providers` + `GET /api/models` once per run; if a policy-named provider/model is missing it applies a documented ladder — (1) that provider's `defaultModel`, (2) the platform `DEFAULT_PROVIDER_ID` + server `defaultModel` — and **posts a one-line note to the issue** recording the substitution so the human sees the deviation. If even the default is unavailable, it escalates (parks) rather than spawning blind.

6. **"Visibly differs" and "matching quality" — decided.** *Visibly differs*: the executed graph deviates from the static default in at least one of skip-research, deepen-research, parallel fan-out, added adversarial reviewer, or per-stage model change — evidenced by the plan artifact plus the execution trace comment (§Q7). *Matching quality*: the three human gates still clear with the same artifacts (feature note, design note, green PR). The number of human `feedback:` corrections per gate is a **target signal** — we aim for no worse than the static baseline (≤ 1 feedback round per gate) — but a single dogfood run (n=1) cannot validate it; it is directional evidence, not a pass criterion. The hard criterion is that the gates clear with the required artifacts and the dogfooding success signals hold — task→green-PR wall-clock not worse than the static baseline, PR still opened by an agent-land session[^dogfooding].

7. **Observability of a dynamic graph — decided.** Children are still `DELETE`d after settling to free their Mounts, so `al ls --tree` shows only the in-flight graph — which is correct and sufficient **while the run is live**. The **durable executed graph** is a `trace.json` the orchestrator maintains (one record per child: `{stage, childId, provider, model, budgetUsed, result, deletedAt}`) and posts to the issue as a final **execution-trace comment** (mermaid graph + JSON) at run end, plus a learnings note in `docs/knowledge/learnings/` after the dogfood run. At each human gate the orchestrator posts the accumulated trace alongside the gate summary, so the human sees both the plan and what actually ran. Keeping children alive is reserved for live debugging; delete-after-settle remains the default.

8. **Adversarial reviewer discipline — decided: read-only by construction, not by prompt.** The reviewer is spawned **only when the plan calls for it** (a `critic` stage or `adversarial: true` on a producing stage); a cheap graph may omit it, and the plan gate lets the human demand one. It runs with **no Mount** (it reviews `gh pr view` / `gh pr diff` output, which needs no checkout) and with a **`github-ro` read-only GitHub connector** — a token the operator creates as a generic config record, which cannot push, comment, or open PRs even by accident. This is a concrete interface change in this design, not deferred hardening. Its report routes back to the orchestrator as the child's final message; the orchestrator either feeds it into the **revise loop** (re-runs the producing stage with the review as feedback) or posts it before the design gate for the human. Merge stays human-gated regardless[^dogfooding].

9. **Gate discipline under dynamic planning — decided.** The three gates are **declared explicitly in the plan** (`gates` array, and each stage's `leadsToGate`). The planner may reorder or reshape stages around them, but **may never remove, merge, or bypass a gate** — this is a hard invariant in both the policy and the plan validator, which rejects any graph missing a declared gate. The expected answer stands: **no**.

10. **State across redeploys — decided: both, with the issue as source of truth.** The orchestrator's own session event history survives redeploys (engine recovery re-attaches the session)[^engine], giving it live in-memory state; the **issue comments carry the durable external state** (plan artifact, per-stage progress comments, gate statuses, execution trace). The orchestrator additionally writes a `run-state.json` checkpoint to its session working directory at every transition. On resume it re-reads the issue comments and its local checkpoint, re-derives position (which gate, which stages done, spend so far), and continues. This resolves the roadmap's open question: it is *both*, issue-as-canonical[^roadmap].

## Risks & mitigations

- **Plan gate adds a human touchpoint / latency.** Mitigation: the gate is lightweight (approve or amend once, pre-execution) and is the entire point of "inspect before execute"; it can later default-approve for trusted issue types, but never silently skip.
- **Fan-out spend explosion.** Mitigation: per-child orchestrator-enforced budgets plus the orchestrator's aggregate budget with refuse-to-spawn accounting; escalation when the ceiling is reached.
- **Soft budgets are not hard stops.** The orchestrator can only `DELETE` a child after it observes usage, so a child that races past a limit mid-turn is bounded by the watch/poll interval, not mid-execution. Mitigation: accept this for this change; hard server-side kill-switch enforcement is ADR 011 future work and stays explicitly out of scope[^kill-switch].
- **Orphaned full-clone volumes.** Each parallel child clones into its own `agent-land-<stage>-<runId>` Mount; if the orchestrator crashes between settle and cleanup, the volume leaks. Mitigation: `DELETE /api/mounts/<name>` runs in a finally/cleanup step per child; on resume the orchestrator lists mounts and deletes any `agent-land-<runId>-*` volume no longer bound to a live child.
- **Parallel git reconciliation conflicts.** Mitigation: one Mount per child with independent clones and per-child branches, non-overlapping concerns by construction, PR-to-main reconciliation; conflicts surface in review, never as concurrent writers[^mount-design].
- **Planner composes a bad graph.** Mitigation: the plan validator (schema + gate invariant + budgets ≤ aggregate) plus the Gate 0 human veto, and the planner may only pick from stage kinds and decision axes declared in the policy (§Interfaces 2).
- **Silent model fallback.** Mitigation: preflight + a one-line issue note on every substitution, so model drift is visible (§Q5).
- **Observability loss from deleting children.** Mitigation: `trace.json` + execution-trace comment + learnings note (§Q7).
- **State loss across redeploys.** Mitigation: issue comments as source of truth + local checkpoint cache (§Q10).

## ADR pointers

**No new ADR is required.** Each architecturally adjacent decision reuses an existing record:

- **Mount single-writer invariant** (mount-design.md) is **unchanged** — one Mount per parallel child is pure composition, so no amendment. If a future fan-out genuinely needs a shared live checkout, that would be the moment to amend the invariant to soft+`force`; this design explicitly does not[^mount-design].
- **Per-run budgets** — ADR 011 specifies the per-run kill switch this design will eventually hard-enforce server-side. This change stays composition-preserving and enforces budgets **orchestrator-side (soft)** instead; the server work (watchdog, mid-run `message_end` accounting, mid-run kill) is ADR 011 future work, not part of this change[^kill-switch].
- **Per-stage models** — ADR 015 governs provider records projected into pi and the child-create `model`/`provider` fields; no in-core routing is added[^providers-adr].
- **The plan artifact and Gate 0** are product-layer conventions under ADR 017 (product layer on OKF memory, pipeline outside the engine), not engine concepts[^product-adr].

## Minimal change set

- `agent-image/skills/orchestrator/SKILL.md` — replace the fixed stage list with the plan → execute → gate planner loop, the plan gate, retry/budget/observability rules, per-child Mount naming + GC, and soft-budget enforcement via `message_end` usage accounting. **The core change.**
- `agent-image/skills/orchestrator/policy.yaml` — new prompt-level policy schema (stages, budgets, retry semantics, skip/deepen-research triggers, parallel fan-out bounds, critic read-only scope) with the defaults above.
- `agent-image/skills/orchestrator/plan.schema.json` — new plan artifact contract the planner validates against (stages, edges, gates, aggregateBudget, deviations).
- `docs/knowledge/product/pipeline.md` — document Gate 0 (plan) in the gate table.
- `docs/knowledge/product/designs/dynamic-orchestration-design.md` — this note.
- Tests — plan-schema validation, per-dimension budget-accounting helpers (wall-clock max-over-parallel vs. additive tokens/cost), mount-GC and soft-budget accounting helpers.
- Operator one-time config (not code): a read-only `github-ro` connector record on the platform for the critic stage.

**No server code** — no `packages/contracts` or `packages/server` changes. Hard server-side kill-switch enforcement remains ADR 011 future work[^kill-switch].

Post-dogfood (separate run, not this PR): `docs/knowledge/learnings/` note and a `multi-agent-workflow.md` Phase 4 status update.

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
