# Multi-Agent Deployment Ledger (Read First)

Use this section for parallel-agent safety and deploy ordering.

## Refresh Context Checklist (All Agents)

- Read in order:
  1. `AI.md`
  2. `.agents/BOOTSTRAP.md`
  3. `.agents/rules/deploy.md` (especially: "Multi-Agent Commit/Merge/Deploy SOP")
  4. `.agents/sync/MAILBOX.md` (current lock + latest deploy entries)
- If deploying, acquire lock first. No lock = no deploy.

- lock_status: `LOCKED`
- deploy_owner: `DeepSeek`
- since_utc: `2026-05-21 16:00 UTC`
- note: `snapshot status display - show master vs individual TFs`

### [2026-05-21 15:51 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 2d53e4cb
- scope: `planEntryNumber/planStopLossNumber: add execution_plan.entry & execution_plan.stop_loss as direct-number fallback + direction fallback from execution_plan.direction + debug log`
- merge_to_main: YES (2d53e4cb)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 15:46 - 0c7b6519
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 15:46 - 0c7b6519, postgres: ok, redis: ok, mt5: connected
  - /ui: serves
  - web-ui build: PASS
- rollback: `git revert 2d53e4cb 0c7b6519 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 15:32 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: b9263f97
- scope: `ChartSnapshots: robust entry/sl extraction + wire onPlanLevelChange from chart context/drag + pass tp1/tp2/tp3 into SignalDetailCard chart`
- merge_to_main: YES (b9263f97)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 15:27 - 35d649e8
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 15:27 - 35d649e8, postgres: ok, redis: ok, mt5: connected
  - /ui: asset `/assets/index-S1O_CKX0.js` loaded
  - web-ui build: PASS
- rollback: `git revert b9263f97 35d649e8 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 15:06 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 283bb486
- scope: `ChartSnapshotsPage entry/sl fallback hydration from execution_plan + TP2/TP3 pass-through to chart + auto-hydrate guard`
- merge_to_main: YES (283bb486)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 15:01 - 0f2eabf0
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 15:01 - 0f2eabf0, postgres: ok, redis: ok, mt5: connected
  - /ui: asset `/assets/index-xhS_ZEwp.js` loaded
  - web-ui build: PASS
- rollback: `git revert 283bb486 0f2eabf0 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 14:31 UTC] AGENT:DeepSeek
- status: DEPLOYED
- commit: 1047429b
- scope: `callAiProvider apiKey param — use caller-validated key instead of CFG.mt5DefaultUserId`
- server_version: v2026.05.21 14:30 - 1047429b
- verify: /health ok:true, version matches, postgres: ok, redis: ok, mt5: connected
- result: PASS
- rollback: `git revert 4bcba94f 1047429b && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 15:12 UTC] AGENT:DeepSeek
- status: DEPLOYED
- commit: f1795663
- scope: `entry=0 fix — __raw_plan: plan?.raw || plan`
- server_version: v2026.05.21 14:26 - 80c8bde3
- verify: /health ok:true, version matches
- result: PASS
- rollback: `git revert f1795663 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`
- note: `deployed files tab snapshots + TP2/TP3 chart + edit persistence regression fix at 17b231c`

### [2026-05-21 14:12 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 17b231c7
- scope: `Files tab snapshot traceability, TP2/TP3 chart overlays, plan edit persistence, version bump`
- merge_to_main: YES (17b231c7)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 14:05 - f438601f
  - ea_version: v2026.05.21 14:05 - f438601f
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 14:05 - f438601f, postgres: ok, redis: ok, mt5: connected
  - /ui: loads asset /assets/index-DHz91l0N.js
  - VPS git HEAD: 0c8d320 (ledger-only fast-forward after deploy; runtime version remains v2026.05.21 14:05 - f438601f)
  - PM2 webhook: online pid 2559647
- rollback: `git revert 17b231c7 f438601f && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 13:42 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: ffd30949
- scope: `config/guide_system.md execution_plan ordering + snapshots/files parser follow-up ticket + version bump`
- merge_to_main: YES (ffd30949)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 13:36 - 06465d80
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 13:36 - 06465d80
  - VPS git HEAD: ffd3094
  - postgres: ok, redis: ok, mt5: connected
- rollback: `git revert ffd30949 06465d80 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 13:18 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: b0761783
- scope: `SignalDetailCard json-tab canonical payload precedence fix + ticket status update`
- merge_to_main: YES (b0761783)
- deploy:
  - owner: Codex
  - server_version: v2026.05.21 13:15 - b0761783
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 13:15 - b0761783
  - postgres: ok, redis: ok, mt5: connected
- rollback: `git revert b0761783 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 14:45 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: d46d5a03
- scope: `SignalDetailCard.jsx, ChartSnapshotsPage.jsx, config/schema_enums.json v3.1, config/guide_system.md, ticket trackers`
- merge_to_main: YES (d46d5a03)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.21 12:45 - d46d5a03
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 12:45 - d46d5a03
  - postgres: ok, redis: ok, mt5: connected
- rollback: `git revert d46d5a03 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 11:14 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: 236deb7b
- version: v2026.05.21 11:13 - 3b562780
- scope: multi-tradeplan card overlap fix, selection reset fix, snapshot traceability UI
- verify: health ok, UI 200, PM2 online
- rollback: 24362836
- rollback_cmd: ssh root@139.59.211.192 "cd /opt/trading && git checkout 24362836 && pm2 restart webhook"

### [2026-05-21 11:10 UTC] AGENT:DeepSeek
- status: DEPLOYED (lock cleanup)
- branch: main
- commit: 24362836
- scope: `snapshot settings, save button, annotation fixes, info chart TP drag/labels, deploy scripts, rules`
- merge_to_main: YES (24362836)
- deploy:
  - owner: DeepSeek (previous session)
  - server_version: v2026.05.21 10:30 - 1dc5d07f
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 10:30 - 1dc5d07f
- rollback: `git revert 24362836 && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 09:58 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: d248ba6b
- scope: `ANALYSE_SETTINGS load key items→settings`
- merge_to_main: YES (d248ba6b)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.21 09:55 - 96275cef
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 09:55 - 96275cef
- rollback: `git revert d248ba6b && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 09:32 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: c64997bf
- scope: `analyze page Save button toast + inline status`
- merge_to_main: YES (c64997bf)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.21 09:31 - 5b4fd7e7
  - result: PASS
