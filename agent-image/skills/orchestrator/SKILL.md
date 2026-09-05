---
name: orchestrator
description: Run the static orchestrator recipe — drive the product pipeline (research → refine → design → critic) as sequential child sessions via the platform JSON/SSE API. Active when AGENT_LAND_URL and AGENT_LAND_BASIC_AUTH are set and the task is to run the pipeline on a pipeline-ready issue.
---

# orchestrator — static pipeline as sequential child sessions

You are a **platform-enabled orchestrator session**. The platform injects `AGENT_LAND_URL` (base URL, no trailing slash) and `AGENT_LAND_BASIC_AUTH` (`session-<id>:<token>`). You drive the [product pipeline](/docs/knowledge/product/pipeline.md) for one issue as a **fixed, deterministic stage list**:

```
research → refine (feature note + spec PR) → GATE 1 → design (design note + design PR) → critic review → GATE 2
```

Each stage is a **fresh child session**. You decide *what goes into each stage's prompt* — never *which stages run or in what order*. Control flow is this fixed recipe, not something you plan per task.

Read the underlying API skill first: `agent-image/skills/agent-land-api/SKILL.md`. This skill adds the pipeline discipline on top of it.

## Preconditions

- `AGENT_LAND_URL` and `AGENT_LAND_BASIC_AUTH` are set (you are platform-enabled).
- A `github` connector exists on the platform (provides `GITHUB_TOKEN`, `GIT_USER_NAME`, `GIT_USER_EMAIL`).
- A Mount holding a git checkout of the repo exists on the platform. Name it `agent-land` in this recipe; replace with the real mount name if different.

Derive your own session id once at the start:

```bash
MY_SESSION_ID="${AGENT_LAND_BASIC_AUTH%%:*}"
MY_SESSION_ID="${MY_SESSION_ID#session-}"
```

## The invariant that shapes everything — read first

The server **hard-enforces at most one live session per Mount**. A session-create request that binds a Mount already bound by any non-`stopped` session fails with:

```
Mount "agent-land" is bound by a live session; stop it first.
```

Two consequences you must obey:

1. **You must not bind the repo Mount yourself.** If the orchestrator held the checkout mount, every child create would fail. You coordinate via `gh` and the JSON/SSE API only; the checkout belongs to whichever stage child is active.
2. **Each child must be fully done and `DELETE`d before the next child is created.** A settled child is still a live session and still holds the Mount. `DELETE /api/sessions/:id` kills (if running) and removes it, releasing the Mount for the next stage. This is *why* the stages are strictly sequential.

## Rules

1. **Fixed stage list.** Never add, remove, reorder, parallelise, or loop stages on your own judgment. The list above is the recipe.
2. **Sequential only.** One child at a time. Watch it settle → collect its result → `DELETE` it → then create the next child.
3. **Children are platform-blind.** Create every child with `"platform": false` and `"parentSessionId": "<your session id>"`. Omit `platform`/set it `false` unless nested orchestration is intended — nested orchestration is not part of this recipe.
4. **Connectors limited to the stage's need.** Every stage here needs only the GitHub connector — never pass the full connector set. Connectors resolve by **exact name**, so discover it in preflight (`GH_CONNECTOR`) instead of hardcoding a guess.
5. **One progress comment per stage transition** on the issue (see each stage below). Never comment twice for the same transition.
6. **Gates are parks.** At a gate, end your turn with a summary and exactly one question. Do **not** create more children until a human re-prompts with the gate outcome.
7. **Deterministic steps run as commands.** `curl`, `jq`, `gh`, `git` steps are plain commands; you apply judgment only when composing stage prompts and summarising results.

## Child lifecycle — the one loop, copy-paste

The entire pipeline is this loop repeated per stage. Paste once at the top of your session.

