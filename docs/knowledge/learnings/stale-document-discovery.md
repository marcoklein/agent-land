---
type: Reference
title: Stale-document discovery
description: The classes of staleness that accumulate in a knowledge base, and how detection keeps the codebase converging on a cleaner state instead of drifting.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: okf-skill
    resource: /opencode/skills/okf/SKILL.md
    title: OKF skill — lifecycle and suppression rule
---

# Stale-document discovery

Observation: a knowledge base drifts unless staleness is *looked for* mechanically. Every cleanup so far (`design.md`, `ROADMAP.md`, `product-value.md`, `architecture.html`, stale ADRs) was found by hand. To make the codebase converge — each change leaves it as clean as, or cleaner than, it found it — the stale classes must be detected, not noticed.

## The staleness classes

1. **Dead references** — internal links (markdown or OKF `resource:`) that point at a file that no longer exists (moved, renamed, deleted).
2. **Dangling OKF sources** — a frontmatter `resource:` that does not resolve to a real path or URL.
3. **Unreviewed decisions** — ADRs still `status: proposed` long after their consequences shipped (016 and 017 both sat `proposed` while already merged to `main`).
4. **Duplicate provenance** — two artifacts carrying the same knowledge (HTML + markdown, or a loose prose doc + an OKF note). The opposite of the "one home, delete don't tombstone" rule.
5. **Orphan notes** — an OKF note not linked from any `index.md`, so nothing ever reaches it.
6. **Broken index entries** — an `index.md` bullet whose target is missing.

## Detection strategy

Classes 1, 2, 3, 5, 6 are **mechanical** — resolvable by a deterministic lint pass over the bundle: check links and `resource:` targets, age `proposed` ADRs, find unlinked notes, validate index bullets. Class 4 (duplicate provenance) is **semantic** — it needs the "one home" convention, not a regex.

Order: cheap mechanical checks first (links, sources, indexes, orphans), then the aged-`proposed` ADR flag. Each hit remediates per the [OKF suppression rule](/opencode/skills/okf/SKILL.md): deprecate-with-pointer or delete-and-fix-links — never a tombstone banner.

## Why it matters

A knowledge base that converges is one where the iteration that *removes* drift is as routine as the one that adds it. Detection makes that a guarantee instead of a habit: the same classes we cleaned by hand become failures caught in CI, not discoveries during an unrelated edit.
