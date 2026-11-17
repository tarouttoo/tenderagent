---
status: accepted
---

# AFK agents merge two-door PRs through a deterministic gate

The pipeline ended at a human merge on every PR, and we want triaged sub-issues to close end to end — but an LLM deciding "merge now?" at merge time is unacceptable. We split the judgment from the mechanics: the implementer and reviewer agents produce structured judgments (the door declared in the PR body's Merge Danger, the review verdict, the reviewer's independent door assessment), and a deterministic gate in the review workflow reconciles them against the merge policy — approved verdict, confirmed two-way door, no denied paths (`.github/workflows/`, `.sandcastle/`, lockfiles), diff ≤ 300 changed lines, no open blockers on the sub-issue the PR closes, CI green on the head SHA. Every condition met → `agent:merge` plus `gh pr merge --squash --auto`; anything else → `agent:hold` with the enumerated reasons, and a human merges. The default is escalation: the gate's silence means maintainer attention.

Decided in spec #36; the operational surface — the eight condition ids, the hold comment, the recovery recipe — is the runbook's [merge gate section](../agents/agent-pipeline.md#the-merge-gate).

## Considered options

- **Keep the human merge on every PR** (the status quo) — rejected: the maintainer's merge queue is then *every* PR, and the promised AFK flow still ends in a hand on the merge button; the payoff only lands where the gate can merge.
- **Per-issue triage labels** (`merge:auto` / `merge:manual`) — rejected: eligibility is computed from repo-owned policy, not assigned per ticket; the triage vocabulary stays small and the policy changes by PR, like any coding standard.
- **Letting the review agent merge on approve** — rejected: it turns one agent's judgment directly into a write action with no independent check; the reviewer stays read-only.

## Consequences

- Until a human enables repo auto-merge in the GitHub settings (the enablement wizard, issue #41, ships with the feature), every otherwise-eligible PR holds on that single reason — the settings flip is the activation switch for the whole feature, and flipping it back is a deliberate kill switch. Enabling it is a human trust act that automation guides and verifies but never performs.
- Held PRs are the maintainer's merge queue and stay ready for review, so the cost of a hold is reading one comment, not undrafting and re-running.
- In this repo most pipeline meta-work touches denied paths, so it stays human-merged; the gate pays off fully in consumer repos where product code is ordinary sources.
- The policy numbers (300-line ceiling, denylist) live in one module, so tuning them is an ordinary reviewed PR rather than a config change.