```bash
MY_SESSION_ID="${AGENT_LAND_BASIC_AUTH%%:*}"
MY_SESSION_ID="${MY_SESSION_ID#session-}"

REPO_OWNER="marcoklein"
REPO_NAME="agent-land"
REPO="$REPO_OWNER/$REPO_NAME"
MOUNT_NAME="agent-land"           # the Mount registered on the platform
MOUNT_TARGET="/data/agent-land"   # path the child binds it at
GH_CONNECTOR="<set in preflight>" # exact name of the GitHub connector (see Preflight)

# Build the create JSON with jq -n — never with string concatenation. A live run
# shipped the literal "$CONNECTOR_NAME" as the connector name; unknown names
# resolve to NO env silently, so the child had no GITHUB_TOKEN.
spawn_child() {
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X POST "$AGENT_LAND_URL/api/sessions" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
      --arg c "$GH_CONNECTOR" \
      --arg m "$MOUNT_NAME" \
      --arg t "$MOUNT_TARGET" \
      --arg p "$MY_SESSION_ID" \
      '{connectors:[$c], mounts:[{source:$m, target:$t}], platform:false, parentSessionId:$p}')" \
    | jq -r '.session.id'
}

prompt_child() {
  child_id="$1"; message="$2"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X POST "$AGENT_LAND_URL/api/sessions/$child_id/prompt" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg m "$message" '{message: $m}')"
}

# GOTCHA: GET /api/sessions/:id/events?live=1 NEVER closes on `agent_settled` —
# it only closes when the session is STOPPED. A bare `curl -N` hangs forever.
# GOTCHA 2: a `curl | jq | while read` pipeline that `break`s on the marker still
# hangs — curl only dies on SIGPIPE, which needs a *write*, and a settled child
# writes nothing more. Capture in the background and poll the file instead, then
# kill curl explicitly. (Both hangs observed live on 2026-09-05.)
watch_child() {
  child_id="$1"; out="/tmp/${child_id}.sse"
  : > "$out"
  curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
    "$AGENT_LAND_URL/api/sessions/$child_id/events?live=1" >> "$out" 2>/dev/null &
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

delete_child() {
  child_id="$1"
  curl -sS -u "$AGENT_LAND_BASIC_AUTH" \
    -X DELETE "$AGENT_LAND_URL/api/sessions/$child_id"
}

run_stage() {
  stage="$1"; prompt="$2"
  out="/tmp/${stage}.result"
  echo "==> [$stage] creating child"
  child_id="$(spawn_child)"
  echo "==> [$stage] child $child_id created"
  prompt_child "$child_id" "$prompt" >/dev/null
  echo "==> [$stage] watching $child_id until settled"
  watch_child "$child_id"
  echo "==> [$stage] $child_id settled — result:"
  collect_result "$child_id" | tee "$out"
  echo "==> [$stage] deleting $child_id (releases the Mount for the next stage)"
  delete_child "$child_id" >/dev/null
  echo "==> [$stage] done"
}
```

Why `tee` + `jq --unbuffered -R`: the stream is SSE frames (`data: {…}` lines, not bare JSON), so the `data: ` prefix is stripped before `fromjson`. The `while` loop exits the moment the settle marker arrives, which tears down the pipeline — you never wait for EOF.

### Fallback: bounded stream + status polling

If the break-on-settled loop ever misbehaves in your environment, use a bounded stream plus polling instead:

```bash
child_id="<child-id>"

# 1. Bound the live stream (does not wait for EOF):
timeout 900 curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
  "$AGENT_LAND_URL/api/sessions/$child_id/events?live=1" > "/tmp/${child_id}.sse" || true

# 2. Poll the session record until the turn is no longer running:
until s="$(curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/sessions/$child_id" | jq -r '.session.status')"; \
      [ "$s" = "idle" ] || [ "$s" = "waiting_for_input" ] || [ "$s" = "stopped" ]; do
  sleep 10
done

# 3. Replay the event history briefly to guarantee the final message_end is captured:
timeout 15 curl -sS -N -u "$AGENT_LAND_BASIC_AUTH" \
  "$AGENT_LAND_URL/api/sessions/$child_id/events" >> "/tmp/${child_id}.sse" || true

collect_result "$child_id"
```

The non-`live` events endpoint replays the persisted event log (including the final `message_end`) before it starts streaming, which is why step 3 makes the result reliably collectable even if step 1 was killed early.

## Preflight (once per run)