- verify:
  - /health: ok:true, version v2026.05.21 09:31 - 5b4fd7e7
- rollback: `git revert c64997bf && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-21 09:25 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: 8645b8cd
- scope: `save config + TP1 primary + merge_snapshots + plan edit fixes`
- merge_to_main: YES (8645b8cd)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.21 09:24 - 5ee50df2
  - result: PASS
- verify:
  - /health: ok:true, version matches
  - /ui: loads, 200
- rollback: `git revert 8645b8cd && git push && ssh root@139.59.211.192 "cd /opt/trading && git pull --ff-only origin main && pm2 restart webhook"`

### [2026-05-20 19:09 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 0f11c6d1
- scope: `web-ui/src/components/SignalDetailCard.jsx`
- merge_to_main: YES (0f11c6d1)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 15:35 - 8fe81d8f
  - ea_version: v2026.05.20 15:35 - 8fe81d8f
  - result: PASS
- verify:
  - VPS git HEAD: `0f11c6d`
  - PM2 webhook: online after restart
  - health: `https://trade.mozasolution.com/health` => `ok:true`
- handoff_next: none

### [2026-05-20 16:44 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 3b0e1d77
- scope: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/styles.css`
- merge_to_main: YES (3b0e1d77)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 15:35 - 8fe81d8f
  - ea_version: v2026.05.20 15:35 - 8fe81d8f
  - result: PASS
- verify:
  - VPS git HEAD: `3b0e1d7`
  - PM2 webhook: online after restart
  - health: `https://trade.mozasolution.com/health` => `ok:true`
- handoff_next: none

### [2026-05-20 15:41 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 4383e2d3
- scope: `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (8fe81d8f, 4383e2d3)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 15:35 - 8fe81d8f
  - ea_version: v2026.05.20 15:35 - 8fe81d8f
  - result: PASS
- verify:
  - VPS git HEAD: `4383e2d`
  - PM2 webhook: online; restart loop resolved
  - health: `https://trade.mozasolution.com/health` => `ok:true`, version `v2026.05.20 15:35 - 8fe81d8f`
- handoff_next: continue pending UI requests

### [2026-05-20 15:32 UTC] AGENT:Codex
- status: DEPLOY_BLOCKED
- branch: main
- commit: 151cbfc2
- scope: `web-ui/src/components/SignalDetailCard.jsx`, version bump files
- merge_to_main: YES (151cbfc2)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 15:29 - 03c7703e
  - ea_version: v2026.05.20 15:29 - 03c7703e
  - result: FAIL
- verify:
  - VPS git HEAD: `151cbfc`
  - PM2 webhook: restart loop (`↺` rapidly increasing, uptime few seconds)
  - error: `TypeError: Cannot read properties of null (reading 'log')` at `_mt5InitBackendInternal` in `webhook/server.js`
  - health: port 80/443 not reachable from runner and localhost checks fail while process flaps
- handoff_next: immediate hotfix/rollback before any new deploy

### [2026-05-20 15:11 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 8f2d39c2
- scope: `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/hooks/useChartTileData.js`, `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/styles.css`, version bump files
- merge_to_main: YES (8f2d39c2)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 15:07 - c7610759
  - ea_version: v2026.05.20 15:07 - c7610759
  - result: PASS
- verify:
  - VPS git HEAD: `8f2d39c`
  - PM2: `webhook` online after restart (uptime reset observed)
  - health endpoint: localhost HTTP redirects to HTTPS (`/health`), service responding
- handoff_next: none

### [2026-05-20 14:20 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: 171b9f54
- scope: `webhook/server.js`, `web-ui/src/pages/system/LogsPage.jsx`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`, DB migration (logs table: content, updated_at, idx_logs_trace)
- merge_to_main: YES (171b9f54)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.20 14:12 - 0e5a9adc
  - ea_version: v2026.05.20 14:12 - 0e5a9adc
  - result: PASS
  - note: VPS DB missing content/updated_at columns - added post-deploy. Web-ui rebuilt + PM2 restarted.
- verify:
  - VPS git HEAD: 171b9f54
  - PM2: webhook online
  - DB: logs table has content, updated_at columns; trace entries flowing (TRADE traces with content)
  - UI: LogsPage rebuilt (LogsPage-BpPYsizY.js), TRACE LOG rendering
- handoff_next: none

### [2026-05-20 14:06 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: f02024ff
- scope: `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`, `.agents/sync/MAILBOX.md`, version bump files
- merge_to_main: YES (f02024ff)
- deploy:
  - owner: Codex
  - server_version: v2026.05.20 14:01 - 16d53cc4
  - ea_version: v2026.05.20 14:01 - 16d53cc4
  - result: PASS
- verify:
  - VPS git HEAD: `f02024f`
  - PM2: `webhook` online (uptime after restart observed)
  - `/health`: redirect confirmed on localhost; HTTPS health probe from current environment timed out
- handoff_next: optional follow-up health/version check from VPS shell if strict endpoint evidence is required

### [2026-05-20 13:42 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: f4018f71
- scope: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- merge_to_main: YES (f4018f71)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.20 13:42 - 7b0f8236
  - ea_version: v2026.05.20 13:42 - 7b0f8236
  - result: PASS
  - note: Built locally then rsynced
- verify:
  - /health: `ok:true`, version `v2026.05.20 13:42 - 7b0f8236`
  - UI: new asset `ChartSnapshotsPage-Cd0Z2nUr.js` (200)
- handoff_next: none


### [2026-05-20 11:55 UTC] AGENT:Codex
- status: HANDOFF_READY
- branch: main
- commit: none
- scope: `.agents/.product/tickets/1-backlog/plan-update-feature-ai-info-density-color-coding-and-object-labeling.md`, `.agents/sync/HANDOFF_2026-05-20_AI_INFO_DENSITY_COLOR_LAYOUT_LABELS.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - planning only; no runtime/code deployment performed
  - screenshot-driven requirements captured for screens 1-5
- handoff_next: implementation agent for web-ui layout/color/label pass

