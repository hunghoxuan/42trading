# Ticket: Docker Staging Branch Deploy (Keep Main/Prod Stable)

## Ticket Type
- Update Feature

## Ticket Status
- Idea

## Owner
- Codex

## Updated (UTC)
- 2026-05-20 11:45 UTC

## Problem
- Current verification requires deploy on VPS, so branch testing often pressures early merge to `main`.
- Requirement: keep `main` and production VPS stable/untouched until branch is verified.
- Docker-based staging path was drafted but blocked because VPS currently has no container runtime installed.

## Investigation
- Existing deploy script (`scripts/deploy/deploy_webhook.sh`) deploys branch directly in VPS app directory and restarts production service.
- Docker draft created locally:
  - `Dockerfile.webhook`
  - `scripts/deploy/docker_build_bundle.sh`
  - `scripts/deploy/docker_deploy_staging.sh`
  - `scripts/deploy/docker_deploy_prod.sh`
- VPS checks:
  - `df -h /` => total `8.7G`, used `6.3G`, free `2.5G` (72% used)
  - `du -sh /opt/trading` => `227M`
  - biggest project dirs:
    - `/opt/trading/webhook` `88M`
    - `/opt/trading/web-ui` `72M`
- Runtime availability check:
  - `docker` not installed
  - `podman`/`nerdctl`/`docker-compose` not found

## Proposed Solution (Minimal, Non-Overkill)
- Keep production path unchanged.
- Add one isolated staging container on separate port/domain.
- Flow:
  1. Build image from branch.
  2. Deploy branch image to `webhook-staging` (example port `8081`).
  3. Verify staging health + critical flow.
  4. Merge to `main` only after pass.
  5. Promote tested tag to production.

## Disk Estimate
- Expected extra disk for first Docker rollout on this VPS:
  - Docker engine + metadata: ~`200MB` to `400MB`
  - App image layers (node runtime + webhook deps + built web-ui): ~`350MB` to `900MB`
  - Running staging container writable layer/logs: ~`50MB` to `300MB` (growth over time)
- Practical first-run budget: ~`0.8GB` to `1.6GB`.
- Current free disk: `2.5GB` => feasible but tight; cleanup policy is required.

## Go/No-Go Rule
- Go only if free disk remains `>= 1.5GB` after Docker install and first image load.
- If below threshold, do not enable Docker staging yet; use non-Docker isolated staging service as fallback.

## Expected Output / Verification
- `webhook-staging` healthy on isolated port.
- Production service unchanged during staging tests.
- Staging deploy command returns health pass.
- Promotion command uses exact tested image tag.

## Next Execution Checklist
- [ ] Install Docker on VPS.
- [ ] Add staging DNS/port route.
- [ ] Run first image build + load.
- [ ] Re-check free disk after image load.
- [ ] Run staging smoke tests.
- [ ] Document promote/rollback commands.
