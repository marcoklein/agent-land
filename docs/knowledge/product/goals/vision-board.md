---
type: ProductGoal
title: Product vision board
description: The five anchors of product intent — vision, target group, needs, product, business goals — each owned by a single note, as the refine stage's "is it worth building?" counterpart to the domain boundary.
status: draft
generated: { by: opencode/qwen3.8-max, at: 2026-09-13T00:00:00Z }
sources:
  - id: vision
    resource: /product/goals/product-vision.md
    title: Agent Land product vision
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: boundary
    resource: /product/goals/boundaries.md
    title: Agent Land domain boundary
  - id: dogfooding
    resource: /playbook/dogfooding.md
    title: Dogfooding strategy
---

# Product vision board

The board is a *map*, not a duplicate: each section is summarized in one line and owned by a single note. It answers the refine stage's second question — "is this outcome worth building at all?" — where [the domain boundary](/product/goals/boundaries.md) answers the first ("is it in scope?"). An outcome may pass the boundary and still fail the board; both deviations are surfaced, not absorbed.

One honest note: the board itself is part of the agent-land playbook (OKF product memory) — it maps intent *for* the engine while living *above* it, like everything else in this directory.

| Section | Anchor question | Owner |
|---|---|---|
| [Vision](#vision) | Why does it exist, what's the one-liner? | [product-vision.md](/product/goals/product-vision.md) |
| [Target group](#target-group) | Who is it for, exactly? | (stated here) |
| [Needs](#needs) | What problems must be solved, with which values? | [product-vision.md](/product/goals/product-vision.md) |
| [Product](#product) | What is the thing, in primitives? | [engine.md](/platform/engine.md) |
| [Business goals](#business-goals) | How do we know it's working? | [dogfooding.md](/playbook/dogfooding.md) |

## Vision

The vim of agentic platforms: an easy-to-deploy engine that runs isolated agent sessions on your own server — playbooks decide how. The same engine prepares your day and builds the feature; you state outcomes, review at gates, and the work outlives your laptop.[^vision]

## Target group

A single operator building on their own infrastructure — "mine, controlled, private." No multi-user, no team selling; the platform serves its owner first. This is the only section the board owns outright because it is the load-bearing assumption every other note rests on and nowhere states explicitly.

## Needs

- **Durability** — sessions outlive the laptop.
- **Control & privacy** — my infra, my keys; scoped, sealed credentials per connector.
- **Autonomy with trust** — agents run unattended but pause when it matters.
- **Your way of working, encoded** — playbooks bundle skills, recipes, policies, and gates.
- **API-first** — everything the CLI does is a `curl` away.[^vision]

## Product

The six primitives — Connector, Provider, Mount, Session, Event Stream, Platform Connector — over Docker, SOPS/Age, and flat JSON. The engine runs agents; everything above it is composition.[^engine]

## Business goals

Personal value, not revenue. Success is the agent-land playbook working: the fraction of agent-land PRs opened by agent-land, the task→green-PR time, red-CI self-recovery, recurring work that needs no human — and an operator whose day is intake plus gate review, nothing else.[^dogfooding]

[^vision]: [Agent Land product vision](/product/goals/product-vision.md)
[^engine]: [Agent Land engine](/platform/engine.md)
[^dogfooding]: [Dogfooding strategy](/playbook/dogfooding.md)
