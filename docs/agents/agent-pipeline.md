# Agent Pipeline Runbook

How a triaged leaf issue travels from `ready-for-agent` to a ready-to-merge PR: the label transitions, how an agent run ends (the completion-signal convention), the failure modes and their recovery recipes, and the manual smoke test that validates the whole chain.

Read [triage-labels](./triage-labels.md) for the two label vocabularies and the ownership boundary (automation never writes the human triage vocabulary), and [GLOSSARY.md](../../GLOSSARY.md) for the terms used here.

## The lifecycle

A sketch of the label flow; the sections below spell out each hop:

```
issue:   ready-for-agent ─bridge─▶ agent:implement ─implement─▶ agent:in-progress ──▶ draft PR (+ agent:in-progress removed)
PR:      agent:review ─review─▶ agent:in-progress ──▶ formal review posted, PR ready (+ agent:in-progress removed)
either:  any failure ──▶ agent:blocked + reason comment with the run link
```

### Issues (implement)

1. A maintainer labels a leaf issue `ready-for-agent` — the only triage action that engages the pipeline.
2. The [Triage Bridge](../../.github/workflows/bridge.yml) re-checks the decision against the issue's *current* state (open, still labeled, pipeline not already engaged) and adds `agent:implement`. That label must be applied with `AGENT_PAT`: label events fired by the default `GITHUB_TOKEN` never start other workflow runs, so a fallback token here would silently break the bridge → implement cascade.
3. The [Agent Implement workflow](../../.github/workflows/agent-implement.yml) fires on `agent:implement`:
   - **Preflight gates** run before any state change: sub-issues, PRD-shaped issues, and issues already closed by an open collaborator PR are refused. A refusal fails straight into the blocked path — a refused issue never shows `agent:in-progress`.
   - The trigger label is consumed (removed) and `agent:in-progress` goes on.
   - The agent (pi CLI; provider and model come from the workflow's `AGENT_PROVIDER`/`AGENT_MODEL` env vars) works on `agent/issue-<n>-<slug>` created from `main`, commits are attributed to `tenderagent[bot]`, and the workflow force-pushes the branch and opens a draft PR titled `Fix #<n>: …` whose body closes the issue.
   - `agent:in-progress` comes off when the run ends, success or failure.
4. The maintainer reviews the draft PR and merges; merging closes the issue via the closing keyword.

### Pull requests (review)

1. A maintainer labels the draft PR `agent:review`.
2. The [Agent Review workflow](../../.github/workflows/agent-review.yml) consumes the label, adds `agent:in-progress`, runs the review agent over the PR diff, and posts the structured payload as a formal PR review. The PR is then marked ready and `agent:in-progress` comes off.
   - The formal review needs `REVIEW_PAT`: GitHub refuses a formal review from the PR's author, and pipeline PRs are authored by `AGENT_PAT`. Without `REVIEW_PAT` the findings degrade to a regular PR comment (the run still succeeds).
3. Closed or merged PRs are skipped: no review, no ready flip.

Runs are serialized per subject (one concurrency group per issue / per PR), so parallel label events queue instead of racing. Both workflows time out at 60 minutes.

### Failure path (both workflows)

Any failure — a refused preflight gate, an agent error, a timeout, a manual cancellation — triggers the failure handler: a 🚫 comment lands on the issue/PR with the reason and a link to the workflow run, the subject is relabeled `agent:blocked`, and the trigger and in-progress labels are consumed. Blocked subjects never re-trigger on their own; retrying is always a human action (see the recovery recipes below).

## Completion-signal convention

An agent run ends before the iteration limit when the agent emits the completion signal: the literal `<promise>COMPLETE</promise>`. It is the Sandcastle default (`completionSignal`), and both prompt skeletons end with it — [.sandcastle/agent-workflows/implement/prompt.md](../../.sandcastle/agent-workflows/implement/prompt.md) and [.sandcastle/agent-workflows/review/prompt.md](../../.sandcastle/agent-workflows/review/prompt.md) — so implementation and review agents share one convention.

Mechanics:

- Sandcastle scans the agent's output for the signal (substring match) after each iteration; on a match the run completes early.
- A grace window (default 60 s) follows the signal: if the agent process does not exit — typically because a spawned `gh`/git subprocess keeps stdout open — Sandcastle force-completes the iteration with a warning.
- The run summary logs the outcome: `completion signal: <promise>COMPLETE</promise>` on a clean early finish, `none` when the iteration limit was hit first.

Rules for anyone editing the prompts (human or agent):

- Keep the literal exactly as written, tags included; it is matched verbatim.
- Keep it as the final line of the prompt's last section, so emitting it stays the agent's terminal action.
- A missing or mistyped signal is not fatal — the run still completes at the iteration limit — but the summary logs `none`, and an implement run whose agent stalled without committing then fails with "no commits were made on the branch". Treat a logged `none` as a prompt-health smell.

## Failure modes and recovery

Three distinct failure shapes, each with its own signature and recovery. In all cases the trigger label to re-add is the one named in the blocked comment — `agent:implement` on issues, `agent:review` on PRs. Toggling `ready-for-agent` (remove, then re-add) works as an issue-side alternative: it is a fresh labeling event, and the bridge happily re-engages a blocked issue.

### Loud failure: LLM-provider credit exhaustion

When the provider account behind `ZAI_API_KEY` is out of credits, the agent step exits non-zero and the run fails loudly. The failure handler still runs: the blocked comment (reason + run link) lands, and the subject is relabeled `agent:blocked`. The tracker shows the failure; nothing stalls quietly.

**Recovery**: top up the provider account, remove `agent:blocked`, re-add the trigger label.

### Silent stall: Actions quota / billing exhaustion

Exhausted Actions minutes or a billing block is the opposite shape: **nothing runs, and no failure handler can run either**. After labeling, no workflow run appears — not even the bridge — and no comment is posted. The subject sits with whatever lifecycle labels were applied before the stall.

- **Detection**: no new run in the Actions tab within a few minutes of labeling. That absence is the failure signature — there is no run to read logs from.
- **Recovery**: fix the billing or spending-limit problem, clean any stale lifecycle labels the stalled attempt left (`agent:implement` the bridge applied, a stuck `agent:in-progress`), then re-add the trigger label. Cleaning is required, not cosmetic: the bridge refuses to engage an issue that still carries `agent:implement` or `agent:in-progress`.
- **Scope note**: standard GitHub-hosted runners are free for public repositories. This mode only bites if the repo goes private, or paid runners hit a spending limit.

### Loud failure: invalid provider key

A `ZAI_API_KEY` the provider rejects behaves like credit exhaustion from the tracker's point of view — the run fails, the subject lands in `agent:blocked` with "no commits were made on the branch". The giveaway is in the run logs: the agent step prints the raw session dump containing `"errorMessage":"401 … Authentication Failed"`, and the run summary claims a completion signal — the scan matched the echoed prompt, not real work (found in the first live validation). Fix the secret's value, re-add the trigger label.

### Interrupted run: stuck `agent:in-progress`

The workflows' cleanup steps run with `if: always()` and cover normal failure and cancellation, but a hard infrastructure kill (runner VM loss, an Actions incident) can bypass them, leaving the issue or PR labeled `agent:in-progress` with no live run behind it.

- **Detection**: an `agent:in-progress` label whose workflow run is not actually running.
- **Recovery**: remove the stale `agent:in-progress` and re-add the trigger label to retry. No branch cleanup is needed — the retry force-pushes the same deterministic branch name.

## Manual smoke test

Validate the whole chain on a staging issue before trusting the pipeline, and re-run it after touching any workflow or orchestration script. Requires a `gh` authenticated against this repo.

**Prerequisites**

- Repo secrets: `ZAI_API_KEY` (agent provider) and `AGENT_PAT` (fine-grained PAT for the bot identity) — `AGENT_PAT` is non-negotiable, see the bridge step above.
- `REVIEW_PAT` (optional but recommended; a fine-grained PAT from a dedicated account): the review workflow's preferred identity, first in the `REVIEW_PAT || AGENT_PAT || GITHUB_TOKEN` chain. Its purpose: the review verdict posts as a **formal PR review**, which GitHub refuses from the PR's author — and pipeline PRs are authored by `AGENT_PAT` — so a non-author identity is needed. Without it the run still succeeds, but the findings degrade to a regular PR comment instead of a formal review; a `REVIEW_PAT` scoped without PR write degrades more gracefully still, re-posting the formal review under the workflow token's identity (`FALLBACK_GH_TOKEN`). This is the one addition to spec #1's token strategy, which names only `AGENT_PAT`; the deviation is noted on #1.
- The four `agent:*` lifecycle labels exist. The bridge and the failure handler create their own labels best-effort, but `agent:in-progress` and `agent:review` must pre-exist — `gh --add-label` silently no-ops a missing label.
- Actions enabled and billing healthy; the failure modes above describe what their absence looks like.

**Steps**

1. **Create a staging leaf issue** — atomic, no sub-issues, no PRD shape (the preflight refuses those: no "Problem statement"/"User stories" headings, fewer than three user-story sentences), and trivially implementable, since its output will be thrown away:

   ```bash
   gh issue create --title "Smoke: add agent-automation line to README" \
     --body "Add one sentence under README.md's first heading stating that AFK agents implement triaged issues. Staging issue for the pipeline smoke test; the change is disposable."
   ```

2. **Label it for the agent**: `gh issue edit <n> --add-label ready-for-agent`.
3. **Expect the bridge** (seconds): a *Triage Bridge* run that adds `agent:implement`.
4. **Expect the implementer** (minutes — a real LLM run): an *Agent Implement* run that swaps the trigger label for `agent:in-progress`, then produces the branch `agent/issue-<n>-<slug>` and a draft PR `Fix #<n>: …` with `Closes #<n>` in the body; `agent:in-progress` comes off when it finishes. A 🚫 comment plus `agent:blocked` here is the loud-failure path working as designed — read the comment, fix, retry.
5. **Request the review**: label the draft PR `agent:review`.
6. **Expect the reviewer** (minutes): an *Agent Review* run that posts a formal review (verdict + findings) from the `REVIEW_PAT` identity and flips the PR to ready.
7. **Clean up** — smoke artifacts are disposable; never merge them:

   ```bash
   gh pr close <pr-number> --delete-branch
   gh issue close <n> --comment "Smoke-test artifact; cleaned up."
   gh issue edit <n> --remove-label ready-for-agent   # plus agent:blocked, if the run failed
   ```

   Then confirm nothing stray remains: no open draft PR, no `agent/issue-<n>-*` branch, no lifecycle labels left on the staging issue.

8. **Record the validation**: add a line under *Live validations* below (and/or a comment on the tracking issue) with the date and the staging-issue number.

### Live validations

- **2026-10-22 — staging issue [#10](https://github.com/tarouttoo/tenderagent/issues/10), draft PR [#12](https://github.com/tarouttoo/tenderagent/pull/12)**: full chain green — `ready-for-agent` → bridge → implement (branch `agent/issue-10-smoke-add-agent-automation-line-to-readme`, commit attributed to `tenderagent[bot]`, draft PR `Closes #10`) → `agent:review` → formal review (verdict approve) → PR ready; artifacts closed and deleted, no labels left. The validation caught and fixed five pipeline defects en route: the bridge's OPEN-state casing (PR #11), the review verdict passed positionally (PR #13), the write-less `REVIEW_PAT` fallback (PR #13/#14), `gh pr ready` under `GITHUB_TOKEN` — cli/cli#8910 (PR #14), and an invalid-workflow startup failure from a duplicate permissions key (PR #15). Note: the formal review posted from the fallback identity (`github-actions[bot]`) because `REVIEW_PAT` is scoped without PR write on this repo; re-scope it if dedicated-account attribution matters.