```bash
# You need gh. In the agent image gh does not pick up GITHUB_TOKEN automatically —
# export GH_TOKEN first. Never run `gh auth login`.
export GH_TOKEN="$GITHUB_TOKEN"
gh auth status

# Confirm the mount exists and is free:
curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/mounts" | jq -r '.mounts[].name'

# Confirm the github connector exists and capture its EXACT name — connectors
# resolve by exact name, so "github" would silently match nothing:
GH_CONNECTOR="$(curl -sS -u "$AGENT_LAND_BASIC_AUTH" "$AGENT_LAND_URL/api/connectors" \
  | jq -er '[.connectors[] | select(.envKeys | index("GITHUB_TOKEN")) | .name][0]')"
echo "GitHub connector: $GH_CONNECTOR"
```

If the Mount is missing, report that the operator must create it (`al mounts add agent-land`) and stop. If the Mount is not yet seeded with a checkout, the research stage seeds it (see its prompt).

## The recipe

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

Post the start comment:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "🤖 Orchestrator started: research → refine (spec PR) → design (design PR) → critic review."
```

### Stage 1 — research child

Compose the prompt (this is the *content* you decide; embed the issue body):

```bash
ISSUE_BODY="$(jq -r '.body' /tmp/issue.json)"
RESEARCH_PROMPT="$(cat <<EOF
You are the research stage of the agent-land product pipeline, working on issue #$ISSUE_N.

Working directory: $MOUNT_TARGET (a mounted git checkout of $REPO).

Step 0 — seed or sync the checkout:
  if [ ! -d $MOUNT_TARGET/.git ]; then
    git clone https://github.com/$REPO.git $MOUNT_TARGET
  fi
  cd $MOUNT_TARGET && git fetch origin && git checkout main && git reset --hard origin/main

Then:
1. Read the issue: gh issue view $ISSUE_N --repo $REPO --json number,title,body,labels
2. Read the docs that matter: docs/knowledge/multi-agent-workflow.md, docs/knowledge/product/pipeline.md,
   docs/knowledge/learnings/archon-inspiration.md, and any ADRs or designs the issue points at.
3. Write a research brief.

Issue body:
$ISSUE_BODY

The brief must contain:
- The issue's goal in one paragraph.
- The constraints that bind the work (engine boundaries, OKF conventions, the Mount single-writer invariant, human gates).
- The specific docs and ADRs the later stages must read, with repo paths.
- Open questions the Feature note and Design note must answer.
- A recommended angle for the Feature note and the Design note.

Report the brief as your final message. Do NOT open PRs. Do NOT modify the repo.
EOF
)"

run_stage research "$RESEARCH_PROMPT"
RESEARCH_BRIEF="$(cat /tmp/research.result)"
```

Then post the progress comment:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "## Research complete

$RESEARCH_BRIEF"
```

### Stage 2 — refine child (feature note + spec PR)

```bash
SPEC_SLUG="<slug>"   # you pick a short slug from the research brief, e.g. the issue's topic

REFINE_PROMPT="$(cat <<EOF
You are the refine stage of the agent-land product pipeline, working on issue #$ISSUE_N.

Working directory: $MOUNT_TARGET (a mounted git checkout of $REPO).

Step 0 — sync and set identity:
  cd $MOUNT_TARGET && git fetch origin && git checkout main && git reset --hard origin/main
  git config user.name "\$GIT_USER_NAME"
  git config user.email "\$GIT_USER_EMAIL"
  export GH_TOKEN="\$GITHUB_TOKEN"   # gh in the agent image needs GH_TOKEN; GITHUB_TOKEN alone left it unauthenticated in a live run

Step 1 — branch:
  git checkout -b feat/$SPEC_SLUG-spec

Step 2 — write the Feature note:
  docs/knowledge/product/features/$SPEC_SLUG.md
  Follow the okf skill (frontmatter type: Feature, status: draft) and the product skill stage 1:
  Why, user stories (As a… I want… so…), acceptance criteria, open questions.
  Cross-link the engine primitives from docs/knowledge/engine.md.

Step 3 — commit, push, and open the spec PR:
  git add docs/knowledge/product/features/$SPEC_SLUG.md
  git commit -m "docs(product): feature note for $SPEC_SLUG"
  git push https://x-access-token:\${GITHUB_TOKEN}@github.com/$REPO.git HEAD
  gh pr create --repo $REPO --title "Spec: $SPEC_SLUG" --body "Feature note for #$ISSUE_N — outcome gate."

Research brief:
$RESEARCH_BRIEF

Report as your final message, in this order:
- SPEC_PR_URL: the spec PR URL
- SPEC_PR_NUMBER: the PR number
- SUMMARY: one paragraph on the feature note
EOF
)"

run_stage refine "$REFINE_PROMPT"
REFINE_RESULT="$(cat /tmp/refine.result)"
SPEC_PR_NUMBER="$(printf '%s' "$REFINE_RESULT" | sed -n 's/.*SPEC_PR_NUMBER: *\([0-9]*\).*/\1/p' | head -1)"
SPEC_PR_URL="$(printf '%s' "$REFINE_RESULT" | sed -n 's/.*SPEC_PR_URL: *\(.*\)/\1/p' | head -1)"
```

