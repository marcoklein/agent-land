---
status: accepted
date: 2026-07-27
tags: [secrets, security]
deciders: [marcoklein]
---

# SOPS/Age Encryption for Secrets

**Decision:** Encrypt secrets at rest with SOPS/Age, one YAML file per connector. Decrypt in-memory only at agent launch time.

**Why:** Age keys are simple to generate and manage. SOPS integrates with YAML natively. No cloud KMS dependency. Decrypted values exist only as env vars inside the agent container, never on disk.

**Alternatives considered:** HashiCorp Vault, AWS Secrets Manager, `.env` files — rejected because overkill for a single-user tool; plain `.env` offers no encryption at rest.
