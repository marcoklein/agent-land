---
status: accepted
date: 2026-07-27
tags: [agent, tools, docker]
deciders: [marcoklein]
---

# Pre-Baked Tools + Runtime Installation

**Decision:** Ship git, curl, jq, and gh in the agent image. The agent installs everything else at runtime via apt/npm/pip.

**Why:** These four tools cover 95% of coding agent tasks. Keeping the base image small while allowing unrestricted runtime installation gives the agent maximum flexibility without bloating the image.

**Alternatives considered:** Full dev image with all tools, Nix-based environment — rejected because full images are large and slow to build; Nix adds complexity for a simple Docker setup.