### [2026-05-20 11:45 UTC] AGENT:Codex
- status: HANDOFF_READY
- branch: main
- commit: none
- scope: `Dockerfile.webhook`, `scripts/deploy/docker_build_bundle.sh`, `scripts/deploy/docker_deploy_staging.sh`, `scripts/deploy/docker_deploy_prod.sh`, `.agents/.product/tickets/0-ideas/2026-05-20-docker-staging-branch-deploy.md`, `.agents/sync/HANDOFF_2026-05-20_DOCKER_STAGING_PLAN.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - VPS disk: `8.7G total / 6.3G used / 2.5G free`
  - `/opt/trading` size: `227M`
  - runtime availability: `docker/podman/nerdctl/docker-compose` not installed
- handoff_next: install container runtime on VPS, then execute staging-only Docker flow

### [2026-05-20 09:28 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: b1b00a3c
- scope: `web-ui/src/pages/settings/SettingsPage.jsx`
- merge_to_main: YES (b1b00a3c)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.20 09:19 - b1b00a3c
  - ea_version: v2026.05.20 09:15 - 39bcbed5
  - result: PASS
  - note: Built locally then rsynced (VPS OOM on vite build)
- verify:
  - /health: `ok:true`, version `v2026.05.20 09:19 - b1b00a3c`
  - UI: `/ui/index.html` loads, new asset `SettingsPage-aHc19exY.js`
  - key endpoint: N/A (UI-only change)
- handoff_next: none

## Required Entry Template
...
### [2026-05-16 15:08 UTC] AGENT:Antigravity
- status: DEPLOYED
- branch: main
- commit: 226cd3f
- scope: `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/components/modals/TradingViewLoginModal.jsx`, `webhook/server.js`
- merge_to_main: YES (226cd3f)
- deploy:
  - owner: Antigravity
  - server_version: v2026.05.16 15:07 - 06730ae4
  - ea_version: v2026.05.16 15:07 - 06730ae4
  - result: PASS
- verify:
  - /health: remote check timed out, but PM2 logs show success
  - UI asset: /assets/index-Gybg9axs.js
  - key endpoint: POST /v2/tv/login implemented
- handoff_next: none

### [2026-05-19 17:12 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 47f1eae2
- scope: `web-ui/src/pages/system/LogsPage.jsx`, `webhook/server.js`, `.agents/sync/HANDOFF_2026-05-19_AI_SCHEMA_ARRAY_LOGGING_FINAL.md`
- merge_to_main: YES (47f1eae2)
- deploy:
  - owner: Codex
  - server_version: v2026.05.19 10:45 - 1a183823 (health tag stale)
  - ea_version: unchanged
  - result: PASS
- verify:
  - /health: `ok:true`
  - /ui asset: `/assets/index-BJjEuy00.js`
  - key endpoint: `/v2/chart/snapshots/analyze` flow updated; AI auto-save stores direct plan object in `raw_json`
  - task-specific: Logs page now exposes `AI_RESPONSE` type filter
- handoff_next: verify DB rows from one fresh analyze call (`raw_json` direct plan object, no wrapper)

### [2026-05-19 17:42 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: 190c00ff
- scope: `webhook/server.js`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/services/TradePlanSchema.js`, `web-ui/src/utils/signalDetailUtils.jsx`, `web-ui/tests/unit/tradePlanSchema.test.mjs`, `scripts/deploy/bump_build_versions.sh`, bridge build versions
- merge_to_main: YES (190c00ff)
- deploy:
  - owner: Codex
  - server_version: v2026.05.19 17:35 - 47f1eae2
  - ea_version: v2026.05.19 17:35 - 47f1eae2
  - result: PASS
- verify:
  - local: `rtk node --check webhook/server.js`, `rtk npm --prefix web-ui run test:unit`, `rtk npm --prefix web-ui run build`, `rtk bash scripts/deploy/check_build_versions.sh origin/main`
  - deploy: VPS git ref repaired, `/opt/trading` at `190c00f`, PM2 `webhook` restarted, remote web-ui built asset `/assets/index-DIFoUoD1.js`
  - /health: `ok:true`, `version:v2026.05.19 17:35 - 47f1eae2`, `postgres:ok`, `redis:ok`, `uiRoot:html`
  - /ui asset: `/assets/index-DIFoUoD1.js`, `/assets/index-DpDVeVav.css`
  - key endpoint: `/system/logs/609933` returned HTTP 200 HTML shell; Logs page route available behind UI app
- handoff_next: none

Copy and fill:

```md
### [YYYY-MM-DD HH:mm UTC] AGENT:<name>
- status: DOING | DONE | DEPLOYED | DEPLOY_BLOCKED
- branch: <branch>
- commit: <sha>
- scope: <files/modules>
- merge_to_main: NO | YES (sha)
- deploy:
  - owner: <name>
  - server_version: <value>
  - ea_version: <value>
  - result: PASS | FAIL
- verify:
  - /health:
  - /ui asset:
  - key endpoint:
- handoff_next: <agent/none>
```

## Parallel Agents Rule (A -> B -> C)

- Agent A merge -> deploy -> verify -> post ledger.
- Agent B must pull latest main after A deploy, then merge/deploy/verify.
- Agent C repeats only after B posts success.

### [2026-05-19 10:05 UTC] AGENT:Codex
- status: HANDOFF_READY
- branch: main
- commit: none
- scope: `.agents/.product/tickets/1-backlog/plan-fix-bug-ai-header-and-tradeplan-layout-regression.md`, `.agents/sync/HANDOFF_2026-05-19_AI_HEADER_TRADEPLAN_REGRESSION.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - regression provenance confirmed from commit `81bf521e` (Analyze replacement)
  - screenshot requirements mapped to executable UI tasks
- handoff_next: execution agent to implement ticket and run web-ui build + manual parity checks

### [2026-05-19 09:27 UTC] AGENT:Codex
- status: DEPLOYED
- branch: main
- commit: d8af2a29
- scope: `web-ui/src/App.jsx`, `webhook/server.js` (+ required build version files)
- merge_to_main: YES (d8af2a29)
- deploy:
  - owner: Codex
  - server_version: v2026.05.19 09:21 - 81bf521e
  - ea_version: v2026.05.19 09:21 - 81bf521e
  - result: PASS
- verify:
  - /health: `ok:true`, `uiRoot:html`, `version:v2026.05.19 09:21 - 81bf521e`
  - /health diagnostics: `diagnostics.root_checks.public_trade_mozasolution_com.mode=html`, `diagnostics.cron` present with config/runtime fields
  - /ui asset: `/assets/index-BctxFqhZ.js`, `/assets/index-DpDVeVav.css`
- handoff_next: none

### [2026-05-19 09:28 UTC] AGENT:Codex
- status: DONE
- branch: main
- commit: none
- scope: `webhook/server.js` health diagnostics consolidation
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - `rtk node --check webhook/server.js` PASS
  - `/health` payload extended with diagnostics block (local/public root checks + cron diagnostics + endpoint summary)
- handoff_next: optional deploy + live `/health` verification

### [2026-05-19 09:08 UTC] AGENT:Codex
- status: DONE
- branch: main
- commit: none
- scope: `web-ui/src/App.jsx`, `.agents/.product/tickets/1-backlog/done-fix-bug-session-clock-timezone-toggle-not-switching.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - root-cause confirmed in App timezone precedence
  - `rtk npm --prefix web-ui run build` PASS
