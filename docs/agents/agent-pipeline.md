# Agent Pipeline Runbook

How a triaged leaf issue travels from `ready-for-agent` to a ready-to-merge PR: the label transitions, how an agent run ends (the completion-signal convention), the failure modes and their recovery recipes, and the manual smoke test that validates the whole chain.

Read [triage-labels](./triage-labels.md) for the two label vocabularies and the ownership boundary (automation never writes the human triage vocabulary), and [GLOSSARY.md](../../GLOSSARY.md) for the terms used here.

## The lifecycle

A sketch of the label flow; the sections below spell out each hop:

```
issue:   ready-for-agent ─bridge─▶ agent:implement ─implement─▶ agent:in-progress ──▶ draft PR (+ agent:in-progress removed)
PR:      ─implement─▶ agent:review ─review─▶ agent:in-progress ──▶ formal review posted, PR ready (+ agent:in-progress removed)
either:  any failure ──▶ agent:blocked + reason comment with the run link (on the issue before the draft PR exists, on the PR after)
```

### Issues (implement)

1. A maintainer labels a leaf issue `ready-for-agent` — the only triage action that engages the pipeline.
2. The [Triage Bridge](../../.github/workflows/bridge.yml) re-checks the decision against the issue's *current* state (open, still labeled, pipeline not already engaged) and adds `agent:implement`. That label must be applied with `AGENT_PAT`: label events fired by the default `GITHUB_TOKEN` never start other workflow runs, so a fallback token here would silently break the bridge → implement cascade.
3. The [Agent Implement workflow](../../.github/workflows/agent-implement.yml) fires on `agent:implement`:
   - **Preflight gates** run before any state change: sub-issues, PRD-shaped issues, and issues already closed by an open collaborator PR are refused. A refusal fails straight into the blocked path — a refused issue never shows `agent:in-progress`.
   - The trigger label is consumed (removed) and `agent:in-progress` goes on.
   - The agent (pi CLI; provider and model come from the workflow's `AGENT_PROVIDER`/`AGENT_MODEL` env vars) works on `agent/issue-<n>-<slug>` created from `main`, commits are attributed to `tenderagent[bot]`, and the workflow pushes the branch — lease-guarded: `--force-with-lease` pinned to the remote state observed just before the push, so a retry cannot silently clobber commits another run landed on the same branch — and opens a draft PR titled `Fix #<n>: …` whose body the agent drafts (pr-skill template — Summary / Evidence / Merge Danger — written to `pr-body.md` before the completion signal, canned fallback when the draft is missing or empty). Either way the body's first line is `Closes #<n>` — the closing keyword stays required, so merging the PR still closes the issue. The same run then requests the automated review: it labels the PR `agent:review` under `AGENT_PAT` — the same event-cascade rule as the bridge (`GITHUB_TOKEN` label events never start the review workflow), so the PR → review hop needs no hand.
   - `agent:in-progress` comes off when the run ends, success or failure.
4. The automated review lands on the PR (next section); the maintainer reads its findings, reviews, and merges. Merging closes the issue via the closing keyword.

### Pull requests (review)

1. The label arrives on its own: the implement workflow applies `agent:review` to the freshly opened draft PR (Story 5 is automatic). A maintainer re-adds it by hand only to retry a blocked review.
2. The [Agent Review workflow](../../.github/workflows/agent-review.yml) consumes the label, adds `agent:in-progress`, runs the review agent over the PR diff, and posts the structured payload as a formal PR review. The PR is then marked ready and `agent:in-progress` comes off.
   - The formal review needs `REVIEW_PAT`: GitHub refuses a formal review from the PR's author, and pipeline PRs are authored by `AGENT_PAT`. Without `REVIEW_PAT` the findings degrade to a regular PR comment (the run still succeeds).
3. Closed or merged PRs are skipped: no review, no ready flip.

Runs are serialized per subject (one concurrency group per issue / per PR), so parallel label events queue instead of racing. Both workflows time out at 60 minutes.

### Failure path (both workflows)

Any failure — a refused preflight gate, an agent error, a timeout, a manual cancellation — triggers the failure handler: a 🚫 comment lands on the subject with the reason and a link to the workflow run, the subject is relabeled `agent:blocked`, and the trigger and in-progress labels are consumed. Blocked subjects never re-trigger on their own; retrying is always a human action (see the recovery recipes below). The implement workflow's failures land on the issue until its draft PR exists; after that they land on the PR — re-implementing is refused by preflight while an open PR closes the issue, so the retry there is the PR's `agent:review`.

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

The failure shapes below, each with its own signature and recovery. In all cases the trigger label to re-add is the one named in the blocked comment — `agent:implement` on issues, `agent:review` on PRs. Toggling `ready-for-agent` (remove, then re-add) works as an issue-side alternative: it is a fresh labeling event, and the bridge happily re-engages a blocked issue.

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

### Loud failure: push refused by the branch lease

The agent step finishes green, then the *Push branch* step exits non-zero and the blocked comment names the lease conflict. The push pins the remote state it observed (`--force-with-lease`, issue #18), so this means the branch moved underneath the run — a concurrent or earlier run landed newer commits on `agent/issue-<n>-…` between this run's start and its push. The refused push left the newer work intact.

- **Detection**: blocked comment / *Push branch* log shows `! [rejected] … (stale info)`, `(incorrect old value provided)`, `(reference already exists)`, or the recorded reason naming `--force-with-lease`.
- **Recovery**: inspect `origin/agent/issue-<n>-…`. If the newer work is disposable (a stale attempt superseded by this retry — the usual case, since runs are serialized per issue and the loser outlived its slot), delete the branch (`git push origin --delete <branch>`) and re-add the trigger label — the next push then starts under an empty expectation again. If the newer work is valuable, salvage it manually instead of deleting.

### Loud failure: push refused on workflow-file changes

Same step, different signature: the log shows `refusing to allow a GitHub App to create or update workflow … without workflows permission` (the blocked comment names the token scope). The default `GITHUB_TOKEN` can never push commits touching `.github/workflows/` — no `permissions:` block lifts that — so any issue whose fix touches a workflow file pushes with `AGENT_PAT`, which must carry the fine-grained **Workflows: Read and write** permission (classic PAT: the `workflow` scope).

- **Detection**: the recorded reason or the *Push branch* log names workflow files and the token scope.
- **Recovery**: grant the `AGENT_PAT` secret's token the Workflows read/write permission (a maintainer action on the PAT), then re-add the trigger label. No branch cleanup is needed — the refusal happened server-side, before anything landed.

### Loud failure: the review request failed (draft PR opened, review never requested)

The implement run pushed the branch and opened the draft PR, then failed at *Request agent review*. The step runs under `AGENT_PAT` alone — the default `GITHUB_TOKEN`'s label events never start the review workflow, so there is no fallback — and a missing or under-scoped PAT is the dominant cause. The blocked comment lands on the **PR**, not the issue, with the retry spelled out.

- **Detection**: an implement run failing at *Request agent review*; the PR carries the 🚫 comment plus `agent:blocked` while the issue stays clean; the comment names the `AGENT_PAT` requirement or shows the gh refusal.
- **Recovery**: fix the `AGENT_PAT` secret (create it, or grant its fine-grained **Pull requests: Read and write** permission), then retry on the PR: `gh pr edit <pr-number> --add-label agent:review` (removing the PR's `agent:blocked` first). Do **not** re-add `agent:implement` on the issue — preflight refuses issues already closed by an open PR. The issue needs no cleanup.

### Loud failure: review refuses label mutations right after a workflow fix lands on main

A review run failing at *Transition to in-progress* with `GraphQL: Resource not accessible by personal access token (addLabelsToLabelable)` — while the same step is green on fresh PRs — is usually a **stale merge ref**, not a token regression. `pull_request`-triggered runs execute the workflow from `refs/pull/<n>/merge`, and GitHub may reuse a merge ref built before a just-landed base commit (observed in the #34/#35 smoke: the base moved 39 seconds before the label event, and the run kept executing the pre-fix workflow).

- **Detection**: the refusal is PAT-flavored on a step whose env carries the token pins; fetch the merge ref and check — `git fetch origin refs/pull/<n>/merge` then `git show refs/pull/<n>/merge:.github/workflows/agent-review.yml`: the fix is absent from the file the run would execute.
- **Recovery**: refresh the merge ref by pushing an empty commit to the PR branch (`git checkout --detach` the PR head, `git commit --allow-empty`, push), wait for the ref to rebuild, then retry as usual — remove `agent:blocked`, re-add `agent:review`. Verify first that the workflow file at `refs/pull/<n>/merge` now contains the fix.

### Interrupted run: stuck `agent:in-progress`

The workflows' cleanup steps run with `if: always()` and cover normal failure and cancellation, but a hard infrastructure kill (runner VM loss, an Actions incident) can bypass them, leaving the issue or PR labeled `agent:in-progress` with no live run behind it.

- **Detection**: an `agent:in-progress` label whose workflow run is not actually running.
- **Recovery**: remove the stale `agent:in-progress` and re-add the trigger label to retry. No branch cleanup is needed as long as nothing else wrote to the branch — the retry pushes the same deterministic branch name under a lease; if a concurrent writer did land newer commits there, the push refuses and the lease recipe above applies.

## Activation: the enablement wizard

The merge gate is dark until repo auto-merge is enabled — the settings flip is the feature's activation switch and kill switch, and it is the one step automation never takes: flipping the setting is the human-only trust act (ADR 0001). The wizard at [scripts/enable-auto-merge.ts](../../scripts/enable-auto-merge.ts) walks it: it opens the exact settings page, waits, and verifies the captured state via the API before moving on; it optionally walks adding branch protection with the CI check required (verifying via the API too); and it checks the bot token scopes the gate relies on — Workflows read/write and Pull requests write — naming any gap and its fix. Re-running it on a fully enabled repo completes without changes (idempotent).

```bash
npx tsx scripts/enable-auto-merge.ts        # guided session; gh authed with admin on the repo
```

Branch protection is optional and defaults to skipped — the gate verifies CI on the head commit itself; protection only makes GitHub enforce it server-side. Run the wizard before the merge case of the manual smoke test below; record the enablement under *Live validations* when it verifies green.

## Manual smoke test

Validate the whole chain on a staging issue before trusting the pipeline, and re-run it after touching any workflow or orchestration script. Requires a `gh` authenticated against this repo.

**Prerequisites**

- Repo secrets: `ZAI_API_KEY` (agent provider) and `AGENT_PAT` (fine-grained PAT for the bot identity) — `AGENT_PAT` is non-negotiable, see the bridge step above, and must include the fine-grained **Workflows: Read and write** permission so issues that touch `.github/workflows/` can push (the default `GITHUB_TOKEN` never can; see the workflow-file push recipe above).
- `REVIEW_PAT` (optional but recommended; a fine-grained PAT from a dedicated account): the review workflow's preferred identity, first in the `REVIEW_PAT || AGENT_PAT || GITHUB_TOKEN` chain. Its purpose: the review verdict posts as a **formal PR review**, which GitHub refuses from the PR's author — and pipeline PRs are authored by `AGENT_PAT` — so a non-author identity is needed. Without it the run still succeeds, but the findings degrade to a regular PR comment instead of a formal review; a `REVIEW_PAT` scoped without PR write degrades more gracefully still, re-posting the formal review under the workflow token's identity (`FALLBACK_GH_TOKEN`). This is the one addition to spec #1's token strategy, which names only `AGENT_PAT`; the deviation is noted on #1.
- The four `agent:*` lifecycle labels exist. The bridge, the review request, and the failure handlers create their labels best-effort, but `agent:in-progress` must pre-exist — the run transitions' `--add-label` silently no-ops a missing label; pre-creating all four keeps manual retries working.
- Actions enabled and billing healthy; the failure modes above describe what their absence looks like.

**Steps**

1. **Create a staging leaf issue** — atomic, no sub-issues, no PRD shape (the preflight refuses those: no "Problem statement"/"User stories" headings, fewer than three user-story sentences), and trivially implementable, since its output will be thrown away:

   ```bash
   gh issue create --title "Smoke: add agent-automation line to README" \
     --body "Add one sentence under README.md's first heading stating that AFK agents implement triaged issues. Staging issue for the pipeline smoke test; the change is disposable."
   ```

2. **Label it for the agent**: `gh issue edit <n> --add-label ready-for-agent`.
3. **Expect the bridge** (seconds): a *Triage Bridge* run that adds `agent:implement`.
4. **Expect the implementer** (minutes — a real LLM run): an *Agent Implement* run that swaps the trigger label for `agent:in-progress`, then produces the branch `agent/issue-<n>-<slug>` and a draft PR `Fix #<n>: …` with `Closes #<n>` in the body; when it finishes, `agent:in-progress` comes off the issue and the same run's *Request agent review* step labels the PR `agent:review`. A 🚫 comment plus `agent:blocked` here is the loud-failure path working as designed — read the comment, fix, retry (on the PR, if the failure came after the PR opened).
5. **Expect the reviewer** (minutes): an *Agent Review* run, triggered by the automatic `agent:review` label, that posts a formal review (verdict + findings) from the `REVIEW_PAT` identity and flips the PR to ready.
6. **Clean up** — smoke artifacts are disposable; never merge them:

   ```bash
   gh pr close <pr-number> --delete-branch
   gh issue close <n> --comment "Smoke-test artifact; cleaned up."
   gh issue edit <n> --remove-label ready-for-agent   # plus agent:blocked, if the run failed
   ```

   Then confirm nothing stray remains: no open draft PR, no `agent/issue-<n>-*` branch, no lifecycle labels left on the staging issue.

7. **Record the validation**: add a line under *Live validations* below (and/or a comment on the tracking issue) with the date and the staging-issue number.

### Live validations

- **2026-10-23 — staging issue [#34](https://github.com/tarouttoo/tenderagent/issues/34), draft PR [#35](https://github.com/tarouttoo/tenderagent/pull/35)**: full chain green — `ready-for-agent` → bridge → implement (draft PR opened **with the agent-drafted body**, the #26 feature: pr-skill Summary / Evidence / Merge Danger, `Closes #34` first line) → automatic `agent:review` (#31's wiring, no hand) → formal review ✅ Approve → PR ready. Two finds en route, both recovered: the #32 token bug refused the review leg's label transition until #33 landed (the same root cause stalled PR #30's review), and a stale merge-ref race executed the pre-#33 review workflow on the first retry — recovery recipe above. Artifacts closed and deleted, no labels left.

- **2026-10-22 — staging issue [#10](https://github.com/tarouttoo/tenderagent/issues/10), draft PR [#12](https://github.com/tarouttoo/tenderagent/pull/12)**: full chain green — `ready-for-agent` → bridge → implement (branch `agent/issue-10-smoke-add-agent-automation-line-to-readme`, commit attributed to `tenderagent[bot]`, draft PR `Closes #10`) → `agent:review` → formal review (verdict approve) → PR ready; artifacts closed and deleted, no labels left. The validation caught and fixed five pipeline defects en route: the bridge's OPEN-state casing (PR #11), the review verdict passed positionally (PR #13), the write-less `REVIEW_PAT` fallback (PR #13/#14), `gh pr ready` under `GITHUB_TOKEN` — cli/cli#8910 (PR #14), and an invalid-workflow startup failure from a duplicate permissions key (PR #15). Note: the formal review posted from the fallback identity (`github-actions[bot]`) because `REVIEW_PAT` is scoped without PR write on this repo; re-scope it if dedicated-account attribution matters.
