# AI Boot

Start here.

Read in this order:

1. `AI.md`
2. `.agents/BOOTSTRAP.md`

Hard rules (canonical):

- Follow bootstrap read order.
- Use `rtk` for shell.
- AI raw JSON integrity rule (mandatory):
  - Keep exact AI `trade_plan` item JSON as source-of-truth in `raw_json`.
  - Do not overwrite or reshape away original `trade_plan` objects.
  - Any normalized/mapped fields are compatibility-only views and must not replace preserved raw plan payload.
- Plan first for UI, feature, DB, or architecture changes unless user says execute now.
- Default routing rule: when user does not name a skill, use `.agents/skills/unified-task-router.md` to auto-detect intent and route workflow/ticketing/deploy/handoff.

Delegated rules (do not duplicate elsewhere):
- Deploy/version/lock SOP: `.agents/rules/deploy.md`
- Safety/compatibility: `.agents/rules/safety.md`
- UI-specific workflow + screenshot policy: `.agents/rules/ui.md`