- handoff_next: optional UI manual click verification + deploy

### [2026-05-19 08:55 UTC] AGENT:Codex
- status: HANDOFF_READY
- branch: main
- commit: none
- scope: `.agents/.product/tickets/1-backlog/plan-update-feature-ai-analyze-trade-nav-and-quick-direction.md`, `.agents/.product/tickets/1-backlog/plan-extend-feature-trade-ui-static-chart-close-snapshot-and-objects.md`, `.agents/sync/HANDOFF_2026-05-19_AI_TRADE_UI_AND_SNAPSHOT_OBJECTS.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - screenshot requirements translated into explicit execution tasks + checks
  - handoff file prepared for next implementation agent
- handoff_next: implementation agent should claim ownership then execute both tickets

### [2026-05-19 06:32 UTC] AGENT:Codex
- status: DONE
- branch: main
- commit: none
- scope: `web-ui/src/utils/signalDetailUtils.jsx`, `web-ui/src/components/TradePlanEditor.jsx`, `.agents/.product/tickets/1-backlog/done-fix-bug-rr2-rr3-entry-tp-sl-drift.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - screenshot issue reproduced by analysis: SELL with `SL < Entry` causes RR2/RR3 explosion
  - web-ui build: PASS
- handoff_next: optional deploy/validation pass on VPS

### [2026-05-19 04:50 UTC] AGENT:Codex
- status: HANDOFF_READY
- branch: main
- commit: none
- scope: `.agents/.product/tickets/1-backlog/2026-05-19-btcusd-ctrader-tp-mismatch-auto-close.md`, `.agents/sync/HANDOFF_2026-05-19_BTCUSD_CTRADER_TP_MISMATCH.md`
- merge_to_main: NO
- deploy:
  - owner: none
  - server_version: unchanged
  - ea_version: unchanged
  - result: NOT_DEPLOYED
- verify:
  - docs: ticket + handoff created from user screenshots
  - screenshot evidence: BTCUSD sell, entry `77367.80`, broker close `77315.00`, cTrader order `OID972856345`, position `PID621844976`, label `20260411`
- handoff_next: next agent should claim ownership before coding and investigate/fix TP mismatch per handoff doc

### [2026-05-18 19:40 UTC] AGENT:DeepSeek
- status: DEPLOYED
- branch: main
- commit: a3b43041
- scope: `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (a3b43041)
- deploy:
  - owner: DeepSeek
  - server_version: v2026.05.18 19:30 - 8edb962f
  - ea_version: v2026.05.18 19:30 - 8edb962f
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 19:30 - 8edb962f`, `postgres:ok`, `redis:ok`, `cronEvents:[]`, `mt5.connected:true`, `ctrader.connected:true`, `binance.connected:false`
  - key endpoint: broker sync/heartbeat active, health includes new `cronEvents` field
  - task-specific: brokerSyncV2 updated_at only bumps on status changes; brokerHeartbeatV2 no longer touches updated_at; BullMQ add uses allSettled; Binance bars fetch tracks source activity
- notes:
  - Binance disabled: `BINANCE_MODE` env var not set on VPS
  - cTrader disabled: `CTRADER_MODE` env var not set on VPS (set to "demo" or "live" to enable)
  - Market Data cron: "no configs" — needs active `MARKET_DATA_CRON` user_setting
  - AI Analysis cron: "no configs" — needs active `ANALYSIS_CRON` user_setting
- handoff_next: none

### [2026-05-18 19:19 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 97ca8796
- scope: `web-ui/src/api.js`, `web-ui/src/components/TradeFilesTab.jsx`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (97ca8796)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 19:15 - 386c07fa
  - ea_version: v2026.05.18 19:15 - 386c07fa
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 19:15 - 386c07fa`, `postgres:ok`, `redis:ok`, `mt5.connected:true`, `ctrader.connected:true`
  - /ui asset: `/assets/index-DfNesrRj.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull`, `POST /v2/broker/ack`, and `POST /v2/broker/sync` loops with `items=0 results=1`
  - task-specific: AI add-trade path now hydrates Files tab with created trade SID; Files tab loads only SID-scoped snapshots/uploads; upload uses UI session credentials
- handoff_next: none

### [2026-05-18 18:52 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 87e3664b
- scope: `webhook/server.js`, `web-ui/src/components/TradeFilesTab.jsx`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (87e3664b)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 18:44 - eaaf9081
  - ea_version: v2026.05.18 18:44 - eaaf9081
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 18:44 - eaaf9081`, `postgres:ok`, `redis:ok`, `mt5.connected:true`, `ctrader.connected:true`
  - /ui asset: `/assets/index-CkpJjRb8.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull`, `POST /v2/broker/ack`, and `POST /v2/broker/sync` loops with `items=0 results=2`
  - task-specific: Files tab now uses only `/v2/trades/<sid>/snapshots`; `TF8X13I78` legacy snapshots copied into `webhook/trade_files/trade-TF8X13I78/snapshots/` with 6 files and no overwrite
- handoff_next: none

### [2026-05-18 17:45 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 3959e796
- scope: `web-ui/src/components/TradePlanEditor.jsx`, `bridge-clients/TVBridge_CTrader.cs`, `.agents/sync/MAILBOX.md`
- merge_to_main: YES (3959e796; code fix 694499f8)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 16:17 - 7df2b6d4
  - ea_version: v2026.05.18 16:17 - 7df2b6d4
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 16:17 - 7df2b6d4`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-BPnALjcL.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull`, `POST /v2/broker/ack`, and `POST /v2/broker/sync` loops with `items=0 results=1`
  - task-specific: TradePlanEditor numeric row components stabilized to avoid DOM subtree replacement/flicker
- handoff_next: none

