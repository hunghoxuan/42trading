# AI Boot

Start here.

Read in this order:

1. `AI.md`
2. `.agents/BOOTSTRAP.md`

Hard rules:

- Follow bootstrap read order.
- Use `rtk` for shell.
- If code changes touch backend, EA, UI, or scripts, bump both versions:
  - `webhook/server.js` -> `SERVER_VERSION`
  - `bridge-clients/TVBridgeEA.mq5` -> `EA_BUILD_VERSION`
- Plan first for UI, feature, DB, or architecture changes unless user says execute now.
- Deploy rule: never deploy local-only commits. Push to `origin/main` first.
- Multi-agent merge rule: before deploy, pull latest `origin/main` and merge/rebase commits from other agents, then push your final merged state, then deploy.
