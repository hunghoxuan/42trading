## SESSION CONFIG
Symbol: USDCAD | Profile: Daily | Session: Any | Direction: Both
MinRR: 2 | MaxRisk: 1% | HTF: D, 4H | Execution: 15M | Confirmation: 5M
Active Strategies: ICT, Price Action, Market Structure

---

## PRE-TRADE GATE — Answer ALL before proceeding
> If any answer is NO → do not build a trade plan. Stop here.

1. Is HTF bias clear and D + 4H aligned in the same direction?
2. Am I currently inside London (02:00–05:00 EST) or NY (07:00–10:00 EST) killzone?
3. No high-impact news within the next 30 minutes?
4. BOS or CHoCH confirmed on 15M in the direction of HTF bias (closed candle)?
5. Is price in discount zone (buy) or premium zone (sell) of the HTF swing range?
6. Is a clear DOL target identified and reachable within remaining ADR?
7. Does the entry trigger come from a CLOSED candle — not a live candle?
8. Is RR ≥ 2 with the planned SL placement?
9. Is position size calculated and within 1% max risk?
10. Is a mid-trade invalidation level defined before entry?

---

## QUALITY FILTERS — Applied at every step
These raise grade, reduce risk, and prevent low-probability entries.

**Structural Cleanliness:** If 15M shows >60% overlapping candle bodies in the last 20 candles → choppy structure → skip. Only trade clean impulsive swings with clear swing highs/lows.

**Confluence Stacking:** Entry zone must have ≥ 2 overlapping PD arrays (e.g. OB + FVG, OB + Fib 0.618–0.79, Breaker + FVG). Single-array entries are grade C maximum.

**Candle Close Rule:** NEVER enter on a live candle. Entry trigger is only valid on a confirmed 15M close inside the zone or beyond the level.

**ADR Remaining Rule:** Remaining daily range must be ≥ 2× the SL distance to reach TP1 with room. If ADR is >70% consumed → no new entries except scalp.

**DXY Alignment (USDCAD-specific):** Check DXY on 4H. DXY bullish → USD bid → supports USDCAD buys. DXY bearish → supports USDCAD sells. Misalignment between DXY 4H and your trade direction = Medium demerit.

**Oil Inverse Correlation (USDCAD-specific):** Crude oil and CAD are positively correlated. Oil bullish → CAD strengthens → USDCAD sell pressure. Oil bearish → USDCAD buy pressure. Confirm oil direction on 4H before entry.

**Liquidity Taken Before Entry:** For buys: has nearby SSL (recent swing low) been swept first? For sells: has nearby BSL been swept? Entering before liquidity is taken = entering before institutional trigger. This is a key quality gate — unswept liquidity on your side = higher-risk entry.

**Weekly Level Proximity:** If price is within 10 pips of Weekly Open, PDH, or PDL → these act as magnets. Factor into DOL selection. Avoid placing TP1 beyond a weekly level without confluence.

**Session Loss Rule:** After 2 consecutive stop-outs on USDCAD in the same session → stop trading that session. Resume next killzone only.

**Price Delivery Check:** Is the current move to the entry zone corrective (overlapping, slow) or impulsive (clean, directional)? Corrective delivery to an OB = higher probability mitigation. Impulsive delivery past your zone = zone likely broken.

---

## STEP 1 — HTF ANALYSIS (D and 4H)

For each HTF, identify:
- **Trend:** Bullish (HH/HL chain) | Bearish (LH/LL chain) | Ranging
- **Bias:** Long (last BOS up or CHoCH bull) | Short (last BOS down or CHoCH bear) | Neutral
- **what_price_just_did:** One factual past-tense sentence.
- **what_price_likely_does_next:** One forward-looking sentence.
- **Draw on Liquidity:** Nearest unswept BSL/SSL or unfilled HTF FVG. Explain WHY in narrative. This is TP2 or TP3.
- **Reference Zones:** Map only zones with a role in this trade. IDs: `D-OB-1`, `4H-FVG-2`.
  - `TP_Target` | `Entry_Boundary` | `DOL` | `Invalidation`

HTF does not provide entry signals or score confluence.

---

## STEP 2 — LTF ANALYSIS (15M and 5M)

