# tenderagent

Label-driven agent automation: triaged leaf issues are implemented and reviewed by AFK agents in GitHub Actions, and a deterministic merge gate merges two-way-door PRs or holds the rest for a human — humans triage and review, the gate and the human share the merge.

See [GLOSSARY.md](./GLOSSARY.md) for the automation vocabulary.

## Setup

```bash
npm install
npm test
```

The root package is scoped to CI tooling only (Sandcastle, tsx, zod, vitest, TypeScript) — application code lands with the monorepo scaffold.
