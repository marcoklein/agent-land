---
type: Design
title: Schedule contract and loader
description: The schedule file is JSON read by a standalone loader that emits one validated, normalized schedule list; a bad schedule fails at load, not at its first due tick.
status: draft
tags: [scheduler, hitd, loop, okf]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-20T20:11:00Z }
sources:
  - id: scheduler
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/scripts/scheduler.sh
    title: Current scheduler — validate, due, tick, launch, watch
  - id: parent-design
    resource: /product/designs/alt-daj9-engine-native-scheduler-design.md
    title: Engine-native scheduler (parent design)
  - id: session
    resource: packages/contracts/src/session.ts
    title: Session contract — connectors, mounts, provider, model
---

# Schedule contract and loader

## Problem

The operator runs a scheduler that reads a hand-edited JSON file and checks it with one
long expression inside a bash script. The check demands a `ticketRepo` field nothing in the
run path reads, accepts whatever that one script happens to look at, and lets a malformed
cron or unknown timezone through until a run is due. The engine-native scheduler splits
this into slices — due-time, claims, launch/watch — and if each parses the file its own way
they drift, and a credential typed into the file could leak into a launched session. There
is no single agreed, validated contract.

## Decision requested

1. **The file is JSON, read by jq — not YAML.** The loop is bash + jq, and jq parses JSON
   only; no YAML parser exists on the host. The file is `schedules.json`. *Rejected:* a
   `.yaml` file requiring a `yq` binary on the host, for a file only the loop reads.
2. **The loader is a standalone command, not a function in one growing scheduler script.**
   It prints one normalized schedule list on stdout and exits non-zero on any failure; the
   due-time, claims, and launch slices call it instead of re-parsing. *Rejected:* keeping
   validation inside a `scheduler.sh` that every slice also grows into, and a TypeScript
   package for a single parse.
3. **The contract pins `target: {repo, tags}` and `concurrency: skip-if-running` now, and
   drops the dead fields.** Today's `ticketRepo`/`tags` are validated but never read; the
   only concurrency value the claims slice implements is `skip-if-running`. Other targets
   stay open. *Rejected:* keeping the dead fields, or speculating concurrency values and
   target types nothing implements yet.

## Approach

The loader is the ticket's whole slice: the validator is the contract's executable form,
and neither ships alone. It reads `schedules.json` and either prints a normalized schedule
list or fails with a non-zero exit and a message on stderr. Every check runs at load —
including the 5-field cron shape and the timezone — so a bad schedule fails once when
loaded, not when its first run is due.

Normalization materializes every default so consumers never see a missing field, keeps only
the listed fields, and key-sorts the result. The secret rule is a hard check: the file
names connectors, providers, and mounts only, so unknown fields are rejected outright and
any value matching password, token, or key is rejected too.

## Interfaces

### Schedule contract, version 1

| Field | Type | Default | Check |
|---|---|---|---|
| `version` | integer | — | must be `1` |
| `schedules` | list | — | non-empty |
| `schedules[].id` | string | — | unique within the file |
| `schedules[].cron` | string | — | 5 fields, `*`, `*/n`, lists, ranges |
| `schedules[].timezone` | string | — | IANA, checked with `TZ=… date` at load |
| `schedules[].enabled` | boolean | `true` | |
| `schedules[].target.repo` | string | — | the repo the run works on |
| `schedules[].target.tags` | list | `[]` | |
| `schedules[].session.platform` | boolean | `true` | launch always sends `true` |
| `schedules[].session.connectors` | list | `[]` | connector names |
| `schedules[].session.provider` | string | `""` | provider id; empty means default |
| `schedules[].session.model` | string | `""` | |
| `schedules[].session.mounts` | list | `[]` | `{source, target}` binds |
| `schedules[].concurrency` | string | `skip-if-running` | only accepted value |
| `schedules[].timeout` | integer | — | positive whole number |

The old script's `timeoutSec` becomes `timeout` — the ticket and the claims slice use that
name, and nothing outside the replaced `scheduler.sh` depends on the old one. Mounts become
`{source, target}` binds, matching what the session API accepts, not the name strings the
old validator accepted. `ticketRepo` and top-level `tags` disappear into `target`.

## Risks

- **A hand-edited schedule carries a credential or unknown field** → it fails at load,
  before any session launches with a secret in its environment.
- **The ticket title says `schedules.yaml`** → the note renames it `schedules.json`; if an
  operator prefers YAML, `yq` is a host dependency to add later, not now.
- **A slice re-parses instead of calling the loader** → drift returns; review should reject
  any slice that reads the file directly.
- **Value scan false positives** → a connector named "token-vault" would be rejected; the
  whitelist is the structural rule, the scan a backstop to document clearly.

## ADR pointers

No new ADR. Consistent with the domain boundary (schedules are composition outside the
engine) and the parent [engine-native scheduler design](/product/designs/alt-daj9-engine-native-scheduler-design.md),
whose compatibility fields this note turns into an executable, tested contract.

## Change set

**This PR (docs, agent-land):** this Design note plus an entry in the designs index.

**After the gate (agent-land-tickets, push-to-main):**

- `scripts/schedules-loader` (new) — read `schedules.json`, validate, print the normalized
  list on stdout, exit non-zero on any failure.
- `tests/` — a valid schedule loads; each malformed and secret-bearing input fails.
- `scripts/scheduler.sh` — replaced by slices that call the loader (later tickets:
  due-time, claims, launch/watch).
