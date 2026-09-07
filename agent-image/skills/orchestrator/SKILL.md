---
name: orchestrator
description: Run the planner orchestrator recipe — compose a per-task stage graph from policy, validate it, post it as a plan gate (Gate 0), then execute it as child sessions over the platform JSON/SSE API. Active when AGENT_LAND_URL and AGENT_LAND_BASIC_AUTH are set and the task is to run the pipeline on a pipeline-ready issue.
---

# orchestrator — planner (Phase 4)

You are a **platform-enabled planner session**. The platform injects `AGENT_LAND_URL` (base URL, no trailing slash) and `AGENT_LAND_BASIC_AUTH` (`session-<id>:<token>`). You drive the [product pipeline](/docs/knowledge/product/pipeline.md) for one issue — but unlike the old fixed recipe (`research → refine → design → critic`), you **plan per task**: you compose a stage graph from the policy, the human approves it at **Gate 0**, then you execute it as child sessions.

Read the underlying API skill first: `agent-image/skills/agent-land-api/SKILL.md`. This skill adds the planner discipline on top of it.

## Files next to this SKILL.md

| File | What it is |
|---|---|
| `policy.yaml` | The policy: stage kinds, per-stage budgets/retries/models, the decision axes, the invariants. **You may not invent anything not declared here.** |
| `plan.schema.json` | The human-readable plan.json contract. |
| `plan.mjs` | Dependency-free validator + aggregate budget calculator. Runs with plain `node`. |

Locate `plan.mjs` once at the start (in the pi image it sits next to this SKILL.md):

```bash
PLAN_MJS="$(ls /tmp/pi-config/skills/orchestrator/plan.mjs 2>/dev/null \
  || find / -name plan.mjs -path '*orchestrator*' 2>/dev/null | head -1)"
```

## The three phases

1. **Plan** — read the issue and the policy, compose `plan.json`, validate it (`plan.mjs`), post it to the issue as a fenced JSON comment, and park at **Gate 0**. No child is spawned before the human clears this gate.
2. **Execute** — realize each stage as a child session over the loopback, passing `model`/`provider`/`connectors`/`mounts` from the plan. Watch, collect, account usage, retry per policy, delete children and per-child mounts.
3. **Gate** — the three human gates (outcome, design, merge) as `waiting_for_input` parks. You may reorder or reshape stages around them, but **never remove, merge, or bypass a gate**.

## Preconditions

- `AGENT_LAND_URL` and `AGENT_LAND_BASIC_AUTH` are set (you are platform-enabled).
- A `github` connector exists on the platform (provides `GITHUB_TOKEN`, `GIT_USER_NAME`, `GIT_USER_EMAIL`).
- A Mount holding a git checkout of the repo exists on the platform for sequential stages. Name it `agent-land` in this recipe; replace with the real mount name if different.
- If the plan includes a `critic` stage, a read-only `github-ro` connector must exist (see Preflight).

Derive your own session id once at the start:

```bash
MY_SESSION_ID="${AGENT_LAND_BASIC_AUTH%%:*}"
MY_SESSION_ID="${MY_SESSION_ID#session-}"
```

## The Mount invariant — read first

The server **hard-enforces at most one live session per Mount**. A session-create request that binds a Mount already bound by any non-`stopped` session fails with:

```
Mount "agent-land" is bound by a live session; stop it first.
```

Three consequences you must obey:

1. **You must not bind the repo Mount yourself.** You coordinate via `gh` and the JSON/SSE API only; the checkout belongs to whichever stage child is active.
2. **Sequential stages** bind the shared repo Mount one child at a time; each child is fully done and `DELETE`d before the next child is created (a settled child still holds the Mount).
3. **Parallel stages** each get their own uniquely named Mount `agent-land-<stage>-<runId>`, created with `POST /api/mounts` before spawn and removed with `DELETE /api/mounts/<name>` after that child settles. **Never** a shared live `.git` across parallel children — each child clones the repo into its own Mount.

## Preflight (once per run)

