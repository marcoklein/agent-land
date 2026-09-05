---
name: product
description: Run the product pipeline — refine an outcome into an OKF Feature note, draft a Design note, and open a PR for the design review gate. Active when the user states a product outcome ("I want X"), asks to plan a feature, or requests a design review handoff.
---

# product — the product pipeline

The pipeline's job is to raise the interaction level: the human states an **outcome** and reviews at **gates**; this skill produces the memory notes, the design, and the plan in between. It covers stages 1–2 (refine + design) and hands off at the design review gate. Implementation runs through the normal dev loop in `AGENTS.md`.

Full walk-through: `docs/knowledge/product/pipeline.md`.

## The three gates

| Gate | Artifact | Mechanism |
|---|---|---|
| Outcome | Feature note (draft) | quick review of the note |
| Design | Design note (draft) | **PR on the note** — merge = approved design |
| Merge | green PR | existing PR review (human-gated) |

Never skip a gate. This skill stops at the design gate — it does not implement.

## Workflow

### 1. Refine (outcome → Feature note)

**Fit-check first.** Before writing, read `docs/knowledge/product/goals/boundaries.md`, `docs/knowledge/product/goals/vision-board.md`, and the relevant ADRs. Run two checks:

1. **Boundary** — does the outcome compose from the six primitives, or does it violate the domain boundary (in-core UI, in-core orchestration, vendor knowledge, databases)? This answers *is it in scope?*
2. **Vision board** — does the outcome serve the stated vision, target group, needs, or business goals? This answers *is it worth building?* A change can pass the boundary and still fail the board.

If either check signals a deviation, surface a **scope deviation** — reject/reframe/amend-via-ADR — and do *not* write a Feature note until the human resolves it. Scope creep is revealed, never silently absorbed.

Then write `docs/knowledge/product/features/<slug>.md` as an OKF note (`type: Feature`, `status: draft`). Follow the [okf skill](/opencode/skills/okf). The note must contain:

- **Why** — the problem in one paragraph.
- **User stories** — `As a …, I want …, so …`.
- **Acceptance criteria** — concrete, testable.
- **Open questions** — decisions the design gate must answer.

Cross-link the underlying engine primitives from `/engine.md`. Present the note for the outcome gate; do not proceed until the human confirms it captured intent.

### 2. Design (Feature → Design note)

After the outcome gate passes, write `docs/knowledge/product/designs/<slug>-design.md` as an OKF note (`type: Design`, `status: draft`) containing:

- **Approach** — the shape of the change.
- **Interfaces** — contracts, routes, env, CLI surface that change.
- **Risks & mitigations**.
- **ADR pointers** — link or flag a new `docs/knowledge/adrs/NNN-*.md` if the change is architecturally significant.
- **Minimal change set** — files/packages touched.

Answer the Feature note's open questions here, or mark them explicitly deferred.

### 3. Design review handoff (stop)

Open a PR containing only the Design note (and the Feature note if new). The PR body summarizes the design in a paragraph. The design is approved by merging the PR — comments on the PR are the review dialogue. Do **not** start implementation before the design PR is merged.

### 4. After approval

Implementation is a separate run of the standard dev loop (`branch → typecheck → test → PR → CI green`). On merge, promote the Feature note `status: draft → stable` and capture operational learnings in `docs/knowledge/learnings/`.

## Rules

- Product memory lives only in `docs/knowledge/product/` — never in `thoughts/` or prose docs.
- Use OKF frontmatter and `generated.by` set to your own identity (`opencode/<model>`), never the user.
- Only set `verified` when a human actually confirmed content.
- Deterministic steps (`pnpm typecheck`, `pnpm test`, `gh pr create`) run as commands; AI only at decision points.
- Keep the human at exactly three gates — no surprise actions in between.
