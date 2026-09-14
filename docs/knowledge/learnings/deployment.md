---
type: Reference
title: Deployment gotchas (Dokku + SOPS)
description: Build-time and host-setup bugs hit while deploying agent-land to a Dokku host, and their fixes.
status: stable
generated: { by: opencode/deepseek-v4-pro, at: 2026-08-23T00:00:00Z }
verified: { by: human:marcoklein, at: 2026-09-01T00:00:00Z }
sources:
  - id: sops-service
    resource: packages/server/src/infra/sops.ts
    title: SOPS encrypt/decrypt implementation
  - id: dockerfile
    resource: Dockerfile
    title: Orchestrator runtime image
  - id: dockerfile-web
    resource: Dockerfile.web
    title: Web UI runtime image
  - id: deploy-workflow
    resource: .github/workflows/deploy.yml
    title: Dokku deploy workflow
  - id: adr-018
    resource: /adrs/018-web-ui-separate-consumer.md
    title: Web UI as separate consumer package
---

# SOPS

- **Alpine SOPS can't read from stdin.** `sops --encrypt` on the Alpine runtime image doesn't accept piped stdin, so `SopsService.encrypt` writes the plaintext to a temp file (mode `0600`), passes the path, then unlinks it.[^sops-service]
- **Age recipient regex must tolerate YAML block scalars.** The `.sops.yaml` age line may wrap the key in a `>` block scalar. `extractAgePublicKey` makes the `>` optional (`(?:>[-|]?\s*)?`).[^sops-service]

# Build & runtime image

- **Alpine images don't ship the `docker` CLI.** The orchestrator mounts the host docker socket to spawn sibling agent containers, so the runtime image installs it explicitly (`apk add --no-cache sops age docker`).[^dockerfile]

# Dokku host setup

One-time, manual on the host (not in this repo):

- **Port mapping.** Dokku auto-detects `https:3000:3000`; the app listens on HTTP only, so set the proxy to `http:80:3000`.
- **HTTP basic auth plugin.** After `dokku http-auth:enable`, `http-auth.conf` is created empty; the auth directives must be written manually.
- **SSL.** `dokku letsencrypt:enable` can succeed while the nginx SSL config is missing; re-running regenerates it.
- **Deploy must be a full clone.** CI pushes to Dokku with `fetch-depth: 0` (shallow clones are rejected).[^deploy-workflow]
- **Deploy lock.** If Dokku is mid-deploy, git push fails. CI retries for 10 min with `sleep 20` between attempts.[^deploy-workflow]
- **Multi-Dockerfile repos.** When an app needs a non-default Dockerfile (e.g. `Dockerfile.web`), use `dokku builder-dockerfile:set <app> dockerfile-path Dockerfile.web`. The env var `DOKKU_DOCKERFILE_PATH` is silently ignored — Dokku only reads the `dockerfile-path` property.[^adr-018]
- **nginx.conf permissions.** Dokku generates `/home/dokku/<app>/nginx.conf` with mode `0600` (owner-only). The system nginx worker runs as `www-data`, so it can't read the file — resulting in a silent fallback to the nginx welcome page. Fix: `usermod -aG dokku www-data` (then `chmod 644` + `nginx -s reload` once; group membership survives config rebuilds).
- **http-auth.conf emptiness.** After `dokku http-auth:enable` with an existing user, the `nginx.conf.d/http-auth.conf` may be generated empty. Write `auth_basic` and `auth_basic_user_file` directives directly into that file, then `chmod 644` the nginx.conf and reload.[^adr-018]

[^sops-service]: SOPS encrypt/decrypt implementation
[^dockerfile]: Orchestrator runtime image
[^dockerfile-web]: Web UI runtime image
[^deploy-workflow]: Dokku deploy workflow
[^adr-018]: Web UI as separate consumer package