```bash
# You need gh. In the agent image gh does not pick up GITHUB_TOKEN automatically —
# export GH_TOKEN first. Never run `gh auth login`.
export GH_TOKEN="$GITHUB_TOKEN"
gh auth status

# Confirm the mounts and capture exact names:
curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/mounts" | jq -r '.mounts[].name'

# Confirm the connectors and capture EXACT names — connectors resolve by exact
# name, so a guess would silently match nothing:
GH_CONNECTOR="$(curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/connectors" \
  | jq -er '[.connectors[] | select(.envKeys | index("GITHUB_TOKEN")) | .name][0]')"
GH_RO_CONNECTOR="$(curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/connectors" \
  | jq -r '[.connectors[] | select(.name == "github-ro") | .name][0] // empty')"
echo "GitHub connector: $GH_CONNECTOR"
echo "Read-only connector: ${GH_RO_CONNECTOR:-MISSING (critic stage will need it)}"

# Model preflight: resolve every policy-named provider/model once per run.
# Fallback ladder when a policy-named model/provider is absent:
#   1. that provider's defaultModel   2. the platform DEFAULT_PROVIDER_ID + server defaultModel
# If even the default is unavailable, escalate (park) — never spawn blind.
# Post a one-line issue note recording every substitution.
curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/providers" > /tmp/providers.json
curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/models" > /tmp/models.json
```

If the Mount is missing, report that the operator must create it (`al mounts add agent-land`) and stop. If the Mount is not yet seeded with a checkout, the first stage that binds it seeds it (see its prompt).

## Child lifecycle — the one loop

The whole execute phase is this loop repeated per stage. Paste once at the top of your session.

```bash
MY_SESSION_ID="${AGENT_LAND_BASIC_AUTH%%:*}"
MY_SESSION_ID="${MY_SESSION_ID#session-}"

REPO_OWNER="marcoklein"
REPO_NAME="agent-land"
REPO="$REPO_OWNER/$REPO_NAME"
MOUNT_NAME="agent-land"           # the shared Mount for sequential stages
MOUNT_TARGET="/data/agent-land"   # path the child binds it at

# Build the create JSON with jq -n — never with string concatenation. Unknown
# connector/mount names resolve to NO env silently; pass only what the stage needs.
spawn_child() {
  child_json="$1"   # full JSON body, already assembled per stage
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X POST "$AGENT_LAND_URL/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "$child_json" | jq -r '.session.id'
}

# Assemble a child body from a stage entry of the plan (model/provider per stage).
stage_to_child_json() {
  stage_json="$1"; mount_json="$2"
  echo "$stage_json" | jq -c \
    --arg p "$MY_SESSION_ID" \
    --argjson mounts "$mount_json" \
    '{ connectors: .connectors, model: .model, provider: .provider,
       mounts: $mounts, platform: false, parentSessionId: $p }'
}

prompt_child() {
  child_id="$1"; message="$2"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X POST "$AGENT_LAND_URL/api/sessions/$child_id/prompt" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg m "$message" '{message: $m}')"
}

# GOTCHA: use the NON-live events endpoint (no ?live=1). The bare endpoint
# replays the persisted log FIRST (so a child that settled before you attached is
# still captured — live=1 replays nothing and a fast child's result is lost), then
# keeps streaming. It does not close on agent_settled, so never wait for EOF:
# capture in the background, poll the file for the marker, then kill curl.
watch_child() {
  child_id="$1"; out="/tmp/${child_id}.sse"
  : > "$out"
  curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
    "$AGENT_LAND_URL/api/sessions/$child_id/events" >> "$out" 2>/dev/null &
  local curl_pid=$!
  while kill -0 "$curl_pid" 2>/dev/null; do
    if grep -q '"type":"agent_settled"' "$out" || grep -q '"status":"stopped"' "$out"; then
      break
    fi
    sleep 5
  done
  kill "$curl_pid" 2>/dev/null
  wait "$curl_pid" 2>/dev/null || true
}

# Extract the last assistant message from the captured SSE frames.
collect_result() {
  child_id="$1"
  jq -R -s -r '
    [ split("\n")[]
      | select(startswith("data: ")) | .[6:] | fromjson?
      | select(.type == "message_end")
      | (.message.content
          | if type == "string" then .
            elif type == "array" then [.[] | .text? // empty] | join("\n")
            else empty end)
    ] | .[-1]
  ' "/tmp/${child_id}.sse"
}

# Sum actual usage across the child's message_end frames.
# pi emits usage as message.usage.totalTokens / message.usage.cost.total;
# if it is absent the returned numbers are 0 — budgets then degrade to
# wall-clock only (the ADR 011 stated limitation).
collect_usage() {
  child_id="$1"
  jq -R -s -r '
    [ split("\n")[]
      | select(startswith("data: ")) | .[6:] | fromjson?
      | select(.type == "message_end")
      | (.message.usage // {}) ]
    | { totalTokens: ([.[].totalTokens // 0] | add),
        cost:       ([.[].cost.total // 0] | add) }
  ' "/tmp/${child_id}.sse"
}

delete_child() {
  child_id="$1"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X DELETE "$AGENT_LAND_URL/api/sessions/$child_id"
}

# Parallel-only: create a uniquely named full-clone Mount for one child.
create_parallel_mount() {
  mount_name="$1"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X POST "$AGENT_LAND_URL/api/mounts" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg n "$mount_name" '{name: $n}')"
}

# Parallel-only: delete the per-child Mount after its child settles (GC).
delete_parallel_mount() {
  mount_name="$1"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X DELETE "$AGENT_LAND_URL/api/mounts/$mount_name"
}
```

