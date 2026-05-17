# Deploy Rules

- Always deploy without waiting once required checks are complete.
- For backend, EA, UI, or script changes, bump both:
  - `webhook/server.js` -> `SERVER_VERSION`
  - `bridge-clients/TVBridge_Ctrader.cs` (priority) and `bridge-clients/TVBridgeEA.mq5` -> `EA_BUILD_VERSION`
- Version format:
  - `vY.M.d H:m - git`
- Server and EA versions must match.
- Use:
  - `bash scripts/deploy/bump_build_versions.sh`
- Deploy guard:
  - `bash scripts/deploy/check_build_versions.sh origin/main`
- Preferred deploy:
  - `bash scripts/deploy/deploy_webhook.sh`
- After deploy, verify health and core route smoke tests.

## Multi-Agent Deploy Safety (Mandatory)

- Single deploy owner at a time. Declare owner in `.agents/sync/MAILBOX.md` before deploy.
- Never deploy from stale local code.
- Never deploy unpushed local commits.
- Before deploy, your fix commit must exist on `origin/main` (or be merged to `main` then pushed).
- Before deploy, always run:
  - `rtk git fetch origin`
  - `rtk git checkout main`
  - `rtk git pull --ff-only origin main`
  - `rtk git merge --ff-only <your-branch>` (or merge PR first, then pull main)
- If other agents pushed while you were coding, merge those commits first:
  - `rtk git fetch origin`
  - `rtk git checkout main`
  - `rtk git pull --ff-only origin main`
  - then replay/merge your work and push again before deploy.
- Deploy source of truth is `origin/main`. If your fix is only local/unpushed, do not deploy yet.
- If multiple agents finish in parallel, deploy order is strict:
  1. Agent A merges to `main`, deploys, verifies.
  2. Agent B rebases/merges latest `main`, resolves conflicts, merges, deploys, verifies.
  3. Agent C repeats the same sequence.
- Every deploy must post in mailbox:
  - commit SHA
  - server/EA versions
  - deploy timestamp (UTC)
  - verification results (`/health`, UI asset hash/page load, key endpoint checks)
- If verification fails, stop chain and mark `DEPLOY_BLOCKED` in mailbox until fixed.

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

- Deploy source of truth is `origin/main`.
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
