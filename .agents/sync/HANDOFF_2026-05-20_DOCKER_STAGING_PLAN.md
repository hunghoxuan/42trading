# Handoff: Docker Staging Plan (Branch Verification Without Touching Prod)

## Date (UTC)
- 2026-05-20 11:45 UTC

## Context
- User requires `main` + production VPS to stay stable and untouched during branch testing.
- Docker deploy attempt blocked by missing container runtime on VPS.

## What Exists Already
- `Dockerfile.webhook`
- `scripts/deploy/docker_build_bundle.sh`
- `scripts/deploy/docker_deploy_staging.sh`
- `scripts/deploy/docker_deploy_prod.sh`

## VPS Facts
- Disk: `8.7G` total, `6.3G` used, `2.5G` free.
- App size: `/opt/trading` is `227M`.
- Large dirs:
  - `/opt/trading/webhook` `88M`
  - `/opt/trading/web-ui` `72M`
- Runtime: Docker/Podman/Nerdctl not installed.

## Estimated Extra Disk for Docker Staging
- First rollout expected: `0.8G` to `1.6G` additional.
- Safe threshold after first image load: keep free disk `>= 1.5G`.

## Execute Later (Minimal)
1. Install Docker on VPS.
2. Build image bundle locally from target branch.
3. Deploy to staging container on isolated port (`8081`).
4. Verify `/health` + one critical flow.
5. Only then merge to `main`.
6. Promote exact tested image tag to production.

## Suggested Verification Commands
```bash
df -h /
du -sh /opt/trading
curl -fsS http://139.59.211.192:8081/health
```
