# Deploy Rules

Canonical deploy policy:
- Deploy source of truth is `origin/main`.
- Never deploy local-only/unpushed commits.
- Single deploy owner lock via `.agents/sync/MAILBOX.md`.
- Never auto-deploy branch or prod without explicit user command.

## Deploy Modes (Explicit User Choice Required)

### A) `deploy branch` skill (staging/isolation)

- Purpose: deploy one branch to isolated staging runtime.
- Must ask user first: `deploy branch now?`
- Must NOT touch prod `main` runtime/process.
- Use branch-isolated flow/script:
  - `scripts/deploy/deploy_branch_staging.sh`
- Verify staging only (staging port/domain health + smoke checks).
- Report branch, PM2 process, port/domain, verify result.

### B) `deploy` skill (prod/main)

- Purpose: deploy production from `origin/main`.
- Must ask user first: `deploy main/prod now?`
- Before deploy, merge all pending branches into `main` (user-approved scope).
- Do not skip pending-branch audit:
  - list remote branches except `main`
  - classify merged vs not merged into `main`
  - present list to user
  - merge only user-approved pending branches
- Required merge approval table before merge:
  - `branch | merged? | last_commit | ahead/behind vs main | selected_for_merge`
  - Wait for explicit user approval of merge set.
- Only after merge + checks + push, deploy prod.

## Multi-Agent Commit/Merge/Deploy SOP (Mandatory, No Exceptions)

### 0) Acquire deploy lock first

- In `.agents/sync/MAILBOX.md`, set:
  - `lock_status: LOCKED`
  - `deploy_owner: <agent-name>`
  - `since_utc: <YYYY-MM-DD HH:mm UTC>`
  - `note: <scope>`
- If lock is already `LOCKED` by another agent, do not deploy.

### 1) Commit your own work first

- Never deploy uncommitted changes.
- Create explicit commits for your scope before any merge/deploy.
- Keep commit messages scoped (one feature/fix per commit when possible).
- Commit message must be prefixed with AI agent name.
  - Required format: `<agent-name>: <message>`
  - Example: `codex: fix(ui): align chart object toolbar`

### 2) Push and integrate to main source of truth

- Required sequence:
  - `rtk git fetch origin`
  - `rtk git checkout main`
  - `rtk git pull --ff-only origin main`
  - merge/rebase your branch onto latest `main`
  - resolve conflicts
  - run required tests/smokes
  - push merged result to `origin/main`
- For prod deploy, include pending-branch audit before final push/deploy:
  - `git ls-remote --heads origin`
  - compare each branch against `origin/main` merge state
  - avoid re-merging already merged branches

### 3) Verify no missing teammate fixes before deploy

- Read latest mailbox entries and list critical recent fixes.
- For each critical fix, verify commit SHA is reachable from `HEAD`:
  - `rtk git merge-base --is-ancestor <sha> HEAD`
- If any critical SHA is missing: stop, merge it, re-test, then continue.

### 4) Version bump + deploy

- If backend/EA/UI/scripts changed:
  - run `bash scripts/deploy/bump_build_versions.sh`
  - commit bump
  - push to `origin/main`
  - version format: `vY.M.d H:m - git`
  - server/EA versions must match
- Then deploy:
  - `bash scripts/deploy/check_build_versions.sh origin/main`
  - `bash scripts/deploy/deploy_webhook.sh`
- Do not run this step unless user explicitly requested prod deploy.
- Prod deploy promotion rule:
  - deploy commit SHA must match staging-validated SHA unless user explicitly approves exception.

### 5) Post-deploy verification and lock release

- Required verify (record actual values):
  - `/health` returns `ok:true` and expected version
  - `/ui` loads expected asset hash
  - task-specific smoke checks (example: DB search keyword regression)
- Post ledger entry with:
  - deploy commit SHA
  - version strings
  - verify evidence
  - rollback commit SHA
  - rollback command
  - PASS/FAIL
- Set lock back to:
  - `lock_status: UNLOCKED`
  - `deploy_owner: NONE`

### 6) Failure handling

- If deploy or verify fails:
  - set status `DEPLOY_BLOCKED`
  - keep lock with failing owner until rollback/fix is complete
  - post blocker + next action in mailbox
  - no next deployer may proceed

## Branch Naming Rule

- For coding work, create branch with agent prefix + short description:
  - `codex/<agent>/<short-desc>`
- Example:
  - `codex/codex/chart-objects-save-buttons`

## Staging Data Isolation Rule

- Branch staging deploy must use isolated runtime data by default:
  - separate DB/schema or dedicated staging DB
  - separate Redis DB index or key prefix namespace
- Shared prod-like data is allowed only with explicit user approval.
