# tenderagent

Label-driven agent automation: triaged leaf issues are implemented and reviewed by AFK agents in GitHub Actions; humans triage, review, and merge. AFK agents implement triaged leaf issues.

See [GLOSSARY.md](./GLOSSARY.md) for the automation vocabulary.

## Setup

```bash
npm install
npm test
```

The root package is scoped to CI tooling only (Sandcastle, tsx, zod, vitest, TypeScript) — application code lands with the monorepo scaffold.
