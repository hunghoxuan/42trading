# Deploy Rules

Canonical deploy policy:
- Deploy source of truth is `origin/main`.
- Never deploy local-only/unpushed commits.
- Always deploy once required checks pass.
- Single deploy owner lock via `.agents/sync/MAILBOX.md`.

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

### 2) Push and integrate to main source of truth

- Required sequence:
  - `rtk git fetch origin`
  - `rtk git checkout main`
  - `rtk git pull --ff-only origin main`
  - merge/rebase your branch onto latest `main`
  - resolve conflicts
  - run required tests/smokes
  - push merged result to `origin/main`

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

### 5) Post-deploy verification and lock release

- Required verify (record actual values):
  - `/health` returns `ok:true` and expected version
  - `/ui` loads expected asset hash
  - task-specific smoke checks (example: DB search keyword regression)
- Post ledger entry with:
  - deploy commit SHA
  - version strings
  - verify evidence
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
