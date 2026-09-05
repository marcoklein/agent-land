---
status: accepted
date: 2026-07-31
tags: [ui, styling, css, frontend]
deciders: [marcoklein]
---

# Pico CSS with No Inline Styles

**Decision:** All styling goes through CSS classes defined in `src/views/layout.ejs` and Pico CSS utility classes. No `style="..."` attributes in templates. Custom colors (e.g., red for destructive actions) use Pico CSS variable overrides on named classes.

**Why:** Inline styles scatter visual decisions across templates, make global changes difficult, and bypass Pico's responsive/default behavior. A single `<style>` block in the layout plus descriptive class names makes the styling model visible in one place. Pico's `--pico-*` CSS variables provide spacing, colors, and sizing without hardcoding px values.

**Patterns:**
- Layout classes: `.agent-header`, `.agent-footer`, `.agent-task-pre` — for component layout
- Utility classes: `.destructive` — overrides `--pico-primary` to red for kill/delete buttons
- Grid classes: `.kill-switch-grid` — for form field layouts
- Button variants: Pico's `primary` / `secondary` / `contrast` / `outline` classes
- Status badges: Pico's `pico-color-jade-100` (success), `pico-color-red-100` (error), `pico-color-yellow-100` (killed/warning)
- Use `<a role="button">` instead of `<form><button>` for actions that don't serialize form data — Pico renders both identically

**Rules:** See `.opencode/skills/styling/SKILL.md` for the full style guide.

**Alternatives considered:** Tailwind — rejected because Pico gives us semantic HTML styling with fewer classes and no build step. Classless Pico — rejected because we use Pico's class system (`outline`, `secondary`, `contrast`) and color utility classes (`pico-color-*`) extensively. Inline styles — rejected because they're hard to maintain and override.
