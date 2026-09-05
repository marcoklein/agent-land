# Agent Land — Product & Value

> ⚠️ **Superseded.** This page predates the #38 strip of the web UI and vendor knowledge, and has been superseded by the OKF [product vision](reference/product/goals/product-vision.md), [domain boundary](reference/product/goals/boundaries.md), and [product pipeline](reference/product/pipeline.md). Kept only to avoid breaking historical references; treat the OKF notes as authoritative.

**One-liner:** Agent Land is my self-hosted home for AI coding agents — long-lived sessions on my server, encrypted secrets, and step by step, orchestratable workflows I can trigger by hand or on a schedule.

## Why Agent Land exists

I like personal, local-first agent tools — pi, and tickets/beads-style workbenches. They're powerful and they're mine. But they share one constraint: they live in a terminal on my laptop. A long task dies with the tmux session; a multi-hour plan-and-research run means keeping a laptop awake and a pane open; recurring chores (release notes!) need me to remember to start them.

Agent Land keeps the spirit — mine, controlled, private — but moves the work onto my server:

- sessions persist independently of my laptop,
- I reach them from a browser, anywhere,
- secrets are handled properly (SOPS/Age — encrypted at rest, decrypted only at launch),
- and the things I do repeatedly become workflows I can trigger — soon, even on a schedule.

## Value

1. **Durability.** Start it Friday, look at it Monday. The server keeps sessions alive; I don't have to.
2. **Control & privacy.** My infrastructure, my keys, my data. No agent platform sits between me and the LLM; connectors hand agents scoped credentials that are encrypted at rest.
3. **Autonomy with trust.** Agents run unattended (auto policy), but pause and ask when it matters — dialogs, approval gates, mid-run steering. Not babysitting; seatbelts.
4. **Reusable working patterns.** Connectors, skills, and role templates encode how I work once; workflows compose them into repeatable processes.
5. **Browser + API.** One dashboard to launch, watch, steer, and kill — and the same operations as a JSON API for scripting.

## Use cases

### 1. Release notes, every Friday — by themselves

> As a user, I want my release-notes skill to run automatically every Friday, so I always have fresh notes for the client project without remembering to start anything.

- I add a skill to the client repo that generates release notes.
- I define it once in Agent Land as a scheduled workflow: Friday 16:00 (cron), or "run now" when I need it early.
- The agent runs in its own container with the github connector and produces the notes.
- The result shows up in Agent Land — I copy it wherever it goes.

### 2. Weekend planning sprint — no tmux required

> As a user, I want to kick off a multi-step planning task on Friday evening and find a complete plan and spec in a fresh branch on Monday — without keeping a terminal open all weekend.

- I start the workflow: task → question → research → branch.
- The agent asks its clarifying questions up front; the ones I don't answer are recorded as assumptions and it proceeds.
- It researches, drafts the plan and spec, and pushes a new branch containing both.
- I review the result at a gate — approve, or send it back with feedback.

### 3. Steered sidekick

> As a user, I want a long-lived agent session I can chat with from the browser — streaming its work live and asking before risky actions.

- Works today: launch a session with connectors, watch live output over SSE, steer, kill. (In-browser follow-up chat is the next UI step.)

## Today vs roadmap

**Today** — long-lived sessions (pi `--mode rpc` in Docker), SOPS/Age-encrypted connectors (github, jira, gmail), live streaming, REST + SSE API, browser UI.

**Next (designed)** — orchestration: role templates, workflows with routing/retries/gates, agent→agent channel, shared workspace, workflow UI.

**Then** — scheduled workflows (cron) for the release-notes pattern, and whatever the weekend sprints teach us.

## Principles

- **Mine.** Self-hosted; the only external dependency is the LLM provider.
- **Secrets stay sealed.** Encrypted at rest; decrypted in-memory, only at launch, only for the connectors the session needs.
- **Sessions first.** Orchestration composes sessions — it doesn't replace them.
- **Ask when it matters.** Human-in-the-loop is a designed state, not an interruption.
- **API-first.** Everything in the UI is also a curl away.
