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

## What the labels trigger

Applying `ready-for-agent` to an issue is the single triage action that starts the automation: the [Triage Bridge](../../.github/workflows/bridge.yml) adds the `agent:implement` lifecycle label, which fires the implement workflow. The bridge reads the triage vocabulary but never modifies or removes it — triage labels stay owned by people. Decisions run against the issue's current labels, so removing `ready-for-agent` before the bridge runs cancels the handoff, and re-applying it to a blocked issue is a valid retry.