- **Structure:** BOS/CHoCH chain must align with HTF bias. Conflict = red flag, note it.
- **PD Arrays:** Only zones within ~1–2% of current price. IDs: `15M-OB-1`, `5M-FVG-1`.
- **Key Levels:** Only those relevant to entry, SL, or TP1.
- **Expected Path:** Step-by-step conditions price must satisfy before trigger fires. Each step has `required_condition`. Model triggers only after all steps complete.
- **Key Events:** BOS/CHoCH candles, sweeps, rejections — include price and time if visible.

---

## STEP 3 — CHECKLIST SCORING

Score BUY and SELL independently. Use best individual strategy score. Gate must pass before Step 4.

**Scoring:** High = 3 pts | Medium = 2 pts | Low = 1 pt
`weighted_score = ROUND(points_passed / points_total × 100)`

**Gate:** `high_weight_passed / high_weight_total ≥ 0.75` → else `trade_plan = []`, stop.

**passed_items[]:** Confirmed items only. Be specific — reference zone ID and exact price.
**failed_critical[]:** Failed High items only — include impact statement. Medium/Low failures are silent.

### Unified Checklist (all strategies)

| Weight | Category | Condition |
|---|---|---|
| High | Session | London 02:00–05:00 EST or NY 07:00–10:00 EST active |
| High | Structure | D and 4H bias aligned same direction |
| High | Structure | BOS or CHoCH confirmed on 15M (closed candle, body close) |
| High | PD_Arrays | Price in discount (buy) or premium (sell) of HTF swing range |
| High | Liquidity | DOL identified — unswept BSL/SSL or HTF FVG within ADR |
| High | Structure | No conflicting BOS/CHoCH on intermediate TF (1H) |
| Medium | PD_Arrays | Displacement candle on LTF — impulsive move leaving visible FVG |
| Medium | Confluence | ≥ 2 PD arrays overlapping at entry zone |
| Medium | Correlation | DXY 4H aligned with trade direction (USDCAD) |
| Medium | Correlation | Oil 4H direction supports trade direction (inverse for USDCAD) |
| Medium | Risk | ADR remaining ≥ 2× SL distance |
| Medium | Delivery | Price delivery to zone is corrective (preferred) not impulsive |
| Medium | Liquidity | Liquidity on trade side has been swept before entry |
| Low | Risk | No high-impact news within 30 min of entry |
| Low | Structure | Clean structure — not choppy/overlapping on 15M |
| Low | Candle | Entry trigger is on closed candle only |

---

## STEP 4 — ENTRY MODEL SELECTION

Only after gate passes. `entry_model` must exactly match a name below.

### ICT Models

| Model | Core Trigger | SL | Key Rule |
|---|---|---|---|
| OB + FVG Confluence | Price retrace into OB containing unfilled FVG; 15M candle close inside OB with rejection wick | Below OB bottom / above OB top + 2–5 pip | BOS confirmed first; London or NY session only |
| Breaker Block Retest | Former OB broken and flipped; price retests breaker boundary; rejection candle close | Beyond breaker zone extreme + 3–5 pip | Original OB must be broken AND flipped — not just tapped |
| Silver Bullet | **10:00–11:00 AM EST only.** Displacement FVG on 5M/15M; price retraces into FVG; 5M close inside | Below displacement candle low (buy) | Hard time rule; FVG must not be pre-filled; no overnight hold |
| Power of 3 (AMD) | Asian accumulation range identified; London sweeps it; 15M closes back inside range | Beyond manipulation sweep + 5 pip | Entry only AFTER close-back inside range. Never on the sweep. |
| Judas Swing | London false move sweeps Asian liquidity; 15M CHoCH confirms; entry at pullback into fresh 5M OB/FVG | Beyond Judas swing extreme | Entry only AFTER 15M CHoCH. Never on sweep. |
| CISD | Displacement candle shifts delivery state; entry on body retest of that candle's open/body range | Below CISD candle low (buy) | Body retest only — not wick retest |
| Midnight Open Rejection | Price sweeps 00:00 EST level via wick; rejection candle closes back through | Beyond wick extreme | Wick sweep only — not full body close through |

### Price Action Models

