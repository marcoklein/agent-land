---
status: deprecated
date: 2026-07-31
tags: [ui, styling]
deciders: [marcoklein]
---

# Pico CSS with No Inline Styles

> Superseded by [016 — Strip Web UI and Vendor Knowledge](016-strip-web-ui-and-vendor-knowledge.md). Retained for decision history.

**Decision:** All styling via CSS classes and Pico utility classes; no `style="..."` attributes in templates. Custom colors use `--pico-*` CSS variable overrides on named classes, described in `.opencode/skills/styling/SKILL.md`.

**Why:** Inline styles scatter visual decisions and bypass Pico's responsive behavior; a single `<style>` block plus class names keeps the styling model visible in one place.

**Alternatives considered:** Tailwind — rejected: more classes, needs a build step. Classless Pico — rejected: needed `outline`/`secondary`/`contrast` utilities. Inline styles — rejected: hard to maintain and override.