---
name: github
description: Interact with GitHub via gh CLI and REST API. Active when GITHUB_TOKEN is set.
---

## gh CLI (preferred)
gh auto-reads GITHUB_TOKEN. No auth needed.
```bash
gh issue view 123 --repo owner/repo
gh pr create --title "fix: ..." --body "..."
gh api /repos/owner/repo/issues --jq '.[].title'
```

## REST API (fallback)
```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/owner/repo/issues
```
