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

# COMMIT

Make one or more commits on `{{SOURCE_BRANCH}}` with conventional commit
messages.

Do not push the branch.
Do not close the issue.
Do not edit labels.
Do not create or edit PRs.

When complete, output `<promise>COMPLETE</promise>`.
