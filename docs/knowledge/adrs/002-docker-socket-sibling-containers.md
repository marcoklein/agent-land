---
status: accepted
date: 2026-07-27
tags: [docker, infrastructure]
deciders: [marcoklein]
---

# Docker Socket Mount Instead of Docker-in-Docker

**Decision:** Mount `/var/run/docker.sock` into the orchestrator container to spawn sibling containers.

**Why:** Simpler than DinD — no nested Docker daemon, shared image cache, straightforward networking. Required for Dokku deployment.

**Alternatives considered:** Docker-in-Docker, Kubernetes pods — rejected because DinD adds complexity and K8s is overkill for a single-server personal tool.