Post the progress comment, then **park at gate 1**:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "## Spec PR opened

$REFINE_RESULT"
```

Your final message at gate 1 (end the turn — do not create more children):

> Spec PR is open: `<URL>`. Reply **`approved`** to continue to design, or **`feedback: <notes>`** to revise the spec.

### Resuming at a gate

On the next human prompt:

- contains **`approved`** → advance to the next stage.
- contains **`feedback:`** → re-run the stage that produced the PR, appending the feedback to the stage prompt (tell the child to address the review comments on its PR, push new commits, and report again), then park at the same gate again with an updated summary.

Never treat anything else as a gate outcome; if the prompt is ambiguous, ask which of the two it is.

### Stage 3 — design child (design note + design PR)

```bash
DESIGN_PROMPT="$(cat <<EOF
You are the design stage of the agent-land product pipeline, working on issue #$ISSUE_N.

Working directory: $MOUNT_TARGET (a mounted git checkout of $REPO).

Step 0 — sync and set identity:
  cd $MOUNT_TARGET && git fetch origin && git checkout main && git reset --hard origin/main
  git config user.name "\$GIT_USER_NAME"
  git config user.email "\$GIT_USER_EMAIL"
  export GH_TOKEN="\$GITHUB_TOKEN"   # gh in the agent image needs GH_TOKEN; GITHUB_TOKEN alone left it unauthenticated in a live run

Step 1 — read the feature note from the spec PR (do not assume it is on main):
  gh pr view $SPEC_PR_NUMBER --repo $REPO --json title,body
  gh pr diff $SPEC_PR_NUMBER --repo $REPO

Step 2 — branch:
  git checkout -b feat/$SPEC_SLUG-design

Step 3 — write the Design note:
  docs/knowledge/product/designs/$SPEC_SLUG-design.md
  Follow the okf skill (frontmatter type: Design, status: draft) and the product skill stage 2:
  Approach, Interfaces, Risks & mitigations, ADR pointers, Minimal change set.
  Answer the Feature note's open questions, or mark them explicitly deferred.

Step 4 — commit, push, and open the design PR:
  git add docs/knowledge/product/designs/$SPEC_SLUG-design.md
  git commit -m "docs(product): design note for $SPEC_SLUG"
  git push https://x-access-token:\${GITHUB_TOKEN}@github.com/$REPO.git HEAD
  gh pr create --repo $REPO --title "Design: $SPEC_SLUG" --body "Design note for #$ISSUE_N — design gate."

Research brief:
$RESEARCH_BRIEF

Spec PR summary:
$REFINE_RESULT

Report as your final message, in this order:
- DESIGN_PR_URL: the design PR URL
- DESIGN_PR_NUMBER: the PR number
- SUMMARY: one paragraph on the design
EOF
)"

run_stage design "$DESIGN_PROMPT"
DESIGN_RESULT="$(cat /tmp/design.result)"
DESIGN_PR_NUMBER="$(printf '%s' "$DESIGN_RESULT" | sed -n 's/.*DESIGN_PR_NUMBER: *\([0-9]*\).*/\1/p' | head -1)"
DESIGN_PR_URL="$(printf '%s' "$DESIGN_RESULT" | sed -n 's/.*DESIGN_PR_URL: *\(.*\)/\1/p' | head -1)"
```

Post the progress comment:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "## Design PR opened

$DESIGN_RESULT"
```

### Stage 4 — critic child (review summary before the human sees it)

