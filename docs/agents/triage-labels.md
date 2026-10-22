# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## The `agent:*` lifecycle vocabulary

Lifecycle labels (see the [glossary](../../GLOSSARY.md)) mark where an issue or PR sits in the agent pipeline. They are written by automation — the bridge and the agent workflows — with two human touches: `agent:review` is applied by a maintainer to request a review, and a trigger label is re-applied by hand when retrying. The boundary cuts one way only: automation writes nothing outside the `agent:` prefix (enforced by `assertOnlyAgentLabels` in `.sandcastle/agent-workflows/shared/failure.ts`), so the human triage vocabulary above is never written, modified, or removed by a workflow.

| Label                 | Surface   | Written by                     | Meaning                                                                                |
| --------------------- | --------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| `agent:implement`     | issue     | Bridge (automation)            | Trigger: the triage decision was bridged; fires the implement workflow, which consumes it |
| `agent:in-progress`   | issue, PR | Workflows (automation)         | An agent run is live; removed when the run ends, success or failure                     |
| `agent:review`        | PR        | Maintainer (human)             | Trigger: requests the automated review; fires the review workflow, which consumes it     |
| `agent:blocked`       | issue, PR | Failure handlers (automation)  | A run failed; the subject carries a comment with the reason and the workflow-run link    |

Transitions, the completion-signal convention, failure modes with recovery recipes, and the manual smoke-test path are documented in the [agent pipeline runbook](./agent-pipeline.md).
