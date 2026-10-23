# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are on branch `{{SOURCE_BRANCH}}`, already created from `{{TARGET_BRANCH}}`.

# ISSUE

Title: {{ISSUE_TITLE}}

## Body

{{ISSUE_BODY}}

## Comments

{{ISSUE_COMMENTS}}

# GLOSSARY

Use the project's domain vocabulary from this glossary in code, tests, commit
messages, and any documentation you touch:

{{GLOSSARY}}

# CONTEXT

Explore the repo before changing code:

- `GLOSSARY.md` and `docs/adr/` if relevant
- `AGENTS.md` and `docs/agents/` for working conventions

# EXECUTION

Where a test seam already exists, or a new one is being proposed, do
red-green-refactor:

1. RED: write a failing test
2. GREEN: implement the smallest correct change
3. REPEAT until the issue is done
4. REFACTOR

Do not improvise new test seams, such as extracting out a function so that it
can be tested in isolation. This creates spaghetti tests.

Run `npm run typecheck` before committing. Run focused tests where relevant.

# PR BODY

The workflow opens a draft PR with a body you draft, following the `pr`
skill template (inlined here — runners have no user-level skills):

- **Summary**: the smallest view that makes the change clear.
- **Evidence**: concrete before/after — a failing-then-passing test or
  command run for code, quoted excerpts for docs.
- **Merge Danger**: one-way or two-way door, blast radius in one word.

Before emitting the completion signal, write the body to `pr-body.md` in
the directory named by the `OUTPUT_DIR` environment variable (`RUNNER_TEMP`
on the runner). The workflow passes that file to the draft PR verbatim; a
missing draft falls back to a canned stub and never fails the run, but a
real body is part of the deliverable.

Rules:

- The first line of the body must be exactly `Closes #{{ISSUE_NUMBER}}` —
  merging the PR closes the issue.
- Follow with the three template sections as `## Summary`, `## Evidence`,
  and `## Merge Danger`.

# COMMIT

Make one or more commits on `{{SOURCE_BRANCH}}` with conventional commit
messages.

Do not push the branch.
Do not close the issue.
Do not edit labels.
Do not create or edit PRs.

When complete, output `<promise>COMPLETE</promise>`.
