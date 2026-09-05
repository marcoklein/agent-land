---
name: okf
description: Write knowledge documents in OKF (Open Knowledge Format) v0.2. Active when capturing learnings, writing reference docs, or creating files under docs/knowledge/.
---

## Concept template

Every concept is a markdown file with YAML frontmatter:

```yaml
---
type: Reference                    # REQUIRED. Pick a descriptive name.
title: <display name>
description: <one-line summary>
resource: <canonical URI>          # for concepts bound to an underlying asset
tags: [<tag>, ...]
status: draft                      # draft | stable | deprecated. Omit ⇒ stable.
generated: { by: <agent>/<version>, at: YYYY-MM-DDTHH:MM:SSZ }
verified: { by: human:<id>, at: YYYY-MM-DDTHH:MM:SSZ }  # omit if unreviewed
stale_after: YYYY-MM-DD            # omit ⇒ never expires
sources:
  - id: <stable-key>               # for per-claim footnotes: [^key]
    resource: <URL or /path>       #   REQUIRED in each entry
    title: <label>
    author: <actor>                # credibility signal
    usage_count: <number>
    last_modified: YYYY-MM-DD
usage_window: { from: YYYY-MM-DD, to: YYYY-MM-DD }  # frames usage_count
---
```

`type` is the only required field. Add any extra keys — OKF tolerates unknown fields.

## Lifecycle & suppression

`status` carries the lifecycle: `draft` → `stable` → `deprecated`. **Deprecation is the suppression rule — there is no "superseded" banner.** When a note is replaced by newer knowledge, do NOT keep the old note with a `⚠️ Superseded` header or a `status: superseded` flag; instead:

1. Set the old note's `status` to `deprecated` **and** note its replacement inline in one line (e.g. `Superseded by /knowledge/product/goals/product-vision.md`).
2. If the knowledge has no surviving replacement, prefer **deleting the file** outright and updating every inbound link — leaving corrected-at-the-source is cleaner than keeping a tombstone.
3. Update every index and cross-link that pointed at the removed note.

Rationale: a duplicated document drifts and misleads; the `deprecated` status exists to point readers forward, and deletion exists so the knowledge lives in exactly one place.

## Actor rule

Use your own identity for `generated.by`, never the user's. Only set `verified` when a human actually confirmed the content.

`verified` takes a list or a single `{ by, at }` mapping. Consumers treat a bare mapping as one element.

- `human:<id>` — person
- `<tool>/<version>` — agent (you)
- `process:<id>` — automation

## Per-claim attribution

Attribute specific claims to sources using markdown footnotes keyed to `sources[].id`:

```markdown
The models endpoint is public.[^opencode-docs]

[^opencode-docs]: OpenCode API documentation
```

Use stable `id` keys, never positional indexes — agents reorder source lists.

## Index files

Plain markdown, no frontmatter (except bundle root may carry `okf_version: "0.2"`). Reserved: `index.md`, `log.md`.

```markdown
# Section

* [Title](concept.md) — one-line summary from the concept's `description`
* [Subdir](subdir/) — what it covers
```

## Cross-linking

Prefer bundle-relative paths (start with `/`) — they survive file moves. Links are untyped — meaning is in the prose.

```markdown
See [OpenCode API](/knowledge/providers/opencode-api.md) for endpoints.
```

## Where to write

Under `docs/knowledge/`, organized by domain. Create `index.md` in each directory.

```
docs/knowledge/
  index.md
  engine.md
  providers/
    index.md
    opencode-api.md
  learnings/
    index.md
  product/
    index.md
  adrs/
```
