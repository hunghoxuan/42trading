# Safety Rules

- Never delete `AI.md`, `.agents/`, or `.cursorrules` unless user explicitly approves exact files.
- Never run destructive operations outside project root.
- Never revert user changes unless user asks.
- **NEVER use `git checkout` or `git revert` without explicit permission.** If a file is corrupted or needs restoration, you MUST:
  1. Tell the user what broke
  2. Explain exactly what `git checkout` will erase (uncommitted changes lost forever)
  3. Ask for explicit confirmation before running it
- Check `git status` before risky edits.
- Preserve compatibility with EA, webhook, UI, and old IDs.
- Do not expose secrets, hashes, tokens, API keys, or auth headers in UI/logs.
- Archived/old docs are not source of truth.
- Do not create new helper scripts in repo root. Put new scripts under `scripts/` (or an existing relevant subfolder) unless user explicitly requests otherwise.
- **trade_plan_schema.json is the contract. Never transform, normalize, wrap, or reshape AI responses. Store exact JSON. Read exact JSON. No middle parsing.**
