# Ticket: Branch-Isolated Staging Deploy + Nginx Routing

Date: 2026-05-21  
Owner Agent: Codex
Branch: main (implementation requested directly in current branch)
Status: IN_PROGRESS

## Goal

Enable separate branch testing on VPS without touching `main`/prod by deploying a branch to an isolated app directory + PM2 process + dedicated port, then routing via Nginx.

## Understanding

- You want branch-safe testing so code can be verified before merging to `main`.
- You do **not** want duplicate server entry files like `server-{branch}.js`.
- You want explicit operational guidance and reusable deploy commands.

## Assumptions

1. PM2 is available on VPS and used for runtime process management.
2. Nginx is available or can be updated on VPS.
3. Staging branch traffic can use either:
   - subdomain (recommended), or
   - path prefix proxy.
4. We can keep the same Node entrypoint (`webhook/server.js`) and isolate by env+port+directory.

## Scope

- Add a branch-staging deploy script:
  - `scripts/deploy/deploy_branch_staging.sh`
- Add Nginx config example:
  - `scripts/deploy/nginx_branch_staging.conf.example`
- Add handoff document for continuation/delegation:
  - `.agents/sync/HANDOFF_2026-05-21_BRANCH_STAGING_DEPLOY.md`
- Update rules for handoff/report requirements (requested workflow update).

## Non-Goals

- No production cutover changes.
- No destructive infra changes.
- No automatic merge to `main`.

## Risks / Tradeoffs

- Path-prefix proxy (`/branch/`) can be trickier if app assumes root paths.
- Subdomain proxy is cleaner and safer for frontend assets.
- Separate staging DB/redis is safer than shared state; if shared, use explicit namespace discipline.

## Acceptance

1. Script can deploy any branch to isolated VPS dir/process/port.
2. Script does not modify prod process.
3. Nginx example clearly maps branch route to staging port.
4. Handoff includes: git branch, agent name, done/remain, continuation steps.