### [2026-05-18 13:02 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 465f1467
- scope: `webhook/server.js`, `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/pages/trades/V2TradeDetailPage.jsx`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (465f1467)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 12:51 - 691fa45d
  - ea_version: v2026.05.18 12:51 - 691fa45d
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 12:51 - 691fa45d`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-DxpEQqa4.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull`, `POST /v2/broker/ack`, and `POST /v2/broker/sync` loops with `items=0 results=1`
  - snapshot watermark: VPS `webhook/snapshots/XAUUSD_MASTER.png` visually verified with `XAUUSD`, `1h/4h/1D/1m`, and UTC timestamp badges
- handoff_next: none

### [2026-05-18 12:25 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: a7fc81b1
- scope: `webhook/server.js`, `web-ui/src/components/TradePlanEditor.jsx`, `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/hooks/useChartTileData.js`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/pages/trades/V2TradeDetailPage.jsx`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (a7fc81b1)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 12:22 - a72e8a9f
  - ea_version: v2026.05.18 12:22 - a72e8a9f
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 12:22 - a72e8a9f`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-gNQEDFqu.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull` + `POST /v2/broker/sync` loops with `items=0 results=1`
- handoff_next: none

### [2026-05-18 12:30 UTC] AGENT:codex-gpt5
- status: DONE (PLANNING/HANDOFF)
- branch: main
- commit: none
- scope: Deepseek ticket + handoff package for snapshot watermark/info-tab/raw-json preservation
- merge_to_main: NO
- deploy:
  - owner: NONE
  - server_version: n/a
  - ea_version: n/a
  - result: n/a
- verify:
  - ticket: `.agents/.product/tickets/1-backlog/2026-05-18-snapshot-watermark-trade-info-preservation.md`
  - handoff: `.agents/sync/HANDOFF_2026-05-18_DEEPSEEK_snapshot-watermark-info.md`
  - user_open_questions_answered: YES
- handoff_next: Deepseek

### [2026-05-18 11:59 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: e3a03cac
- scope: `bridge-clients/TVBridge_CTrader.cs`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`
- merge_to_main: YES (e3a03cac)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 13:42 - ctpartialsafe1
  - ea_version: v2026.05.18 13:42 - ctpartialsafe1
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 13:42 - ctpartialsafe1`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-gNQEDFqu.js`
  - key endpoint: PM2 logs show active `GET /v2/broker/pull` + `POST /v2/broker/sync` cycles with `items=0 results=1` and no partial-size crash signal
- handoff_next: none

### [2026-05-16 16:36 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 4c7e354d
- scope: webhook/server.js (broker sync: conditional updated_at on trades only, status-change-only notifications with oldStatusMap, notification guard)
- merge_to_main: YES (4c7e354d)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.16 14:36 - 5b3ea48e
  - ea_version: v2026.05.16 14:36 - 5b3ea48e
  - result: PASS
- verify:
  - /health: ok:true, version:v2026.05.16 14:36 - 5b3ea48e
  - PM2: no errors after restart
  - broker/sync: aid=... items=0 results=2, no errors
- handoff_next: none

### [2026-05-16 16:05 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 24b67f84
- scope: webhook/server.js (SNAPSHOTS_CRON, independent cron loop, BullMQ jobId fix, health endpoint), web-ui (snapshots_cron checkbox)
- merge_to_main: YES (24b67f84)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.16 14:26 - 14479f1c
  - ea_version: v2026.05.16 14:26 - 14479f1c
  - result: PASS
- verify:
  - /health: ok:true, version:v2026.05.16 14:26 - 14479f1c, cronSnapshotsEnabled:true, postgres:ok, redis:ok
  - /ui asset: /assets/index-D9u8nUQ0.js
  - VPS DB: SNAPSHOTS_CRON + snapshots_cron metadata inserted
  - PM2: no errors after restart
- handoff_next: none
- If any deploy fails, set `DEPLOY_BLOCKED` and stop next deployer.

### [2026-05-18 06:39 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 2235f3e3
- scope: `AI.md`, `.agents/sync/MAILBOX.md`, `web-ui/src/components/SmartContent.jsx`, `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/components/TradePlanEditor.jsx`, `web-ui/src/pages/ai/AiPromptBuilder.js`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/pages/trades/TradesPage.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (2235f3e3)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.18 08:35 - 9b7c1d2a
  - ea_version: v2026.05.18 08:35 - 9b7c1d2a
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.18 08:35 - 9b7c1d2a`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-gNQEDFqu.js` (html entry present)
  - key endpoint: `POST /v2/broker/sync` active in PM2 logs after restart
- handoff_next: none

### [2026-05-17 18:55 UTC] AGENT:codex-gpt5
- status: DEPLOY_BLOCKED
- branch: main
- commit: main (latest push before hotfix docs package)
- scope: Multi-TP rollout follow-up (`webhook/server.js` brokerSyncV2 runtime stability)
- merge_to_main: YES (latest pushed main)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 16:14 - ca4da650
  - ea_version: v2026.05.17 16:14 - ca4da650
  - result: FAIL (runtime)
- verify:
  - /health: external check unstable during deploy script
  - PM2 logs: `ReferenceError: hasPartial is not defined` in `brokerSyncV2`
  - key endpoint: `/v2/broker/sync` path throwing runtime exceptions
- handoff_next: fix `hasPartial` scope bug, redeploy, and post PASS ledger

