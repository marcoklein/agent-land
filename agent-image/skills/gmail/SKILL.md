---
name: gmail
description: Interact with Gmail via REST API. Active when GMAIL_REFRESH_TOKEN is set.
---

Install gmcli for email access:
```bash
npm install -g @mariozechner/gmcli
```

Or use curl for direct API access:
```bash
# Get access token
TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GMAIL_CLIENT_ID&client_secret=$GMAIL_CLIENT_SECRET&refresh_token=$GMAIL_REFRESH_TOKEN&grant_type=refresh_token" \
  | jq -r .access_token)

# Search emails
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject:urgent"
```