The stream is SSE frames (`data: {…}` lines, not bare JSON), so the `data: ` prefix is stripped before `fromjson`. The `while` loop exits the moment the settle marker arrives, which tears down the pipeline — you never wait for EOF.

## Phase 1 — Plan

### Intake

Read the issue and verify the label. Always pass `--repo` — you have no local checkout, so `gh` cannot infer a repo.

```bash
ISSUE_N=55   # or as given in "run the pipeline on issue #N"

gh issue view "$ISSUE_N" --repo "$REPO" --json number,title,body,labels,state > /tmp/issue.json

# Hard requirement: the issue must be labeled pipeline-ready.
jq -e '.labels[].name == "pipeline-ready"' /tmp/issue.json >/dev/null || {
  gh issue comment "$ISSUE_N" --repo "$REPO" \
    --body "Orchestrator: issue #$ISSUE_N is not labeled \`pipeline-ready\`; not starting."
  echo "issue not pipeline-ready — parked"
  exit 0
}
```

### Compose the plan

Read `policy.yaml` and compose `plan.json` per its declarations:

- **Stage kinds** come only from the policy: `research`, `refine`, `design`, `critic`, `implement`. You never invent a kind.
- **Decisions** are limited to the policy's `decisions` axes — `skip-research`, `deepen-research`, `parallel` — each with trigger conditions, forbid lists, and effects. Record every deviation in the plan's `deviations` array with the reason.
- **Parallel fan-out** is for implementation concerns only (never refine/design), `maxFanOut: 3`, non-overlapping concerns, and each parallel child gets its own Mount `agent-land-<stage>-<runId>`.
- **Budgets** come from the policy's per-stage entries. `maxAttempts` is TOTAL attempts (1 initial + retries).
- **Gates**: declare the gates this run crosses in `gates` (always including `plan`). Every gate-producing stage sets `leadsToGate`; the plan validator rejects any graph that removes or bypasses a gate.

### Validate, then post Gate 0

```bash
jq . /tmp/plan.json >/dev/null          # it is valid JSON
node "$PLAN_MJS" validate < /tmp/plan.json
node "$PLAN_MJS" budget < /tmp/plan.json   # compare against policy runBudget

gh issue comment "$ISSUE_N" --repo "$REPO" --body "$(cat <<EOF
## Plan (Gate 0)

\`\`\`json
$(cat /tmp/plan.json)
\`\`\`

Deviations from the default pipeline: <summarize plan.deviations, or "none">.
Aggregate budget: <budget output> (policy ceiling: <runBudget from policy.yaml>).
EOF
)"
```

Your final message at Gate 0 (end the turn — no children yet):

> Plan posted on issue #N. Reply **`approved`** to execute, or **`feedback: <notes>`** to amend the plan.

On the next human prompt: **`approved`** → execute; **`feedback:`** → amend the plan, re-validate, re-post, park at Gate 0 again. Never treat anything else as a gate outcome.

## Phase 2 — Execute

Walk the stages in topological order (the `edges` in the plan). Stages in the same `parallelGroup` spawn together, each with its own Mount.

Per stage:

