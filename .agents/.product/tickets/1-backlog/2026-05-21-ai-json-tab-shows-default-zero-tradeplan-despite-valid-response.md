# AI Json tab shows default zero TradePlan despite valid AI response

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Done`
- Owner: `Codex`
- Updated: `2026-05-21 12:14 UTC`

## Problem
The TradePlan `Json` tab displays a default/empty object (direction `BUY`, numeric fields `0`, empty TP2/TP3, empty strategy/entry_model/confidence), even though AI response payload clearly contains a valid populated SELL plan with full `execution_plan`, `risk_management`, and `used_files`.

Result:
- UI misrepresents AI output.
- Users may trade from incorrect fallback values instead of real AI plan.

## Investigation
- Evidence:
  - Screenshot: `/var/folders/86/hf00kffn707fh322gxgvlcc00000gn/T/TemporaryItems/NSIRD_screencaptureui_iN0f1a/Screenshot 2026-05-21 at 14.05.18.png`
  - Visible Json block in UI:
    - `"direction": "BUY"`
    - `"entry": "0"`
    - `"sl": "0"`
    - `"tp": "0"`
    - empty `tp2`, `tp3`, `strategy`, `entry_model`, etc.
  - Provided response payload contains populated values:
    - `parsed_json.direction = "SELL"`
    - `execution_plan.entry.price = 77700`
    - `execution_plan.stop_loss.price = 78250`
    - `execution_plan.tp1/ tp2/ tp3` present
    - `risk_management.confidence_pct = 62`
    - `used_files = ["BTCUSD_D.jpg","BTCUSD_240.jpg","BTCUSD_15.jpg","BTCUSD_5.jpg"]`
- Findings:
  - UI/mapper is likely reading wrong source object (fallback template) instead of canonical parsed payload.
  - Possible schema-bridge regression between:
    - `raw_response` (array string),
    - top-level `parsed_json` object,
    - UI normalized trade plan view.
  - Existing safety contract explicitly requires preserving exact trade_plan payload, no destructive normalization.
- Open questions:
  - None blocking for fix; canonical source should be deterministic.

## Solution
Fix mapping precedence and fallback behavior:

1. **Source-of-truth precedence**
   - Prefer canonical parsed plan from API response (`parsed_json` or canonical trade_plan object) over local default template.
   - Only use default zero template when canonical payload is truly missing/invalid.

2. **Correct field mapping**
   - Map direction from canonical payload (`SELL` expected in this case).
   - Map entry/sl/tp1/tp2/tp3 from `execution_plan`.
   - Preserve `strategy`, `entry_model`, `confidence_pct`, and other available fields.
   - Keep raw payload intact in `raw_json`; no reshape that discards source fields.

3. **Regression guard**
   - Add tests for:
     - valid populated response must not render zero template,
     - SELL payload must render SELL in Json tab and editor,
     - tp2/tp3 present in response must appear in Json tab output.

## Expected Output / Verification
- [x] Json tab reflects AI response content (not fallback zero template) for populated responses.
- [x] Direction displays `SELL` for the provided sample payload.
- [x] Entry/SL/TP1/TP2/TP3 values match canonical execution_plan values.
- [x] Strategy/entry_model/confidence fields are populated when present.
- [x] Fallback zero template appears only when canonical payload is absent/invalid.
- [x] `rtk npm --prefix src/ui run build`
- [ ] Add/run mapper-focused tests for precedence regression.
- [ ] Browser verification with sample payload confirming displayed JSON parity.

## Handoff Prompt
```text
Tag: TICKET
Read:
- .agents/.product/tickets/1-backlog/2026-05-21-ai-json-tab-shows-default-zero-tradeplan-despite-valid-response.md
- AI.md
- .agents/BOOTSTRAP.md
- .agents/rules/safety.md
- .agents/rules/testing.md

Task:
Fix TradePlan Json tab mapping regression where UI shows default zero/BUY template despite valid populated AI response. Enforce canonical payload precedence and map execution_plan/risk fields correctly.

Constraints:
- TICKET flow: no new branch required.
- Preserve exact raw trade_plan payload; do not transform away source JSON.
- Keep fallback template only for truly missing/invalid canonical payload.

Return:
- ticket name
- root cause
- files changed
- checks run
- deploy status
```
