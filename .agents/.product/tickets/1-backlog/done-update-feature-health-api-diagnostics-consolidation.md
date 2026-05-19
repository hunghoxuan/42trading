# Health API diagnostics consolidation

## Meta
- Ticket Type: `Update Feature`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-19 09:28 UTC`

## Problem
Need `/health` to include consolidated diagnostics so cron and runtime checks can be verified from a single endpoint, including root HTML-vs-JSON verdict for public domain.

## Investigation
- Existing `/health` already returned basic cron state and local root check.
- Diagnostic-style endpoints existed separately (`/mt5/health`, `/mt5/dashboard/summary`, `/mt5/dashboard/advanced`) with fragmented visibility.

## Solution
- Extended `/health` with `diagnostics` block:
  - `root_checks.local` and `root_checks.public_trade_mozasolution_com`
  - strict mode verdict (`html` vs `json_or_other`) + status/content-type/error
  - cron scheduler/runtime/config diagnostics (queue mode/readiness, config counts, tracker counts)
  - endpoint capability summary for related diagnostic endpoints
- Added DB-backed cron config counts for active MARKET_DATA/ANALYSIS/SNAPSHOTS cron settings.
- Health overall `ok` now requires both local and public root checks to be HTML.

## Expected Output / Verification
- [x] `/health` returns unified `diagnostics` payload.
- [x] Public root check indicates whether `https://trade.mozasolution.com/` is HTML or JSON/other.
- [x] Cron diagnostics include runtime + active config counts.
- [x] `rtk node --check webhook/server.js` passes.

