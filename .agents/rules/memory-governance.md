# Memory Governance Rules

- Ownership model:
  - `raw` (`.agents/raw/`) is user-owned input memory. AI does not edit user raw records unless explicitly asked.
  - `wiki` (`.agents/wiki/`) is AI-owned distilled memory. AI may create/update/prune wiki docs.
  - Other `.agents/*` folders are flexible and updated only when task requires.

- What belongs in `raw`:
  - user notes/transcripts
  - unprocessed dumps
  - append-only incident/debug captures

- What belongs in `wiki`:
  - distilled runbooks
  - stable decisions and architecture notes
  - normalized enums/contracts
  - recurring error patterns with prevention

- Wiki quality bar:
  - short, deduplicated, actionable
  - no active task tracking (that goes in `plans/`)
  - no secrets
  - avoid giant raw catalogs; summarize and link instead

- AI auto-maintenance behavior for `wiki`:
  - update after meaningful fixes, deploy changes, or durable learnings
  - merge duplicate docs
  - archive or remove stale pages that conflict with current architecture/rules
  - keep operational context rebuildable from canonical sources such as `.agents/sync/MAILBOX.md` and current rules/docs
