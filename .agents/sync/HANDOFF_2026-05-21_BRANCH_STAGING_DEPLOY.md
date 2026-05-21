# HANDOFF: Branch-Isolated Staging Deploy

Date: 2026-05-21  
AI Agent: Codex  
Git Branch: main  
Ticket: `.agents/.product/tickets/1-backlog/2026-05-21-branch-isolated-staging-deploy-and-nginx-routing.md`

## What's Done

1. Added staging deploy script:
   - `scripts/deploy/deploy_branch_staging.sh`
2. Added Nginx routing example:
   - `scripts/deploy/nginx_branch_staging.conf.example`
3. Updated team rules:
   - `.agents/rules/handoff.md`
   - `.agents/rules/communication.md`

## What's Remaining

1. Make script executable in repo:
   - `chmod +x scripts/deploy/deploy_branch_staging.sh`
2. Configure real staging domain and TLS cert in Nginx.
3. Dry-run one branch deploy on VPS and validate:
   - branch app dir
   - PM2 process name
   - local VPS health on staging port
4. Optional: add a cleanup script for old staging instances.

## Continuation Instructions

1. Read ticket first:
   - `.agents/.product/tickets/1-backlog/2026-05-21-branch-isolated-staging-deploy-and-nginx-routing.md`
2. Execute script for test branch:
   - `BRANCH=<branch> STAGING_PORT=<port> VPS_HOST=<host> bash scripts/deploy/deploy_branch_staging.sh`
3. Add Nginx server block from example and reload Nginx.
4. Verify:
   - `curl http://127.0.0.1:<port>/health` (on VPS)
   - public staging URL `/health`
5. Report with:
   - git branch
   - done/remain
   - change from requirement
   - deploy status
   - expected version

## Deploy Status

- Not deployed by this handoff package (docs/scripts only).
- Expected build version: N/A.

