# Trust settings are flipped by humans, never by automation

The pipeline's trust settings — repo auto-merge, branch protection, and the bot tokens' scopes — are flipped only by a human at the settings page; automation guides and verifies (the enablement wizard, `scripts/enable-auto-merge.ts`) but never performs a settings write. An AFK agent that could flip its own activation switch and kill switch would have neither, so the enablement stays the one step automation never takes: the flip is the human-only trust act.

## Considered options

- **Let the agent enable auto-merge via the API** (`PATCH /repos/{repo}` with `allow_auto_merge: true`) when it first needs it — rejected: it would make the agent the authority over its own merge rights, exactly the power the merge gate exists to bound, and it would erase the human's kill switch.
