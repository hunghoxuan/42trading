# Rules

## Boot Rules

- None.
- Use `.agents/BOOTSTRAP.md` only.

## Read Only When Task Needs It

- UI: `rules/ui-rules.md`

## Global Law

- Keep context small.
- Read only task-needed docs.
- Test real code changes.
- Do not break user behavior.
- Keep repo root and `scripts/` clean: temp/scratch files belong in `.local/`.
- Do not add new files under `scripts/` or `tests/` unless the user explicitly asks for them and approves that addition.
- If a file is created mainly for AI scratch work, one-off investigation, or unclear personal utility, place it under `.local/`.
