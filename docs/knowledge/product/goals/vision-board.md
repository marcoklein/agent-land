---
type: ProductGoal
title: Product vision board
description: The five anchors of product intent — vision, target group, needs, product, business goals — each owned by a single note, as the refine stage's "is it worth building?" counterpart to the domain boundary.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: vision
    resource: /product/goals/product-vision.md
    title: Agent Land product vision
  - id: engine
    resource: /engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: dogfooding
    resource: /dogfooding.md
    title: Dogfooding strategy
---

# Product vision board

The board is a *map*, not a duplicate: each section is summarized in one line and owned by a single note. It answers the refine stage's second question — "is this outcome worth building at all?" — where [the domain boundary](/product/goals/boundaries.md) answers the first ("is it in scope?"). An outcome may pass the boundary and still fail the board; both deviations are surfaced, not absorbed.

| Section | Anchor question | Owner |
|---|---|---|
| [Vision](#vision) | Why does it exist, what's the one-liner? | [product-vision.md](/product/goals/product-vision.md) |
| [Target group](#target-group) | Who is it for, exactly? | (stated here) |
| [Needs](#needs) | What problems must be solved, with which values? | [product-vision.md](/product/goals/product-vision.md) |
| [Product](#product) | What is the thing, in primitives? | [engine.md](/engine.md) |
| [Business goals](#business-goals) | How do we know it's working? | [dogfooding.md](/dogfooding.md) |

## Vision

A self-hosted home for long-lived AI coding agents — durable sessions, sealed secrets, orchestratable workflows, driven from the CLI and a JSON/SSE API.[^vision]

## Target group

A single operator building on their own infrastructure — "mine, controlled, private." No multi-user, no team selling; the platform serves its owner first. This is the only section the board owns outright because it is the load-bearing assumption every other note rests on and nowhere states explicitly.

## Needs

- **Durability** — sessions outlive the laptop.
- **Control & privacy** — my infra, my keys; scoped, sealed credentials per connector.
- **Autonomy with trust** — agents run unattended but pause when it matters.
- **Reusable working patterns** — connectors, skills, roles, recipes.
- **API-first** — everything the CLI does is a `curl` away.[^vision]

## Product

The six primitives — Connector, Provider, Mount, Session, Event Stream, Platform Connector — over Docker, SOPS/Age, and flat JSON. Everything else is composition.[^engine]

## Business goals

Personal value, not revenue. Success is the platform's own velocity: the fraction of agent-land PRs opened by agent-land, the task→green-PR time, red-CI self-recovery, and recurring work that needs no human.[^dogfooding]

[^vision]: [Agent Land product vision](/product/goals/product-vision.md)
[^engine]: [Agent Land engine](/engine.md)
[^dogfooding]: [Dogfooding strategy](/dogfooding.md)
