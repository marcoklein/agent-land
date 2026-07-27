# Roadmap

## Provider management

Decouple API keys from environment variables. Add a provider concept in the UI:

- Configure backends (OpenCode Go, OpenAI, etc.) with name, API key, URL, default model
- Keys stored via SOPS encryption alongside connector secrets
- Select provider when launching agents
- Remove `OPENCODE_API_KEY` and related env vars from platform config
