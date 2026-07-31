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

When a button navigates or triggers an action without form data, prefer `<a role="button">` over `<form><button>`. This ensures consistent styling since Pico renders both identically. For POST actions from a link, use a small JS one-liner that creates and submits a hidden form:

```html
<a href="#" role="button" class="outline destructive" onclick="event.preventDefault();if(confirm('Confirm?')){const f=document.createElement('form');f.method='POST';f.action='/path';document.body.appendChild(f);f.submit();}">Action</a>
```