### [2026-05-17 19:18 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 72a73159
- scope: `web-ui/src/components/TradeSignalChart.jsx`, `web-ui/src/pages/trades/TradesPage.jsx`, `web-ui/src/pages/trades/V2TradeDetailPage.jsx`, `web-ui/src/utils/signalDetailUtils.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_Ctrader.cs`
- merge_to_main: YES (72a73159)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 21:20 - tp123fix
  - ea_version: v2026.05.17 21:20 - tp123fix
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 21:20 - tp123fix`, `postgres:ok`, `redis:ok`
  - /ui asset: `/assets/index-ChHIekm7.js`
  - key endpoint: `POST /v2/trades/{id}/trade-plan/save` path deployed and UI reachable
- handoff_next: none

### [2026-05-17 17:11 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: b416a142
- scope: `webhook/server.js` (`brokerSyncV2` hasPartial scope/runtime fix + SQL placeholder hardening), `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (b416a142)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 17:01 - 8f0c9b1a
  - ea_version: v2026.05.17 17:01 - 8f0c9b1a
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 17:01 - 8f0c9b1a`, `postgres:ok`, `redis:ok`
  - UI asset: `/assets/index-COYEoWqk.js`
  - key endpoint: `/v2/broker/sync` active in PM2 logs; latest `webhook-error.log` tail has no new `ReferenceError: hasPartial is not defined`
- handoff_next: monitor remaining non-blocking broker DB timeout noise separately

### [2026-05-17 18:14 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 223d236c
- scope: `web-ui/src/utils/signalDetailUtils.jsx` (`__raw_plan` precedence + direction/TP/checklist mapping), plus version bump + tracker ticket docs
- merge_to_main: YES (223d236c)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 18:12 - 0a5eb5bd
  - ea_version: v2026.05.17 18:12 - 0a5eb5bd
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 18:12 - 0a5eb5bd`, `postgres:ok`, `redis:ok`
  - UI asset: `/assets/index-Bk2b0gVt.js`
  - key endpoint: `/v2/broker/sync` processing continues; newest error tail has no fresh `ReferenceError: hasPartial is not defined` (only prior historical lines in full log)
- handoff_next: none

### [2026-05-17 13:18 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 67082123
- scope: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (67082123)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 15:14 - c4a71d2e
  - ea_version: v2026.05.17 15:14 - c4a71d2e
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 15:14 - c4a71d2e`, `cronSnapshotsEnabled:true`
  - UI asset: `/assets/index-Bg5u-a0L.js`
  - key endpoint: snapshot cron loop running (`[Cron][Snapshots] Running ...`)
- handoff_next: monitor snapshot-grid timeout stability on VPS

### [2026-05-17 13:03 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 630d9502
- scope: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/styles.css`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (630d9502)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 15:06 - b3f9d124
  - ea_version: v2026.05.17 15:06 - b3f9d124
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 15:06 - b3f9d124`, `cronSnapshotsEnabled:true`
  - UI asset: `/assets/index-kqiIUSfK.js`
  - key endpoint: snapshot cron loop running (`[Cron][Snapshots] Running ...`)
- handoff_next: none

### [2026-05-17 12:58 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 542a2ed5
- scope: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (542a2ed5)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.17 14:56 - 6d2f1eab
  - ea_version: v2026.05.17 14:56 - 6d2f1eab
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.17 14:56 - 6d2f1eab`, `cronSnapshotsEnabled:true`
  - ui asset: `/assets/index-kqiIUSfK.js`
  - key endpoint: `GET /v2/chart/snapshots-grid/XAUUSD?...` reachable from localhost (seen in PM2 logs)
- handoff_next: none

### [2026-05-15 16:46 UTC] AGENT:Antigravity
- status: DEPLOYED
- branch: main
- commit: e95116a2
- scope: `web-ui/src/styles.css`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`
- merge_to_main: YES (e95116a2)
- deploy:
  - owner: Antigravity
  - server_version: v2026.05.15 16:44 - 7e7d1275
  - ea_version: v2026.05.15 16:44 - 7e7d1275
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.15 16:44 - 7e7d1275`
  - /ui asset: `/assets/index-D7U5o-P2.js`
  - key endpoint: `GET /webhook/health` returns `ok:true`
- handoff_next: none

