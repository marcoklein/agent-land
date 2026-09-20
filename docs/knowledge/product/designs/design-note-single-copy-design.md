---
type: Design
title: Design phase — one design note in agent-land, none in the tickets repo
description: The loop's design step writes one copy — the OKF Design note in agent-land, opened as a PR — and records the PR number on the ticket; the tickets design.md copy is removed.
status: stable
tags: [tickets, hitd, loop, okf]
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-20T13:25:00Z }
sources:
  - id: loop
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/loop.sh
    title: Loop driver — phase prompts, artifact mapping, spawn
  - id: tk
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/tk
    title: tk — ticket CLI and frontmatter writer
  - id: ticket-layer
    resource: /product/designs/ticket-layer-design.md
    title: Ticket layer (parent design)
---

# Design phase — one design note in agent-land, none in the tickets repo

## Problem

The design step writes the same design twice. It writes one copy as `work/<id>/design.md`
in the tickets repo and a second copy as the OKF Design note in agent-land — the one a
human actually reads and approves in a pull request. Two copies of one document drift: the
tickets copy is frozen after the step, the agent-land copy is edited through review, and a
later step may read the stale one. The loop also never records which pull request carries
the design, so it cannot later tell whether that PR was merged or sent back for changes.

## Decision requested

1. **Keep one copy — the agent-land note.** The design step writes only the OKF Design note
   and opens its PR; it stops writing `work/<id>/design.md` in tickets. *Rejected:* keep
   both and re-sync after review (still two copies, still drift).
2. **Record the PR on the ticket.** The design agent writes `external-ref: gh-<number>`
   into the ticket frontmatter directly, in the same session that opens the PR. *Rejected:*
   a new `tk` command to set the field (new surface for a one-line edit; the existing field
   writer touches only the key it is asked to change, so a direct edit is safe).
3. **Structure reads from agent-land `main`.** The structure step clones agent-land, finds
   the note through the `external-ref` PR's file list, and reads it from merged `main`.
   *Rejected:* reading the PR branch (it can be rewritten or rebased; merged `main` is the
   approved truth).

## Approach

Three prompt edits in `scripts/loop.sh`; no engine or `scripts/tk` change:

- **needs-design** (`loop.sh:54`) stops saying "Produce design.md" (the tickets copy). It
  instructs: clone agent-land, write the Design note under `docs/knowledge/product/designs/`,
  open the PR, record `external-ref: gh-<number>` on the ticket, append thoughts, return
  STATUS.
- **Artifact mapping** (`loop.sh:42`) returns no artifact for `needs-design`, and the
  generic "Write work/$id/$artifact" instruction (`loop.sh:167`) is skipped when the phase
  has none.
- **needs-structure** (`loop.sh:55`) stops pointing at a tickets `design.md`; it clones
  agent-land, resolves the note path from the `external-ref` PR (`gh pr view <n> --json
  files`), and reads that file from `main`.

The ticket frontmatter already carries `external-ref` at create time (`tk:152`); nothing
rewrites it later — `update_yaml_field` (`tk:122`) touches only the key it is asked to
change, and `retag_ticket` touches only the `tags:` line. No `scripts/tk` change.

## Interfaces

- **Ticket frontmatter** — gains `external-ref: gh-<number>` at design time, written by the
  agent, read later by the structure step and by gate reconciliation (`alt-sj6u`).
- **needs-design prompt** — no tickets artifact; deliverables are the agent-land PR and the
  frontmatter edit.
- **needs-structure prompt** — reads the note from agent-land `main`, located through the
  `external-ref` PR.
- Nothing else reads `work/<id>/design.md`, so removing it breaks no other phase.

## Risks

- **Agent forgets the frontmatter edit** → the design PR exists but is unfindable. Mitigate
  by making the prompt's completion condition explicit: `STATUS: COMPLETED` only after the
  frontmatter edit is committed and pushed.
- **PR number extraction** → `gh pr create` prints the URL; the agent parses the trailing
  number. Untested; if it fails the agent returns BLOCKED rather than silently omitting the
  ref.
- **Structure reads a draft by mistake** → mitigated by reading from `main`, never the PR
  branch; the note reaches `main` only through a merged PR.

## ADR pointers

Consistent with [ADR 019](/adrs/019-ticket-layer-git-synced-repo.md) (memory lives in
agent-land; the tickets repo is the working queue) and [ADR 017](/adrs/017-product-layer-okf-memory.md)
(design notes are OKF). Amends the [ticket layer design](/product/designs/ticket-layer-design.md),
whose design gate still describes a tickets `design.md` working copy. No new ADR.

## Change set

**This PR (docs, agent-land):** this Design note plus an entry in the designs index.

**After the gate (agent-land-tickets, push-to-main):**

- `scripts/loop.sh` — three prompt edits plus the artifact guard, as above.
- `AGENTS.md` — the design step's artifact is the agent-land PR and `external-ref`, not a
  tickets `design.md`.
- Dogfood — the next ticket through the design gate leaves no `design.md` in the tickets
  repo.
