# Designs

Approved technical designs — the handoff from product to implementation. Each design is a PR-reviewed OKF note; merge of the design PR is the approval signal.

* [Mount](mount-design.md) — durable named folder, single-writer invariant, manual cleanup
* [Git identity injection](git-identity-design.md) — server injects `GIT_USER_NAME`/`GIT_USER_EMAIL` so agents commit without being told