- status: DEPLOYED
- branch: main
- commit: ab15d175
- scope: `web-ui/src/styles.css`, `web-ui/src/api.js`, `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/components/TradePlanEditor.jsx`, `web-ui/src/pages/trades/TradesPage.jsx`, `web-ui/src/pages/signals/SignalsPage.jsx`, `web-ui/src/pages/DashboardPage.jsx`, `web-ui/src/pages/system/LogsPage.jsx`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- merge_to_main: YES (ab15d175)
- deploy:
  - owner: Antigravity
  - server_version: v2026.05.15 07:52 - e82673a2
  - ea_version: v2026.05.15 07:52 - e82673a2
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.15 07:52 - e82673a2`
  - /ui asset: `/assets/index-Cnp-zj9p.js`
  - key endpoint: `GET /mt5/health` returns `ok:true`
- handoff_next: none

- status: DEPLOYED
- branch: main
- commit: 40ec7169
- scope: `web-ui/src/components/SignalDetailCard.jsx`, `web-ui/src/components/charts/SymbolChart.jsx`, `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (40ec7169)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.14 18:58 - 39df8d4c
  - ea_version: v2026.05.14 18:58 - 39df8d4c
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.14 18:58 - 39df8d4c`
  - /ui asset: `/assets/index-LPr2N_Ht.js`
  - key endpoint: `GET /v2/chart/snapshots?limit=2 -> 401 AUTH_REQUIRED` (expected without auth)
- handoff_next: none

### [2026-05-14 19:38 UTC] AGENT:codex-gpt5
- status: DEPLOYED
- branch: main
- commit: 34504309
- scope: `web-ui/src/utils/signalDetailUtils.jsx`, `web-ui/src/pages/trades/TradesPage.jsx`, `web-ui/src/components/SignalDetailCard.jsx`, `webhook/server.js`, `bridge-clients/TVBridgeEA.mq5`, `bridge-clients/TVBridge_CTrader.cs`
- merge_to_main: YES (34504309)
- deploy:
  - owner: codex-gpt5
  - server_version: v2026.05.14 19:25 - 2beac38b
  - ea_version: v2026.05.14 19:25 - 2beac38b
  - result: PASS
- verify:
  - /health: `ok:true`, `version:v2026.05.14 19:25 - 2beac38b`
  - /ui asset: `/assets/index-ma7-_xVY.js`
  - key endpoint: `GET /v2/trades/TF1K2UW11/events` reachable; no `TF1K2UW11` found in `/v2/broker/pull` log stream
- handoff_next: none

# Handoff — 2026-05-08

> From: Codex session

### [2026-05-17 17:15 UTC] AGENT:codex-gpt5
- status: DONE (PLANNING ONLY)
- branch: main
- commit: none (docs planning package prepared; no code execution changes requested)
- scope:
  - `.agents/.product/features/1-plan/multi_tp_trade_lifecycle.md`
  - `.agents/.product/tickets/1-backlog/2026-05-17-multi-tp-trade-lifecycle.md`
  - `.agents/.product/tickets/feature_tracker.md`
  - `.agents/.product/tickets/1-backlog/_master-backlog.md`
- merge_to_main: NO
- deploy:
  - owner: NONE
  - server_version: n/a
  - ea_version: n/a
  - result: n/a
- verify:
  - docs_created: YES
  - ticket_linked: YES
  - backlog_index_updated: YES
- handoff_next: implementation agent for DB/API/UI/bridge rollout
> To: Next agent / Self

## What Was Done

### Broker Sync SSE Fixes
- **PnL not updating**: SDK SSE `tradeUpdates` only had `pnl_realized`, but UI reads `broker_pnl` first. Added `broker_pnl: it.pnl` to SSE payload.
- **SID mismatch**: `tradeKeyOf(r)` returned `r.id` (integer), but SSE map was keyed by `u.sid` (UUID). Fixed to match by `r.sid`.
- **Event listener churn**: `useRealtimeData` re-registered on every render. Fixed with `useRef`.

### Per-Value Flash Animation
- CSS `.value-flash` — very subtle accent pulse (`rgba(accent, 0.06)`, 0.8s fade)
- Tracks per-field changes via `changedFields` Map<sid, Set<fieldName>>
- `StatusPnlCell` accepts `flashFields` prop, applies `.value-flash` to pips/PnL divs

### Toast Fix (Add Trade from Signal)
- Root cause: `mt5Log` key was `event_type` but function checks `metadata.event`
- Fix: Changed `event_type` → `event` so `NotificationManager.handle` fires

### Signal Auto-Close
- After `+Trade` from signal, queries `execution_profiles` for other subscribers
- If none → `UPDATE signals SET status = 'CLOSED'`
- UI: `showAddTradeButton` hidden for CLOSED/FILLED/CANCELLED/etc signals

### Claude Files Cleanup
- 0 files on Anthropic API — already clean
- Cleared 373 stale entries from `.claude-files.json` + `.claude-context-files.json`

### Logs Page UI
- TYPE filter moved to same row as "Logs" title, right-aligned
- Bottom-sticky TickerBar added to Logs page

### ChartSnapshotsPage Refactor
- Removed Snapshots button + warming process (~350 lines)
- Removed status text display
- AI provider/model selects + Analyze button moved to right side
- Toolbar: `flexWrap: "nowrap"` keeps all controls on one row

### GPT-4o 404 Fix
- Backend: `gpt4o` → `openai` provider alias in `callAiProvider()`
- Frontend: `aiSourceFromModel` returns `"ai_gpt4o"` for GPT models

### Async Multi-Image Upload
- `attachedTradeImage` → `attachedTradeImages` (single to array)
- `attachTradeImageFile` → `addTradeImageFiles` (multi-file support)
- File input: `multiple` attribute
- Each image has individual `x` remove, + "Clear all" button
- `payload.attached_images` array sent to AI analyze endpoint

### Desktop Auth Fix
- Backend: `getUiSessionFromReq` reads `x-session-token` header in addition to cookies
- Login endpoint returns `token` in JSON response
- v3 API client bridges `tvbridge_api_base` + `tvbridge_api_key` localStorage keys

### V3 Desktop App (Phase 1)
- Tauri v2 + React + TypeScript in `app/ui/`
- Imports all v2 pages via `@v2/*` alias (Trades, Signals, Logs, Analyze, Settings)
- API URL + admin key inputs in header
- HomePage: dual auth (API key tab + Login tab)
- Health check with green/red dot
- 8.2MB bundle size
- Zed tasks: `.zed/tasks.json` (Launch, Restart, Build, Deploy, V3 Dev)
- Build script: `scripts/build_desktop.sh`
- Restart script: `scripts/restart_desktop.sh`

## Key Files Changed

| File | What |
|---|---|
| `webhook/server.js` | broker_pnl SSE, session token header, toast fix, signal auto-close, gpt4o fix |
| `web-ui/src/pages/trades/TradesPage.jsx` | SID matching, value-flash, changedFields |
| `web-ui/src/hooks/useRealtimeData.js` | useRef stabilization |
| `web-ui/src/components/TradeSignalListCells.jsx` | flashFields prop |
| `web-ui/src/styles.css` | .value-flash animation |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | Multi-image, remove snapshots/warmup, UI layout |
| `web-ui/src/pages/signals/SignalsPage.jsx` | showAddTradeButton conditional |
| `web-ui/src/pages/system/LogsPage.jsx` | TYPE filter move, bottom TickerBar |
| `app/ui/*` | New V3 desktop app |

## VPS Status
- Webhook: `v2026.05.08 18:38 - 45b9d87` — online, PM2
- Desktop app: built at `app/ui/src-tauri/target/release/bundle/macos/Antigravity.app`

## Outstanding / Next
- [ ] CHART_API logging (event type button exists, no code emits it)
- [ ] Desktop app "Disconnected" issue — CORS or Tauri WebView fetch problem, try `credentials: "omit"` + API key
- [ ] Tauri DMG bundling fails (`.app` works, need `create-dmg` or similar)
- [ ] Windows/Linux Tauri cross-compile
- [ ] V3 Phase 2: Hono + Drizzle backend migration (only if needed)

# Handoff — 2026-05-13

> From: DeepSeek
> To: Next agent

## What Was Done

### AI Response Parsing Fixes (multi-symbol XAGUSD+US30)
- **Root cause**: AI returns JSON-escaped string (`"{\"version\":...}"`) with malformed/truncated JSON. `extractJsonFromAiText` + `normalizeAiAnalysisContract` loses trade plans → "No valid setup" fallback.
- **Server fix**: `recoverTradePlansFromRawAiText` unescapes JSON-string wrappers, extracts plans via balanced bracket parsing, falls back to regex when truncated.
- **Client fix**: `recoverTradePlansFromRaw` in ChartSnapshotsPage.jsx — same logic client-side, always preferred over bad `tryParseJsonLoose` results.
- **`max_tokens`**: bumped 4500 → 32000 (Claude requires it, model stops when done).
- **TP resolution**: `planPrimaryTpNumber` now checks `tp1.price` (was skipping `tp1` entirely).

### Schema v2.7 + Response Mapping
- `config/ai_response_schema.json` → v2.7 deployed.
- `config/response_mapping.json` → version-aware (`versions.2.7.ui_fields`) with paths per UI section:
  - `trade_header`: confidence_pct, risk_percent, skip_decision, grade
  - `plan_basic`: symbol, direction, order_type, profile, timeframe, session, strategy, entry_model
  - `plan_prices`: entry, sl, tp (tp1.price > tp > take_profit), tp2, tp3, rr, be_trigger
  - `plan_meta`: entry_checklists, entry_trigger, invalidation, mid_invalidation, skip_reasons, note
  - `htf_context`, `ltf_analysis`: per-TF trend/bias/phase/narrative
  - `confluence`: sell/buy scores + passed/failed items
  - `events_patterns`, `pd_arrays`: full raw pass-through

### SymbolChart Buttons Refactor
- Unified `[Live] [C] [S]` buttons, removed TradePlan + Refresh.
- `C` = fetch bars via `api.chartTwelveCandles` per TF (bypassed Claude-dependent `/chart/refresh`).
- `S` = list existing VPS snapshots via `api.chartSnapshots`.
- Per-TF status badges in TfHeader (MEM/DB/API, snapshot ✅/📷).
- Snapshot mode shows `<img>` tiles.

### Trade File Attachments
- Drag-drop upload below Note textarea, stored in `trade_files/trade-{sid}/`.
- Image preview, download button, delete.

### NotificationHub
- `no_data` status → ⚠️ yellow warning (was green ✅).
- Single icon per notification (removed duplicate type icon).
- Per-action messages ("- 1 added", "- no data").

## Deploy Status
- commit: `ade8c6e9`
- server_version: `v2026.05.12 21:30 - max-tokens-8k`
- UI: 200 ✅
- config: `response_mapping.json` + `ai_response_schema.json` synced to VPS

## Key Files
| File | Purpose |
|------|---------|
| `config/response_mapping.json` | Schema→UI field paths per version |
| `config/ai_response_schema.json` | AI prompt schema v2.7 |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | `recoverTradePlansFromRaw`, `planPrimaryTpNumber` |
| `webhook/server.js` | `recoverTradePlansFromRawAiText`, `planPrimaryTpNumber` |
| `web-ui/src/components/charts/SymbolChart.jsx` | [Live][C][S] buttons, TfHeader badges |
| `web-ui/src/hooks/useChartTileData.js` | Direct Twelve Data + snapshot list calls |

## TODO / Known Issues
- `events_patterns` and `pd_arrays` in UI not yet rendered — mapping paths exist, need UI components.
- `entry_checklists` (boolean object) needs check/uncheck UI widget.
- Twelve Data daily limit exhausted (800 credits/day).

# Handoff — 2026-05-13 (session end)

> From: DeepSeek
> To: Codex

## Deployed & Verified on VPS
- commit: `cdc97b9e`
- version: `v2026.05.13 13:30 - binance-redis-cache-colors`
- All code pushed to `origin/main`, VPS in sync

## What Was Done

### 1. SymbolChart Button Refactor
- Unified `[Live] [C] [S]` buttons for ALL contexts
- Removed separate TradePlan button, Refresh ↻ button
- Overlay toggles (P1/P2/PD/KL) appear when `hasTradePlan && mode==="cache" && hasBars`
- Short labels: "C", "S"

### 2. Cache/Data Pipeline
- `useChartTileData.js` → `fetchAll()` calls `api.chartTwelveCandles` per TF (parallel via Promise.allSettled)
- Server: `buildAnalysisSnapshotFromTwelve()` → Redis → DB → Twelve Data
- **Binance free API** for crypto: BTC,ETH,SOL,DOGE... → `api.binance.com/v3/klines`
- Snapshot file naming: stripped provider prefix (`ICMARKETS_BTCUSD` → `BTCUSD`)

### 3. Schema v2.7 + Response Mapping
- `config/ai_response_schema.json` v2.7 deployed
- `config/response_mapping.json` with version-aware paths (`versions.2.7.ui_fields`)
- Client-side `recoverTradePlansFromRaw()` extracts plans from raw AI text when JSON parse fails
- `max_tokens` bumped to 32000

### 4. Bug Fixes
- `planPrimaryTpNumber`: added `tp1.price` priority (was missing)
- `tfToMs`: handles `1DAY`, `1WEEK`, `1MIN` formats (was only `D`, `W`, etc.)
- Crosshair sync disabled (`syncedCrosshair={null}`) to prevent TradeSignalChart null crash
- [S] snapshot list: 15s timeout to prevent forever loading
- [S] stays on snapshot mode on ERROR instead of auto-switching to Live
- Body margin: `0` for fullscreen dashboard

## What Still Needs Fixing

### [C] TradeSignalChart "Value is null" crash
- `SymbolChart.jsx` line ~568: `hasBars` check prevents TradeSignalChart during LOADING
- But AFTER loading (status=READY), TradeSignalChart renders and crashes
- crash is in `setCrosshairPosition` → syncedCrosshair already set to null
- **Need to find the actual null value inside TradeSignalChart** — file `web-ui/src/components/TradeSignalChart.jsx`, function `v` at line ~2204 (minified)

### [S] still not showing snapshot images
- `useChartTileData.js` `fetchAll()` snapshot mode calls `api.chartSnapshots(100)` 
- Filters by symbol, matches TF by file_name pattern `_15m_` / `_15M_`
- If found: sets `entry.snapshot = { file_name, url }` → `master.snapshots[tf]` → `<img>` in SymbolChart
- **Check if snapshot files actually exist on VPS** at `/opt/trading/webhook/snapshots/`
- **Check if `/v2/chart/snapshots/` GET endpoint returns files**
- **Check if SymbolChart snapshot `<img>` URL is correct** — uses `/v2/chart/snapshots/{file_name}`

### Cache source labels not updating in UI
- `SymbolChart.jsx` TfHeader badge shows: "Redis" / "DB" / "Binance" / "Twelve"
- Color: green for remote API, grey for cached
- **Check if `context.cache_source` is being passed correctly from `useSymbolChartData` → `master.context[tf].cache_source`**

### All TFs show same chart data
- Each TradeSignalChart tile has `chartId = ${symbol}-${tf}`
- TradeSignalChart has its own `chartFetchManager.get(symbol, interval)` call
- **Since `chartFetchManager.set()` was removed from the hook, TradeSignalChart fetches its own data**
- **Need to either: restore `chartFetchManager.set()` in fetchAll, or make TradeSignalChart use passed bars data**

### Dashboard
- Body margin set to 0 in CSS
- Dashboard grid: removed 20% sidebar column
- Removed Direction and Chart TF filters
- **User reports not seeing changes** — verify `body{margin:0}` in `/opt/trading/web-ui/dist/assets/index-*.css`
