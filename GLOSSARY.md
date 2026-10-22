# Tenderagent

Label-driven agent automation for the tender pipeline: humans triage, AFK agents implement and review, humans merge.

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
The `agent:*` labels (`agent:implement`, `agent:in-progress`, `agent:review`, `agent:blocked`) that mark where an issue or PR sits in the agent pipeline; written exclusively by automation and kept separate from the human triage vocabulary.
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
