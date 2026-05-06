# Handoff: FEAT-20260505-DB-CACHE-UI (DEPLOYED)
- From agent: Codex
- To agent: Next reviewer / maintenance agent
- Ticket: `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/2-backlog/2026-05-05-db-cache-enhancements.md`
- Timestamp: 2026-05-05 12:18 (Europe/Berlin)
- Status: DONE
- Work Description:
  - Review follow-up fixes applied in `webhook/server.js`, `web-ui/src/pages/system/DatabasePage.jsx`, and `web-ui/src/pages/system/CachePage.jsx`.
  - Added missing feature doc: `.agents/.product/features/2-done/system_db_cache_admin.md`.
  - Deployed to production successfully.
  - Live checks passed on public endpoints.
  - Residual server note: PM2 logs still show pre-existing `v2/broker/sync` database error `column "signal_id" does not exist`; separate from this deploy scope.
- Checks:
  - `rtk node --check webhook/server.js`
  - `rtk npm --prefix web-ui run build`
  - `rtk bash scripts/deploy/bump_build_versions.sh`
  - `rtk bash scripts/deploy/check_build_versions.sh origin/main`
  - `rtk bash scripts/deploy/deploy_webhook.sh`
  - `rtk curl -sS --max-time 20 https://trade.mozasolution.com/health`
  - `rtk curl -sS --max-time 20 https://trade.mozasolution.com/ui/`

# Handoff: SID-First Architecture & Broker Integration
Date: 2026-05-05 (Updated)

## 1. Summary of Changes (Previous Session)
Successfully migrated to **SID-first identification architecture**.

### Identification Refactor
- **SID Unified**: 9-char, time-sortable, Base36 SID (e.g., `D1AA65EDA`) — no prefix.
- **Broker Identity**: Label = `{Source}_{EntryModel}`, Comment = `sid`.
- **Sync Logic**: Primary lookup switched from `ticket` to `sid`.

### Database & Account Health
- **Trade Columns**: `broker_pips`, `broker_lots`, `broker_commission`, `broker_swap`, `broker_volume`.
- **Account Columns**: `balance`, `equity`, `margin`, `free_margin`, `leverage`, `broker_name` on `user_accounts`.
- **Manual Discovery**: Auto-adopt unrecognized broker positions as `source_id = [BrokerName]`.

## 2. Bugs Fixed This Session
- [x] `mt5GenerateId("SIG")` → `mt5GenerateTimeSid()` — new signals no longer get `SIG_` prefix.
- [x] Discovery INSERT used non-existent `source` column → fixed to `source_id`.
- [x] Discovery INSERT used `userId` (undefined) → fixed to `uid` (correct scope).
- [x] Migrated 23 trades + 30 signals from `SIG_...` to clean 9-char SIDs.

## 4. Current State
- **Backend**: Deployed `v2026.05.05 21:40 - 9ff44ac`. Health: ✅
- **DB**: All SIDs migrated. Balance/equity/margin columns populated.
- **Bridge**: `TVBridge_CTrader.cs` updated locally to support SID-first labels, full discovery, and broker_name reporting.
- **EA**: `TVBridgeEA.mq5` version bumped to match system.

## 5. Next Steps
- [ ] **Recompile cTrader bridge**: User must paste the updated `TVBridge_CTrader.cs` into cTrader and recompile.
- [ ] **Verify Sync**: Confirm `broker_name` (cTrader) populates on the dashboard.
- [ ] **Test Discovery**: Open manual trade in cTrader → verify it appears on dashboard with `source_id = C_TRADER`.
- [ ] **Verify Closing**: Confirm bridge correctly closes trades via SID (Comment) matching.
- [ ] **Cleanup**: Evaluate phasing out `trade_id` and `signal_id` columns after grace period.

## 6. Context for New Thread
"Resuming SID-First Architecture. Bridge logic updated for cTrader. User must recompile. Focus: verify manual discovery and broker_name population."

# Handoff: AI Schema Single-Source Fix (DEPLOYED)
- From agent: Codex
- To agent: Next reviewer / maintenance agent
- Timestamp: 2026-05-06 09:25 (Europe/Berlin)
- Status: DONE
- Work Description:
  - Inspected live production `logs` rows for `object_table='ai'`.
  - Confirmed latest production rows are `AI_ANALYSIS` and `AI_RESPONSE`; no latest `AI_ANALYZE_*` rows were present in the live window.
  - Moved AI response schema source of truth to `/Users/macmini/Trade/Bot/trading/shared/ai_response_schema.json`.
  - Wired both backend `webhook/server.js` and frontend `web-ui/src/pages/ai/AiPromptBuilder.js` to that shared schema.
  - Updated `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` fallback normalizer to understand the current `ai_full_analysis` contract already normalized by the backend.
  - Updated logs API/UI contract handling so canonical `logs` fields remain available in the frontend.
  - Deployed to production successfully.
- Checks:
  - `rtk node --check webhook/server.js`
  - `rtk npm --prefix web-ui run build`
  - `rtk env BUILD_GIT_ID=ai-sot1 bash scripts/deploy/bump_build_versions.sh`
  - `rtk git push origin main`
  - `rtk env PUSH_FIRST=0 VPS_APP_DIR=/opt/trading bash scripts/deploy/deploy_webhook.sh`
  - `rtk curl -sS --max-time 15 https://trade.mozasolution.com/health`
  - `rtk curl -sS --max-time 15 https://trade.mozasolution.com/webhook/health`
  - `rtk curl -sS --max-time 15 https://trade.mozasolution.com/webhook/mt5/health`
  - `rtk curl -sS --max-time 15 https://trade.mozasolution.com/ui/`
- Residual Notes:
  - Deploy script still probes `http://139.59.211.192:80`; that direct probe is unreliable even when public HTTPS is healthy.
  - `scripts/test/test_remote_api_default.sh` and `scripts/test/test_remote_ui.sh` currently expect missing path `scripts/webhook/.env`; fix those scripts before depending on them for smoke coverage.
