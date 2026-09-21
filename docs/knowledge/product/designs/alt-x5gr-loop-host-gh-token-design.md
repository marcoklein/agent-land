---
type: Design
title: Replace the loop host's GitHub token with a read-only fine-grained one
description: Swap the broad personal GitHub token for a dedicated fine-grained token scoped read-only to the two repos named in the ticket.
status: draft
tags: [tickets, hitd, loop, okf]
generated: { by: opencode-go/deepseek-v4-pro, at: 2026-09-21T19:41:06Z }
sources:
  - id: task
    resource: https://github.com/marcoklein/agent-land-tickets/blob/main/work/alt-x5gr/task.md
    title: Task — replace the loop host's GitHub token
---

# Replace the loop host's GitHub token

## Problem

The server that works this ticket queue reads the state of one pull request through
GitHub's command-line tool. To do that it exports a token that belongs to a human
account and carries that account's broad write permission, so the token can read and
change every repository the account can reach — though the job only ever reads one pull
request's state. The token cannot be narrowed or revoked without disturbing the human's
other tools, so a leak on that server is wide open.

## Decision requested

1. **Swap it in the host config, not in the server.** Replace the token in the loop
   host's personal-infra (`.env`, re-encrypted, and the script that exports it), leaving
   the driver's behaviour unchanged. *Rejected:* moving token handling into the
   agent-land server — it has no scheduler, and in-core orchestration sits outside the
   domain boundary.
2. **Issue a dedicated fine-grained token, read-only.** A new `github_pat_` token that
   only reads pull-request state. *Rejected:* keeping the human's personal `gho_` token,
   which can read and write every repository the account reaches.
3. **Scope it to both repos with the minimum permission.** Read-only "Pull requests" on
   `marcoklein/agent-land` and `marcoklein/agent-land-tickets` (plus GitHub's always-on
   metadata read); drop "Contents" read unless the live `gh pr view` turns out to need
   it. *Rejected:* scoping to `agent-land` alone — the ticket names both repos, and the
   exact minimum is confirmed against the real call at implementation.
