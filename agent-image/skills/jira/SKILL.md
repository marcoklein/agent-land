---
name: jira
description: Interact with Jira via REST API. Active when JIRA_URL and JIRA_API_TOKEN are set.
---

## Authentication
All requests use Basic auth:
```bash
curl -s -H "Authorization: Basic $(echo -n "email:$JIRA_API_TOKEN" | base64)" \
     -H "Accept: application/json" \
     "$JIRA_URL/rest/api/2/issue/ABC-123"
```

## Common Endpoints
- Get issue: GET /rest/api/2/issue/{key}
- Search: GET /rest/api/2/search?jql=...
- Transitions: GET /rest/api/2/issue/{key}/transitions
- Create issue: POST /rest/api/2/issue
- Add comment: POST /rest/api/2/issue/{key}/comment
- Update fields: PUT /rest/api/2/issue/{key}

Parse responses with `jq`. Use `jq -r` for raw strings.
