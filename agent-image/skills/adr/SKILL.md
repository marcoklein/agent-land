---
name: adr
description: Write Architecture Decision Records. Active when making architectural decisions.
---

## When to Write an ADR

Record every architectural decision that affects the project's structure, dependencies, or constraints. Write an ADR when you:

- Choose a library, framework, or tool
- Set a convention or pattern
- Decide NOT to do something significant
- Change a previous decision

## Template

Use the minimal template at `docs/knowledge/adrs/template.md`:

```markdown
---
status: proposed
date: YYYY-MM-DD
tags: []
deciders: [agent]
---

# Title (verb-noun format, e.g. "Use SQLite for Storage")

**Decision:** One sentence.

**Why:** One sentence.

**Alternatives considered:** Option A, Option B — rejected because {reason}
```

## Rules

- **Status:** Start as `proposed`. Change to `accepted` once reviewed.
- **Deciders:** Use `[agent]` if you made the decision autonomously. Add human names if they were consulted.
- **Tags:** Use lowercase, kebab-case or single words. Keep it to 2-4 relevant tags.
- **Filename:** `NNN-slug.md` — find the next number by checking `ls docs/knowledge/adrs/`.
- **Decision:** Must be one sentence. Be specific.
- **Why:** Must be one sentence. Focus on the primary reason.
- **Alternatives:** List at least one alternative and why it was rejected.

Write ADRs in `docs/knowledge/adrs/`. Update the status to `accepted` after implementation.
