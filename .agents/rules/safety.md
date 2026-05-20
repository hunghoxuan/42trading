# Safety Rules

- Never delete `AI.md`, `.agents/`, or `.cursorrules` unless user explicitly approves exact files.
- Never run destructive operations outside project root.
- Never revert user changes unless user asks.
- Check `git status` before risky edits.
- Preserve compatibility with EA, webhook, UI, and old IDs.
- Do not expose secrets, hashes, tokens, API keys, or auth headers in UI/logs.
- Archived/old docs are not source of truth.
- Do not create new helper scripts in repo root. Put new scripts under `scripts/` (or an existing relevant subfolder) unless user explicitly requests otherwise.
- **trade_plan_schema.json is the contract. Never transform, normalize, wrap, or reshape AI responses. Store exact JSON. Read exact JSON. No middle parsing.**
