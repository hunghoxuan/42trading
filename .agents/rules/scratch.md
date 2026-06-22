# Temp File Rules

## Designated Temp Folder
- All AI-generated temp/scratch/experimental files MUST go into `.local/`.
- This includes: one-off scripts, test snippets, debugging patches, refactor drafts, exploration output, logs, test results.
- Do NOT create temp files in root, `scripts/`, `webhook/`, `src/ui/`, or any production directory.
- For temp scripts, reuse one canonical scratch file in `.local/` instead of creating multiple siblings.
- Preferred names:
  - `.local/tmp.js`
  - `.local/tmp.sh`
  - `.local/tmp.py`
- Overwrite or repurpose the existing `.local/tmp.*` file when the old scratch logic is no longer needed.
- Do NOT create ad-hoc root files like `tmp_*.js`, `debug_*.js`, `check_*.js`, or topic-specific scratch files in `scripts/`.

## `scripts/` Folder Boundary
- `scripts/` is only for important, reusable, team-facing, or system/ops scripts.
- If a script is one-off, exploratory, temporary, or only useful for a single debugging session, it does not belong in `scripts/`; put it in `.local/`.
- Before adding a new script under `scripts/`, ask: "Will another agent or teammate intentionally run this again?" If not, keep it in `.local/`.

## Lifecycle
- Files in `.local/` are ephemeral and can be deleted at any time.
- Never import or reference `.local/` files from production code (`webhook/`, `src/ui/`, etc.).
- `.local/` is gitignored — never commit it.

## Purpose
- Keeps the repo clean.
- Makes it obvious which files are AI-generated drafts vs real code.
- Prevents accidental breakage from stale experimental changes.
