---
type: Reference
title: Agent image staleness on deploy
description: The deployed host keeps the agent image it built once; skill and image changes merge and deploy but never reach sessions until the host image is rebuilt.
status: draft
generated: { by: opencode/deepseek-v4-pro, at: 2026-09-05T00:00:00Z }
sources:
  - id: docker
    resource: packages/server/src/infra/docker.ts
    title: DockerService.ensureAgentImage
  - id: dockerfile
    resource: Dockerfile
    title: Root Dockerfile — bundles /agent-image into the platform image
---

# Agent image staleness on deploy

`ensureAgentImage`[^docker] builds `/agent-image` **only when the tag is absent** (`inspect` → 404). The platform image ships the agent-image source (`COPY agent-image/ /agent-image/`)[^dockerfile], so every deploy carries updated skills and Dockerfile — but a host that already built `agent-land-pi:latest` once never rebuilds it.

**Consequence:** PR #46 (dev-playbook skill) and this change (product/okf/adr skills) reach the host's `/agent-image` directory but **not** the running sessions — they launch from the stale image until it is rebuilt.

**Candidate fix (future feature):** stamp built images with a content hash of `/agent-image` (label), and have `ensureAgentImage` rebuild when the label mismatches. Until then, updating skills or the agent Dockerfile on a deployed host requires manually removing the old image (host access).

**Confirmed in practice (2026-09-05):** the first on-platform implementation run had to carry its dev-playbook inline in the prompt — the session launched from an image built before the skills were bundled, so `dev-playbook`/`product`/`okf`/`adr` were not present in it. Until the rebuild fix lands, treat image-bundled skills as absent on deployed hosts and inline any playbook the prompt depends on.

[^docker]: `packages/server/src/infra/docker.ts`, `ensureAgentImage()`
[^dockerfile]: `Dockerfile`, runtime stage
