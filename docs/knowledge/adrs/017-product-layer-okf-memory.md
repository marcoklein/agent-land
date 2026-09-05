---
status: accepted
date: 2026-09-05
tags: [product, okf, memory, pipeline, agents]
deciders: [agent]
---

# Build a Product Layer on OKF Memory with an Agentic Pipeline

**Decision:** Maintain product knowledge (goals, features, designs) as an OKF bundle under `docs/knowledge/product/`, and run the product-to-implementation pipeline through opencode skills and subagents with the design review expressed as a PR on the Design note.

**Why:** It raises the human's interaction level from directing edits to stating outcomes and reviewing at gates, and OKF's `status`/`verified` fields already model the review lifecycle, while the pipeline stays outside the engine per the Archon learnings.

**Alternatives considered:** Separate `agent-land-product` repo — rejected because versioning product memory with the code it describes makes PRs double as product review. Extend the `mem` store to OKF — rejected because `mem` is untyped cross-project graph memory, and migrating it is a separate format change. Run the pipeline natively on agent-land from day one — rejected because it is blocked on Platform Connector and Mount; the recipe ports to agent-land sessions later as dogfood.
