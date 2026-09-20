---
type: Design
title: Skills out of the agent image
description: Stop shipping the skills folder inside the agent image; deliver it from a host-path mount the loop binds at session creation, keeping vendor knowledge out of the engine.
status: stable
tags: [playbook, mount, loop]
generated: { by: pi/deepseek-v4-pro, at: 2026-09-20T11:50:00Z }
sources:
  - id: engine
    resource: /platform/engine.md
    title: Agent Land engine — the purest form
  - id: adr-016
    resource: /adrs/016-strip-web-ui-and-vendor-knowledge.md
    title: Strip vendor knowledge from the server
  - id: mount
    resource: /product/designs/mount-design.md
    title: Mount — durable named folder
  - id: ticket-layer
    resource: /product/designs/ticket-layer-design.md
    title: Ticket layer
---

# Skills out of the agent image

The agent image ships a folder of instruction files ("skills") that tell the coding agent how to work — the team's own playbook plus connectors for Gmail and Jira. Everyone who deploys this platform gets those files whether they want them or not. That breaks two standing rules: the platform must not carry vendor knowledge (ADR 016), and the agent image should hold only node, pi, git, and curl. Today the skills reach a session only because the image copies them in at build time, so the rules are silently broken by that one line.

The decision: how a session reads its skills once they stop shipping inside the image.

## Decision requested

1. **Move skills to a durable folder bound at the path the agent already reads** (`/tmp/pi-config/skills`) — rejected alternative: leave them baked into the image (keeps vendor knowledge in the image, keeps breaking ADR 016).
2. **Deliver that folder as a host-path mount** (`AGENT_LAND_HOST_MOUNTS=skills:<checkout>/agent-image/skills`) — rejected alternative: a named Docker volume populated once (volumes are created empty and go stale on every skill edit; the host path stays current with the repo, no populate step).
3. **Have the loop bind the mount on every session it spawns** — rejected alternative: make mount binding a default for all sessions (non-loop callers can already self-serve with `--mount`; the loop is the only caller that needs skills by default).

## Approach

- Remove the skills copy from `agent-image/Dockerfile` (line 27, `COPY skills/ /tmp/pi-config/skills/`). The image returns to node + pi + git + curl; its tag changes because the tag is a content hash over the whole `agent-image/` folder.
- Register a `skills` mount (`POST /api/mounts`) and point it at the checkout folder via `AGENT_LAND_HOST_MOUNTS`. The registry entry is required even for a host path — session creation verifies a mount is registered before binding; the host-mounts map only changes where the name points.
- Add one field to the loop's spawn payload in `scripts/loop.sh` (`spawn_agent`): `mounts: [{source:"skills", target:"/tmp/pi-config/skills"}]`.
- The platform writes its own config (`models.json`, `auth.json`) into the parent `/tmp/pi-config`, not into the `skills` subfolder, so the bind does not shadow them. Verified from the provisioner and the bind path.

## Interfaces

- `scripts/loop.sh` — one `mounts` field added to the existing `jq` payload in `spawn_agent`.
- `agent-image/Dockerfile` — one `COPY` line removed.
- Deployment — one env var (`AGENT_LAND_HOST_MOUNTS`) and one registry entry (the `skills` mount).
- No server, contract, or CLI code changes: the mount primitive, session bind, and single-writer guard already exist.

## Risks & mitigations

- **Single-writer:** only one live session may bind a mount at a time. The loop is serial, so dogfood is unaffected, but any concurrent session needing skills is refused. Accept and document; add a read-only shared bind only if a real concurrent need appears.
- **Skills missing mid-migration:** a session spawned after the image loses skills but before the loop binds the mount reads no skills and fails loudly. That failure is the dogfood proof; land the Dockerfile, loop, and mount changes together.
- **Host-path writability:** a host bind exposes the checkout folder read-write to containers. Accept for the loop's own checkout; the single-writer guard still prevents two live binders.
- **Image retag:** removing `skills/` changes the content hash, so the next build is a new image. Expected, not a defect.

## ADR pointers

- [ADR 016](/adrs/016-strip-web-ui-and-vendor-knowledge.md) is the ruling this implements — the image copy re-introduced the vendor knowledge that decision removed.
- [Mount design](/product/designs/mount-design.md) (single-writer, content-agnostic) is the primitive consumed; no new ADR. A new ADR is only needed if the single-writer rule is amended for concurrent read-only binds.

## Change set

**This PR (docs):** this Design note plus an entry in the designs index.

**After the gate:**

- `agent-image/Dockerfile` — remove the `COPY skills/` line.
- `scripts/loop.sh` (agent-land-tickets) — add the `mounts` field to `spawn_agent`.
- Deployment — register the `skills` mount and set `AGENT_LAND_HOST_MOUNTS`.
- Dogfood — this ticket advances through the ladder with skills read from the mount, none in the image.
