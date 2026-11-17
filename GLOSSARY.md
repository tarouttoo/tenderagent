# Tenderagent

Label-driven agent automation for the tender pipeline: humans triage, AFK agents implement and review, and the merge gate either merges or holds for a human.

## Language

### Agent automation

**AFK agent**:
A coding agent that implements or reviews work end-to-end without a human at the keyboard, launched by automation rather than by a person.
_Avoid_: bot, autonomous agent

**Leaf issue**:
An atomic issue with no sub-issues and no product-spec shape — the only kind of issue an AFK agent may implement.
_Avoid_: task, ticket

**Triage**:
The human act of deciding which issues are ready, and for whom — owned by people, never written by automation.
_Avoid_: grooming, prioritization

**Lifecycle labels**:
The `agent:*` labels (`agent:implement`, `agent:in-progress`, `agent:review`, `agent:merge`, `agent:hold`, `agent:blocked`) that mark where an issue or PR sits in the agent pipeline; written by automation — a maintainer only re-adds trigger labels on retry — and kept separate from the human triage vocabulary, which automation never writes.
_Avoid_: status labels, workflow tags

**Bridge**:
The automation that translates a human triage decision into the machine lifecycle — the piece that turns `ready-for-agent` into `agent:implement`.
_Avoid_: trigger, relay

**Completion signal**:
The exact marker (`<promise>COMPLETE</promise>`) an AFK agent emits when it considers its task done; the orchestrator scans the agent's output for it and ends the run early instead of burning the iteration limit.
_Avoid_: stop word, sentinel token

**Staging issue**:
A disposable leaf issue created only to exercise the pipeline end to end; never merged, its branch and draft PR cleaned up afterwards.
_Avoid_: test issue, canary

**Merge gate**:
The deterministic step after review that applies the merge policy to a PR and either merges it or holds it; its judgment is code, never an agent's live call.
_Avoid_: merge bot, auto-approver

**Merge policy**:
The repo-owned rules a PR must satisfy to merge without a human: approved verdict, confirmed two-way door, no denied paths, diff under the ceiling, no blocked sub-issue, green CI, and repo auto-merge enabled — the activation switch.
_Avoid_: auto-merge rules, merge config

**Hold**:
A gate outcome marking a PR as needing maintainer attention — never a failure, so no `agent:blocked` and no failed run — with its reasons posted as one comment on the PR; the PR stays ready to merge by hand.
_Avoid_: block, reject

**Door**:
Whether a change is one-way (hard to reverse) or two-way (cheap to revert); the implementer declares it in the PR's Merge Danger, the reviewer assesses it independently, and a disagreement holds the PR.
_Avoid_: reversibility, merge risk
