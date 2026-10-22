# TASK

Review pull request #{{PR_NUMBER}}: {{PR_TITLE}}

The PR merges `{{SOURCE_BRANCH}}` into `{{TARGET_BRANCH}}`.

# PULL REQUEST

## Body

{{PR_BODY}}

## Diff (unified)

{{PR_DIFF}}

# GLOSSARY

The project's domain vocabulary. Flag code, tests, and docs whose naming
drifts from it (or uses a term the glossary says to avoid):

{{GLOSSARY}}

# REVIEW

Assess the change for:

- **Correctness**: logic bugs, unhandled edge cases, broken invariants.
- **Tests**: meaningful coverage for new behavior; red-green discipline.
- **Conventions**: `AGENTS.md` and `docs/agents/` working conventions.
- **Vocabulary**: consistent use of the glossary terms.
- **Scope**: the diff matches what the PR body promises; flag scope creep or
  missing pieces.

You may read repository files for context, but this is a read-only review.
Do not fix anything. Do not modify the working tree.
Do not commit. Do not push.
Do not create or edit PRs. Do not edit labels.

# OUTPUT

End your final message with exactly one ```json fenced code block holding the
review payload the workflow parses:

```json
{
  "verdict": "approve" | "comment" | "request_changes",
  "summary": "One short paragraph: what the change does and your overall assessment.",
  "findings": [
    {
      "severity": "blocker" | "concern" | "nit",
      "file": "path/relative/to/repo/root.ts",
      "line": 12,
      "note": "What is wrong and why it matters."
    }
  ]
}
```

- `verdict` is `approve` when there are no blockers, `request_changes` when a
  blocker must be fixed before merge, `comment` otherwise.
- `severity` is `blocker` (must be fixed), `concern` (should be discussed), or
  `nit` (optional polish).
- `file` and `line` are optional but strongly recommended for every finding;
  `line` is 1-based and refers to the new version of the file.
- `findings` is `[]` when the change looks clean.

Nothing else may appear inside the fenced block. Do not wrap the payload in
any other tag or prose inside the fence.

When complete, output `<promise>COMPLETE</promise>`.
