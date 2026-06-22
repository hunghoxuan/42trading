# Scripting & Test Creation Rules

When creating new scripts or tests in this project, you must follow these standards:

## 1. Bash Scripts
- Must include `set -e` (exit on error) and `set -u` (exit on undefined variables).
- Must be idempotent (safe to run multiple times without breaking state).
- Must print clear, caveman-style `echo` statements explaining each step.
- Never hardcode absolute local paths; use relative paths from the project root.
- Always resolve repo root dynamically and use root-virtual paths:
  - `ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"` (adjust depth by folder)
  - then run files as `"${ROOT_DIR}/scripts/..."`
  - do not use machine-specific paths like `/Users/...`.

## 2. Node/JS Scripts
- Safely handle database connections. Always call `pool.end()` or gracefully close connections so the script doesn't hang.
- Use environment variables for secrets and URLs. Never hardcode credentials.
- Use explicit error handling (try/catch) to prevent silent failures.
- One-off debugging or exploration scripts must live in `.local/` and should reuse a single `.local/tmp.js` scratch file when possible.
- `scripts/` is reserved for reusable system, ops, test-runner, or teammate-facing automation.
- Do not add a new file under `scripts/` unless the user explicitly asks for a reusable script and approves creating it.

## 3. Writing Tests (`tests/`)
- All new repo-level tests must live in `tests/`.
- Do not create new repo-level tests under `scripts/`.
- Do not add a new repo-level test under `tests/` unless the user explicitly asks for it and approves creating it.
- Tests must be stateless. Always clean up the database or state you create after the test runs.
- Remote API testing must rely on `curl` and strictly validate HTTP status codes.
- Tests should output clear `[PASS]` or `[FAIL]` markers.

## 4. Local Usage Docs (Mandatory)
- Whenever creating or changing scripts in a folder, ensure that folder has a `README.md` with:
  - purpose
  - how to run
  - required flags/env
  - examples
  - safety notes (if command can deploy, mutate data, or push)
- If a folder has no `README.md`, create one in the same change.
- Do not rely only on chat instructions; usage guidance must live in repository files.
