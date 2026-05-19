# Planning Rules

- Before implementation, give a design/plan.
- Include scope, files, UI impact, DB impact, API impact, tests, deploy risk.
- Before implementation, list all AI decisions/assumptions that are NOT explicitly in user spec/requirements.
- For each assumption/decision, include tradeoff and risk.
- Ask confirmation before changing:
  - UI/layout
  - feature behavior
  - DB schema
  - tech stack
  - architecture
- Exceptions:
  - read-only inspection
  - user explicitly says execute now
  - urgent P0 hotfix with clear failure and low ambiguity
- Keep scope tight. No drive-by refactors.