```bash
CRITIC_PROMPT="$(cat <<EOF
You are the critic/reviewer stage of the agent-land product pipeline, reviewing work for issue #$ISSUE_N.

Working directory: $MOUNT_TARGET (a mounted git checkout of $REPO).

Step 0 — sync:
  cd $MOUNT_TARGET && git fetch origin && git checkout main && git reset --hard origin/main

Then review the two PRs:
  gh pr view $SPEC_PR_NUMBER --repo $REPO --json title,body,state
  gh pr diff $SPEC_PR_NUMBER --repo $REPO
  gh pr view $DESIGN_PR_NUMBER --repo $REPO --json title,body,state
  gh pr diff $DESIGN_PR_NUMBER --repo $REPO

Evaluate against:
- docs/knowledge/product/goals/boundaries.md and vision-board.md (is it in scope and worth building?)
- the relevant ADRs in docs/knowledge/adrs/
- the OKF conventions (frontmatter, actor rule, status)
- the product pipeline's gate discipline (docs/knowledge/product/pipeline.md)

Report a review summary as your final message:
- What is solid in each note.
- What is weak or missing, with concrete requested changes.
- A one-line verdict: ready for human review, or needs revision.

Do NOT modify the repo. Do NOT open or comment on PRs.
EOF
)"

run_stage critic "$CRITIC_PROMPT"
CRITIC_RESULT="$(cat /tmp/critic.result)"
```

Post the critic review as a progress comment, then **park at gate 2**:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "## Critic review

$CRITIC_RESULT"
```

Your final message at gate 2 (end the turn):

> Design PR is open: `<URL>`. Critic review is posted on the issue. Reply **`approved`** to close the run, or **`feedback: <notes>`** to revise the design.

### Completion (design gate approved)

Post the final comment and end the turn:

```bash
gh issue comment "$ISSUE_N" --repo "$REPO" --body "## Pipeline complete

- Spec PR: $SPEC_PR_URL
- Design PR: $DESIGN_PR_URL
- Critic review: posted above.

Merging stays human-gated; implementation is a separate dev-loop run (see the dev-playbook skill)."
```

Then settle with a summary of both PRs and the critic verdict. You are done — you do **not** implement, merge, or start extra stages.

## Fallback: human-driven execution (no platform injection)

The identical recipe works today from a human-driven session without `AGENT_LAND_URL` / `AGENT_LAND_BASIC_AUTH`. The human plays the API: they spawn each child with the CLI and paste results back.

1. The human creates a checkout (a Mount or a plain folder) and runs each stage as a one-shot session:

   ```bash
   al run \
     --connector github \
     --mount agent-land:/data/agent-land \
     "…same stage prompt as in the recipe above…"
   ```

   `--platform` is **not** needed for children; only the orchestrator needs platform injection.

2. The human pastes each stage's final report back to you (the orchestrator). You hold the stage list, compose the next prompt, and post the same progress comments with `gh`.

3. Gates work the same way: you end your turn with a summary and a question; the human re-prompts with `approved` or `feedback: …`.

Same fixed stage list, same prompts, same comments — only the child-spawning mechanism differs.

## Notes & decisions

- **Mount ownership (documented decision).** The issue text says "orchestrator with a Mount holding the repo checkout", but the server hard-enforces at most one live session per Mount. Binding the checkout to the orchestrator would make every child create fail. The working design: the orchestrator binds **no** Mount; each stage child binds the repo Mount in turn and is `DELETE`d before the next child. This is the only layout consistent with the enforced invariant.
- **Lineage tradeoff.** Children are deleted after use to release the Mount, so `al ls --tree` shows only the currently-running child under you, not the whole finished run. The durable trail is the issue comments + the PRs. Keep children alive only if a future phase adds per-child worktree mounts (parallelism is explicitly out of scope here).
- **Model.** Child create omits `model`/`provider`, so children inherit the platform default (`deepseek-v4-pro` unless the operator overrides `DEFAULT_MODEL`). Per-stage model choice is Phase 4, not this recipe.
- **Connector scope.** Every stage gets exactly the discovered GitHub connector (`GH_CONNECTOR`) and nothing else. Do not widen this. Names must match exactly — an unknown connector name resolves to *no* connectors, silently.
- **SSE frame format.** Events arrive as `data: {…}` lines, not bare JSON — always strip the `data: ` prefix before `fromjson`. The bundled `agent-land-api` skill's watch examples show this.
