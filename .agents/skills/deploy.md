# Skill: Deployment

Use this skill to safely ship code changes to the production VPS.

## Request Template

```text
Action: Deploy
Module: (Backend/UI/Full)
Version Bump: (Patch/Minor/Major)
Environment: (Production)
```

## Operational Rules

1.  **Zero-Error Tolerance**: Never deploy if local builds or syntax checks fail.
2.  **Metadata Integrity**: Always bump the build version to ensure the dashboard reflects the latest commit.
3.  **Health Check**: Post-deployment, immediately verify the `/health` endpoint.

## Implementation Flow

1.  **Pre-Flight**:
    - Run `node --check webhook/server.js`.
    - Run `npm run build` in `web-ui/`.
2.  **Version Management**:
    - Execute `bash scripts/deploy/bump_build_versions.sh`.
3.  **Release**:
    - Commit all changes and push to the `main` branch.
    - The GitHub Action will trigger the webhook deployment.
4.  **Verification**:
    - Access the live URL and check the footer/about section for the correct commit hash.
    - Verify that no new errors appear in the server `logs` table.

## Verification Checklist
- [ ] Local build passed.
- [ ] Versions bumped and committed.
- [ ] VPS /health returns 200 OK.
- [ ] Dashboard shows correct build ID.

## Local Restart Runbook (Webhook)

Use this when local webhook is flaky or after backend edits.

1. Preferred full stack reset (`3001` first, then `3000`):
```bash
bash scripts/start/reset_stack_once.sh
```
2. Webhook-only restart:
```bash
bash scripts/start/restart_webhook.sh manual
bash scripts/test/verify_webhook_local.sh
```

Rule: prefer health-check scripts over browser checks for backend restart verification.
