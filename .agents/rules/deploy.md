# Deploy Rules

- For backend, EA, UI, or script changes, bump both:
  - `webhook/server.js` -> `SERVER_VERSION`
  - `bridge-clients/TVBridgeEA.mq5` -> `EA_BUILD_VERSION`
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
