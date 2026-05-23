# Temp File Rules

## Designated Temp Folder
- All AI-generated temp/scratch/experimental files MUST go into `.local/`.
- This includes: one-off scripts, test snippets, debugging patches, refactor drafts, exploration output, logs, test results.
- Do NOT create temp files in root, `scripts/`, `webhook/`, `web-ui/`, or any production directory.

## Lifecycle
- Files in `.local/` are ephemeral and can be deleted at any time.
- Never import or reference `.local/` files from production code (`webhook/`, `web-ui/`, etc.).
- `.local/` is gitignored — never commit it.

## Purpose
- Keeps the repo clean.
- Makes it obvious which files are AI-generated drafts vs real code.
- Prevents accidental breakage from stale experimental changes.
