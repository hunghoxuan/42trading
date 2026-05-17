# TradePlan Object Unification Requirements (Source of Truth)

Status: Active  
Owner: UI Trading Flow  
Applies to: Analyze -> Trade flow, chart object manager, trade plan cards

## 1) Purpose

Define exact behavior for TradePlan management so agents stop reintroducing regressions.

This document is the contract for:
- chart right-click actions
- chart object chips/editor
- trade plan cards (`/trade/{symbol}` style panel)
- synchronization between chart objects and trade plan array

---

## 2) Core Principle

`TradePlan` is a **special object type**, not separate loose lines.

A TradePlan object always contains:
- `direction` (`BUY` or `SELL`)
- `entry`
- `tp`
- `sl`
- `plan_id` (`P1`, `P2`, `P3`, ...)
- visibility state

`BUY`, `SELL`, `TP`, `SL` must not be persisted as independent objects in Analyze/TradePlan mode.

---

## 3) Modes

## 3.1 Analyze/TradePlan Mode

Entered when either exists:
- `response.tradePlans.length > 0`, or
- `rawData.trade_plan.length > 0`, or
- trade plan card has meaningful values.

Behavior:
- Right-click menu includes: `Line`, `Zone`, `Buy`, `Sell`
- Right-click menu excludes: `TP`, `SL`
- `Buy`/`Sell` creates/updates **TradePlan objects only**
- Chart and trade plan cards synchronize bi-directionally

## 3.2 Normal Object Mode (no analysis)

Behavior:
- Regular object tools can exist (line/zone/etc.)
- No fake conversion of loose objects into TradePlan unless user explicitly creates Buy/Sell TradePlan action

---

## 4) TradePlan Array Contract

Single source of truth is an array of trade plans.

Required invariants:
1. Multiple TradePlans are allowed (`P1..Pn`).
2. Adding Buy/Sell must **append** a new plan if no empty/missing slot is targeted.
3. Must never overwrite existing `P1` by default.
4. Plan-id mapping is deterministic:
   - `P1 -> main`
   - `P2 -> suggested_1`
   - `Pn -> suggested_{n-1}`
5. Chart chips count must equal TradePlan array count (excluding intentionally hidden chips).

---

## 5) Right-Click Behavior

In Analyze/TradePlan mode:
- `Buy` at cursor price:
  - create new TradePlan object with `direction=BUY`, `entry=cursorPrice`
  - initialize/retain TP+SL as TradePlan fields (not separate objects)
- `Sell` at cursor price:
  - same as above with `direction=SELL`

Append rules:
- First use first missing plan id (`P1`, `P2`, `P3`, ...).
- If no missing id, append next max+1.
- Never replace an existing plan unless user is explicitly editing that plan.

---

## 6) Visual Rules

## 6.1 Labels
- TradePlan labels rendered left inside chart.
- Non-TradePlan object labels rendered right but not overlapping price axis.

## 6.2 Color
- BUY plan base color = green.
- SELL plan base color = red.
- Changing direction in editor must immediately update plan color.

## 6.3 Zones/Fill
- Draw translucent green fill between `Entry -> TP`.
- Draw translucent red fill between `Entry -> SL`.

---

## 7) Object Panel / Editor Rules

Required:
- Chips use compact format (`TP P1`, `TP P2`, ...)
- Visibility via eye icon
- Remove chip deletes that plan
- Remove All clears all objects/plans

Remove from UI:
- `Mapped TF Properties`
- `Time (epoch ms)` field in object editor
- noisy status line like `Plan | Active TF | Price | Time`

Line width options:
- `[1,2,3,4,5,6,7,8,10]`

Background color:
- use color picker (not text field)

Type change behavior:
- changing type must apply corresponding style preset (line style/color/width/bg)

---

## 8) Sync Requirements

Must sync immediately:
1. Chart object create/edit/delete -> TradePlan cards.
2. TradePlan card edit -> chart lines/chips.
3. Visibility toggles affect chart rendering only (not deleting data).

If analysis returns 2 plans:
- chart must show 2 TradePlan chips/objects
- trade card must show 2 plans
- both sides must remain consistent after edits.

---

## 9) Acceptance Tests (Must Pass)

1. Analyze returns 2 plans -> UI shows `TP P1` + `TP P2` in chart object area.
2. Right-click `Buy` when `TP P1` exists -> creates `TP P2` (append), does not overwrite `TP P1`.
3. Right-click `Sell` after above -> creates next plan (or explicit target), not loose `SELL` object line.
4. Change direction BUY->SELL on a TradePlan -> line/chip color becomes red immediately.
5. Delete `TP P2` -> only `P2` removed from trade plan array; `P1` intact.
6. Hidden TradePlan remains in array and can be shown again.
7. Chart object count equals TradePlan array count in trade panel.

---

## 10) Non-Goals

- No backend schema redesign in this feature.
- No change to non-tradeplan indicator overlays (PD/KL/etc.).

---

## 11) Implementation Guardrails for Future Agents

Before changing chart/tradeplan code:
1. Read this file first.
2. Do not merge logic that treats Buy/Sell as plain line objects in Analyze mode.
3. Do not hardcode only `P1/P2` mapping; support dynamic `Pn`.
4. Validate with acceptance tests above before deploy.

