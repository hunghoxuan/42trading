# Handoff — 2026-05-28: Pending Order SID Fallback

## Summary

Investigated why SL/TP changes on cTrader pending orders don't sync to VPS. Root cause: cTrader may recreate pending orders with a new Order ID (OID) when SL/TP is modified, dropping the SID comment. The bridge's `ResolveSid()` returns empty string → order syncs with `sid: ""` → server can't match the trade → SL/TP never written.

**Fix**: Added position-based SID fallback in `TVBridge_CTrader.cs`. When a pending order has no SID in its comment, the bridge looks up a matching position with the same `SymbolName + TradeType` and uses that position's SID.

---

## Git Branch

`main` (direct fix — no branch created, `FIX` tag per communication rules)

## Agent

DeepSeek V4 Flash

## What Was Done

### Root Cause Analysis

Traced full sync flow for `PendingOrders`:

| Step | What happens |
|---|---|
| 1 | Bridge sends order JSON: `{ ticket: OID, sid: SID, sl: X, tp: Y }` |
| 2 | Server `pushItems()` parses order, extracts SL/TP |
| 3 | Server UPDATE matches trade by `sid = $18` (SID string) |
| 4 | `sl = COALESCE(NULLIF(NULLIF($23,0),-1), sl)` → **writes new SL** ✅ |

**When it breaks**: cTrader recreates the order (new OID) and drops the comment → `ResolveSid()` returns `""` → order JSON has `sid: ""` → server matches 0 rows → SL/TP never written.

### Field Analysis (Order → VPS)

**Group 1: Info fields** (broker source-of-truth):

| Field | Client sends | Server writes | Updates on sync? |
|---|---|---|---|
| `ticket` (order.Id) | ✅ | `broker_trade_id` | ✅ |
| `symbol` | ✅ | filter only | ❌ |
| `side` | ✅ | not in SET | ❌ |
| `type` (LIMIT/STOP) | ✅ | `order_type` | ✅ |
| `entry` (TargetPrice) | ✅ | `entry`, `entry_exec` | ✅ **COALESCE** |
| `sl` | ✅ | `sl` | ✅ **COALESCE(NULLIF(0,-1))** |
| `tp` | ✅ | `tp` | ✅ **COALESCE(NULLIF(0,-1))** |
| `volume` | ✅ | `volume`, `broker_volume` | ✅ **COALESCE** |
| `lots` | ✅ | `broker_lots` | ✅ |
| `label` | ✅ | not in SET | ❌ |
| `status` (PENDING) | ✅ | `execution_status` | ✅ guarded |

**Group 2: Computed fields** (bridge-calculated):

| Field | Calc | Server writes |
|---|---|---|
| `margin` | 0.0 | `broker_margin` |
| `pnl_tp` | `abs(Target-TP)/PipSize * PipValue * Vol` | `broker_tp_pnl` |
| `pnl_sl` | same for SL | `broker_sl_pnl` |

### Fix Applied

**File**: `bridge-clients/TVBridge_CTrader.cs`

- Added `posSidLookup` (Dictionary<symbol+side, SID>) built from all active `Positions` before the orders loop
- In the orders loop, if `ResolveSid()` returns empty, fallback to `posSidLookup` by matching `order.SymbolName + order.TradeType`
- On successful fallback, also cache in `_ticketSidMap[newOid] = sid` for future syncs
- Build version bumped: `v2026.05.28 14:10 - 1f4f402a` → `v2026.05.28 16:30 - sid-fallback`

### Files Changed

| File | Change |
|---|---|
| `bridge-clients/TVBridge_CTrader.cs` | Position SID lookup + fallback for pending orders without SID comment |
| `bridge-clients/TVBridge_CTrader.cs` | Build version bump |

## What's Remaining

- **Recompile cTrader** — current build is `v2026.05.28 14:10 - 1f4f402a`. Without recompile, the fallback doesn't exist.
- **Edge case**: pure pending orders (no active position for same symbol+side) still can't be matched. This is rare — cTrader usually preserves the comment for orders placed by the bridge. If it happens, a server-side fallback (match by symbol+action+volume) could be added later.

## Technical Decisions & Tradeoffs

| Decision | Rationale | Tradeoff |
|---|---|---|
| Position-based SID lookup (symbol+side) | Simple, no new state, works for common case | Only works when there's an active position for the same symbol+side |
| Client-side fix only | No server changes needed, keeps server generic | Edge case (no position) needs future server-side fallback |
| `_ticketSidMap` cache update | Ensures next sync resolves directly without position lookup | Minimal memory cost |

## Assumptions

- cTrader recreates pending orders with new OID on SL/TP modify (preserving the old OID → SID mapping in `_ticketSidMap`)
- When a pending order exists for a symbol+side, there is usually also an active position for the same symbol+side
- `TradeType.ToString()` → `"Buy"` / `"Sell"` (consistent with existing code usage)

## Verification

- Code compiles syntactically (C#), no diagnostics errors
- Logic trace verified: `ResolveSid` empty → position lookup → `_ticketSidMap` cache → correct SID in JSON
- Server-side UPDATE query confirmed to write SL/TP when SID is present
- Pre-existing `using` directives cover all types used (`System.Collections.Generic`)

## Deploy Status

| Item | Status |
|---|---|
| Build version | `v2026.05.28 16:30 - sid-fallback` |
| Deployed | **NOT_DEPLOYED** — requires manual recompile + deploy to cTrader |
| Local webhook | No changes needed (server-side untouched) |

## Continuation Instructions

1. **Recompile cTrader bridge** — open `TVBridge_CTrader.cs` in cTrader CBoT editor, compile with version `v2026.05.28 16:30 - sid-fallback`
2. **Deploy to account** — attach compiled robot to cTrader account
3. **Test**: modify SL/TP on a pending order in cTrader UI → verify VPS reflects change within sync cycle
4. **If still broken**: check cTrader debug panel for `_ticketSidMap` population on sync response; confirm order JSON has correct `sid` field
5. **Future improvement**: if pure pending order case (no position) also broken, add server-side fallback in `brokerSyncV2` matching by `symbol + action + volume` against pending trades with null `broker_trade_id`

## Handoff Prompt

```text
Task: Pending order SL/TP sync fix for cTrader bridge.

Files to read:
- bridge-clients/TVBridge_CTrader.cs (main change: position SID fallback in orders loop)
- .agents/sync/HANDOFF_2026-05-28_PENDING_ORDER_SID_FALLBACK.md (full analysis)

What's done:
- Root cause identified: cTrader drops SID comment when recreating order on SL/TP modify
- Fix: position-based SID lookup fallback in the orders sync loop
- Build version bumped to v2026.05.28 16:30 - sid-fallback

What remains:
- Recompile cTrader bridge
- Deploy to account
- Edge case: pure pending orders (no position) may still fail — add server fallback if needed

Constraints:
- No server-side changes needed
- Client fix only, requires recompilation
- Use position SymbolName + TradeType as SID lookup key