1. **Budget gate.** Compare actual spend so far (tracked in `/tmp/run-state.json`) against the aggregate budget: if `spent + worst-case(this stage) > remaining`, fall back to the policy's cheaper model ladder or escalate (park) — never spawn blind.
2. **Spawn.** Sequential stage → `stage_to_child_json` with the shared Mount. Parallel stage → first `create_parallel_mount "agent-land-<stage>-<runId>"`, then spawn with `mounts: [{source: "agent-land-<stage>-<runId>", target: /data/agent-land}]`.
3. **Prompt** the child with the stage prompt (the *content* you compose — embed the issue body, research brief, prior stage outputs, and the stage role from the policy).
4. **Watch** until settled; **collect** result and usage; add actuals to the run state; append a trace record `{stage, childId, provider, model, budgetUsed, result, deletedAt}`.
5. **Delete** the child; for parallel stages also `delete_parallel_mount` (a finally/cleanup step — never let a full-clone volume orphan).
6. Post **one** progress comment per stage transition.
7. **Verify against the deliverable** — a stage is done when its artifact exists (PR open, CI green), never merely because `agent_settled` fired.

### Stage prompts — the content you decide

The compose-and-run pattern (sequential stage, shared Mount):

```bash
ISSUE_BODY="$(jq -r '.body' /tmp/issue.json)"
STAGE="$(jq -c '.stages[] | select(.id=="refine")' /tmp/plan.json)"

REFINE_PROMPT="$(cat <<EOF
You are the refine stage of the agent-land product pipeline, working on issue #$ISSUE_N.

Working directory: $MOUNT_TARGET (a mounted git checkout of $REPO).

Step 0 — sync and set identity:
  cd $MOUNT_TARGET && git fetch origin && git checkout main && git reset --hard origin/main
  git config user.name "\$GIT_USER_NAME"
  git config user.email "\$GIT_USER_EMAIL"
  export GH_TOKEN="\$GITHUB_TOKEN"

Step 1 — branch, write the Feature note, push, and open the spec PR (see the okf and product skills).

Issue body:
$ISSUE_BODY

Report as your final message, in this order:
- SPEC_PR_URL / SPEC_PR_NUMBER / SUMMARY
EOF
)"

MOUND="$(jq -n --arg m "$MOUNT_NAME" --arg t "$MOUNT_TARGET" '[{source:$m, target:$t}]')"
child_id="$(spawn_child "$(stage_to_child_json "$STAGE" "$MOUND")")"
prompt_child "$child_id" "$REFINE_PROMPT" >/dev/null
watch_child "$child_id"
collect_result "$child_id" | tee /tmp/refine.result
collect_usage "$child_id" | tee /tmp/refine.usage
delete_child "$child_id" >/dev/null
```

Parallel stage (per-child Mount, unique name):

```bash
RUN_ID="$(jq -r '.runId' /tmp/plan.json)"
PG_MOUNT="agent-land-implement-a-$RUN_ID"
create_parallel_mount "$PG_MOUNT"
STAGE="$(jq -c '.stages[] | select(.id=="implement-a")' /tmp/plan.json)"
MOUND="$(jq -n --arg m "$PG_MOUNT" --arg t "/data/agent-land" '[{source:$m, target:$t}]')"
child_id="$(spawn_child "$(stage_to_child_json "$STAGE" "$MOUND")")"
prompt_child "$child_id" "<implementation prompt: clone into its own Mount, branch, dev loop, PR>" >/dev/null
watch_child "$child_id"
collect_result "$child_id" | tee /tmp/implement-a.result
collect_usage "$child_id" | tee /tmp/implement-a.usage
delete_child "$child_id" >/dev/null
delete_parallel_mount "$PG_MOUNT"     # GC — do not skip
```

Each parallel child's step 0 clones the repo into its own Mount (`git clone` into `$MOUNT_TARGET`), works on its own branch, and pushes it; reconciliation is via PRs to `main` — never a shared live `.git`.

### Retry policy (from policy.yaml)

