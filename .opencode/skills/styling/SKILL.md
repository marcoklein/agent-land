---
name: styling
description: Guidelines for styling and UI in this project. Active when editing EJS templates, CSS, or visual presentation.
---

## CSS Framework

This project uses [Pico CSS](https://picocss.com) v2 (full version, ~83KB, not classless). Loaded in `src/views/layout.ejs` via `<link rel="stylesheet" href="/pico.min.css">`.

Pico provides semantic HTML styling out of the box — `<button>`, `<a role="button">`, `<table>`, `<details>`, `<mark>`, etc. all render correctly without additional classes.

## Rules

### No inline styles

Never use `style="..."` attributes on elements. Define classes in `src/views/layout.ejs` `<style>` block instead. Pico's `--pico-*` CSS variables give you spacing, colors, and sizing without hardcoding.

Use: `<footer class="agent-footer">`
Not: `<footer style="margin-top:16px; display:flex; gap:12px">`

### Use Pico utility classes for colors

For status badges, use Pico's preset background color classes:

| Status | Class |
|--------|-------|
| running | _(none — default Pico `<mark>`)_ |
| completed / success | `pico-color-jade-100` |
| failed / error | `pico-color-red-100` |
| killed / warning | `pico-color-yellow-100` |

Add color classes to the `layout.ejs` `<style>` block only.

### Use Pico's spacing system

Gaps and margins should use `var(--pico-spacing)` or CSS `gap` instead of hardcoded px values.

### Button variants

Three Pico variants via classes:
- `<button>` — primary (default, no class needed)
- `<button class="secondary">` — secondary
- `<button class="contrast">` — contrast
- `<a role="button">` — link styled as button
- `<button class="outline">` — outline variant

### Destructive / red button

Use the `.destructive` class (defined in `layout.ejs`). It overrides `--pico-primary` to red. Works with any button variant:

```html
<button class="outline destructive">Delete</button>
<a href="#" role="button" class="outline destructive">Kill</a>
```

### Define reusable classes in layout.ejs

New CSS classes go in `src/views/layout.ejs` within the existing `<style>` block. Name classes with `agent-` prefix for agent-specific layout classes (e.g., `agent-header`, `agent-footer`). Use descriptive names for utility classes (e.g., `destructive`, `kill-switch-grid`).

### Use `<a>` for button links

When a button navigates or triggers an action without form data, prefer `<a role="button">` over `<form><button>`. Pico renders both identically. For POST/DELETE actions, use HTMX attributes — no inline JavaScript:

```html
<a href="#" role="button" class="outline destructive"
   hx-post="/agents/:id/kill"
   hx-confirm="Kill this agent?">Kill Agent</a>
```

## HTMX v4 Patterns

### SSE extension syntax

The v4 SSE extension uses namespaced attributes, not the old `hx-sse="connect:... swap:... close:..."` single-attribute format:

| Concern | Attribute |
|---------|-----------|
| Connection URL | `hx-sse:connect="/path"` |
| Swap strategy | `hx-swap="beforeend"` or `hx-swap="afterbegin"` |
| Close on event | `hx-sse:close="event-name"` |

Unnamed SSE messages are auto-swapped into the element. Named SSE events are dispatched as DOM events (use `hx-trigger="event-name from:#source"` to react).

### Card refresh pattern

When server state changes and the client needs a full re-render, trigger `hx-get` on the parent element. The server detects `hx-request` header and returns just the partial (no layout wrapper):

```html
<article hx-get="/resource/:id"
         hx-trigger="done-event from:#child"
         hx-swap="outerHTML">
```

```typescript
if (req.headers["hx-request"]) return res.render("view", data);
res.render("layout", { view: "view", ...data });
```

### Polling

Use `hx-trigger="every Ns"` on a `<span>` for lightweight stats polling. The endpoint returns just the inner HTML fragment.

## Vendor Assets

Vendor JS/CSS is pinned and downloaded via `scripts/vendor-assets.sh`. Versions live at the top of the script. Both minified and non-minified variants are kept in `public/` — layout.ejs loads the minified versions.

- HTMX v4 (htmx.min.js + hx-sse.min.js) from `htmx.org@4.0.0-beta6`
- Pico CSS (pico.min.css) from `@picocss/pico@2.1.1`

See also: [ADR-013: Real-Time Agent UI with HTMX v4 SSE](../../docs/adrs/013-real-time-agent-ui-htmx4-sse.md)