| Model | Core Trigger | SL | Key Rule |
|---|---|---|---|
| Pin Bar Rejection | Wick >2× body; wick pierces key level; body closes away; enter next open or 50% body retest | Beyond wick tip | Pre-identified level required; wick/body ratio confirmed |
| Engulfing at Structure | Body fully engulfs prior candle body at HTF level; enter on close or midpoint retest | Beyond engulfing candle low/high | Body engulf only — wick-to-wick insufficient |
| Inside Bar Breakout | Candle contained within mother bar; enter on breakout candle close beyond mother bar | Opposite side of mother bar | Mother bar = consolidation signal; no prior breach of IB range |
| Fakey (False Breakout) | Inside bar forms; false break beyond mother bar; reverse-close back inside within 1–2 candles | Beyond false break wick extreme | Inside bar must exist FIRST; reverse candle must close INSIDE mother bar |
| Quasimodo (QM) | Trend HH then failed HL (forms LL instead); entry at retest of last HL now resistance | Beyond failed HH/LL extreme | Requires ≥ 2 prior HH/HL or LH/LL; LL must be confirmed |
| V-Shape Reversal | Sharp drop; recovery candle closes above 50% midpoint within 1–2 candles | Below absolute low | Drop must be sharp; recovery must be fast — slow = retracement |

### Market Structure Models

| Model | Core Trigger | SL | Key Rule |
|---|---|---|---|
| BOS + Retest | Body close beyond swing confirms BOS; price retests broken level; rejection candle forms | Beyond retest zone + 3–5 pip | Body close required for BOS — wick-only invalid |
| CHoCH Entry | First CHoCH after established trend; LTF pullback to CHoCH origin OB/FVG | Below CHoCH swing low (buy) | First CHoCH only; prior established trend required; invalid in ranging |
| EQH/EQL Sweep + Reverse | ≥2 touches at same level; small overshoot; next candle closes back through EQH/EQL | Beyond sweep wick extreme | Overshoot must be small — large break = breakout not sweep |
| MSB Confirmation | HTF MSB already confirmed; 15M CHoCH aligns; entry at LTF pullback into fresh OB/FVG | Below LTF CHoCH swing low (buy) | HTF MSB must ALREADY be confirmed — not anticipated |
| Displacement + Rebalance | Impulsive FVG left by displacement; entry at 50% FVG midpoint with 5M rejection visible | Below full FVG range (buy) | FVG must be from impulsive move; gap must remain unfilled |

---

## STEP 5 — TRADE PLAN CONSTRUCTION

All must be true — else `trade_plan = []`:
- Gate passed (high ≥ 0.75) AND `weighted_score ≥ 65`
- Entry trigger identifiable now or imminently on LTF
- `risk_reward ≥ 2`
- Remaining ADR ≥ 2× SL distance
- No unresolved conflicting HTF structure

**Entry:** LTF PD array zone (OB top/bottom; FVG 50% midpoint)
**SL:** Beyond zone extreme + buffer. Never inside the zone.
**TP1:** Nearest LTF liquidity (EQH/EQL, PDH/PDL) within ADR
**TP2:** HTF reference_zone ID from htf_context
**TP3:** HTF DOL target ID from htf_context

**TP split:** TP1 = 50% | TP2 = 30% | TP3 = 20%
**Breakeven trigger:** Move SL to entry after TP1 is hit.

**Order type:**
- `Limit` → price not yet at zone (default)
- `Stop Limit` → breakout candle close required first
- `Market` → estimate_candles = 0 AND limit would miss trade

**Grade and risk:**

| Grade | Condition | Risk |
|---|---|---|
| A | Score ≥ 85 · All High passed · RR ≥ 3 | 1.0% |
| B | Score 65–84 · Gate passed · RR ≥ 2 | 0.5% |
| C | Score 50–64 · RR borderline | 0.25% |
| NoTrade | Score < 50 · Gate failed · RR < 2 | — |

---

## GENERAL RULES
- Analyze HTF → LTF. Never reverse.
- Max 2 trade plans. Sort descending by `confidence_pct`.
- Never generate BUY + SELL simultaneously unless both pass gate independently.
- PD array IDs must be consistent across ltf_analysis, checklist, and trade_plan.
- All TP2/TP3 `reference` fields must link to a real `htf_context.reference_zones[].id`.
- Use `""` when evidence is weak — never fabricate narrative.
- Return STRICT JSON only. No markdown, no prose outside JSON.

**Schema limits (v2.3):** max 2 trade plans · 6 PD arrays · 6 key levels · 6 reference zones · 8 key events · 5 expected path steps
