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
The automation that translates a human triage decision into the machine lifecycle: labeling an issue `ready-for-agent` makes the bridge add `agent:implement`, which triggers the implementation agent.
_Avoid_: trigger, relay