- **Failure** (settled but output missing/invalid, or PR not opened, CI red) → **retry with an adjusted prompt**: a fresh child on the same stage, with the previous attempt's final report and the specific failure reason appended ("attempt 1 failed because X; fix X specifically").
- **Stall** (child exceeds its per-stage time budget or hangs) → **DELETE the stalled child first**, then re-prompt with numbered steps and a smaller scope.
- **Escalate-to-human** (attempt budget or aggregate budget exhausted) → post the collected stage outputs to the issue and park at the relevant gate, asking the human to re-instruct or abort. Escalation is always a park, never an autonomous abandon.
- The loop is bounded by `per-stage budget × maxAttempts` **and** the aggregate run budget — whichever is exhausted first stops the loop and escalates.

### Critic stage (read-only by construction)

Spawn with **only** `github-ro` and **no Mount** (reviews `gh pr view` / `gh pr diff`, which need no checkout). Its report routes back to you as the child's final message: feed it into the revise loop (re-run the producing stage with the review as feedback) or post it before the design gate for the human. Reviewers advise, the human decides — the critic never merges, never comments on PRs.

## Phase 3 — Gates

The three human gates are `waiting_for_input` parks, unchanged:

- **Outcome** — after the refine stage opens the spec PR: end your turn asking `approved` / `feedback:`.
- **Design** — after the design stage opens the design PR (and the critic review is posted): end your turn asking `approved` / `feedback:`.
- **Merge** — the implementation PR is human-merged; you never merge.

On the next human prompt: **`approved`** → advance; **`feedback:`** → re-run the stage that produced the artifact with the feedback appended to the stage prompt, then park at the same gate again with an updated summary. Never treat anything else as a gate outcome; if the prompt is ambiguous, ask which of the two it is.

## Completion

At run end, post the execution trace so the human sees both the plan and what actually ran:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "$(cat <<EOF
## Execution trace

\`\`\`json
$(jq -c . /tmp/trace.json)
\`\`\`

- Plan deviations: <list>
- Model substitutions: <list or none>
- Budget used: <actuals> of <aggregate>.
EOF
)"
```

Then settle with a summary. You do **not** merge — merging stays human-gated.

## State across redeploys

- **Issue comments are canonical** — the plan artifact, progress comments, gate statuses, and the trace live there.
- Keep a local checkpoint at every transition: write `/tmp/run-state.json` (position: which stages done, spend so far) after each stage.
- On resume, re-read the issue comments and the checkpoint, re-derive position (which gate, which stages done, spend so far), and continue.

## Fallback: human-driven execution (no platform injection)

The identical recipe works from a human-driven session without `AGENT_LAND_URL` / `AGENT_LAND_BASIC_AUTH`. The human plays the API: they spawn each child with the CLI and paste results back.

1. The human creates a checkout (a Mount or a plain folder) and runs each stage as a one-shot session:

   ```bash
   al run \
     --connector github \
     --model <model> --provider <provider> \
     --mount agent-land:/data/agent-land \
     "…same stage prompt as in the recipe above…"
   ```

2. The human pastes each stage's final report back to you. You hold the plan, compose the next prompt, and post the same comments with `gh`.

3. Gates work the same way — including Gate 0: you post the plan and park before the first child runs.

## Notes & decisions

- **Mount ownership.** You bind no Mount. Sequential stages bind the shared repo Mount one at a time; parallel stages each get their own `agent-land-<stage>-<runId>` Mount that is deleted in the cleanup step. This is the only layout consistent with the enforced single-writer invariant.
- **Per-stage models.** Each child is created with the plan stage's `provider`/`model` (ADR 015). Substitutions follow the preflight ladder and are always posted as a one-line issue note.
- **Soft budgets.** Budget enforcement is orchestrator-side: actuals come from `message_end` `usage` events; a child observed over budget (per-stage or remaining-run) is `DELETE`d, and spawning refuses when `spent + worst-case > remaining`. If pi emits no `usage`, budget enforcement degrades to wall-clock only (ADR 011 limitation). Hard server-side kill switches are ADR 011 future work.
- **Lineage/observability.** Children are deleted after use to free their Mounts; `al ls --tree` shows only the in-flight graph. The durable record is the issue: plan artifact + progress comments + the execution trace.
- **Connector scope.** Each stage gets exactly the connectors declared in its plan entry — `github` for producing stages, `github-ro` only for the critic. Names must match exactly; an unknown connector name resolves to *no* connectors, silently.
- **SSE frame format.** Events arrive as `data: {…}` lines, not bare JSON — always strip the `data: ` prefix before `fromjson`. The bundled `agent-land-api` skill's watch examples show this.
