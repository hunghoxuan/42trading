# Skill: AI Analyze JSON + Auto Save Signals

Use this skill when running chart snapshot analysis that must:
- return strict JSON in schema format (`version: "2.7"`, `analysis_data[]`, `trade_plan[]`)
- persist returned trade plans into VPS `signals` DB records

## Source of Truth
- Prompt contract: `config/guide_system.md`
- JSON schema: `config/ai_response_schema.json`
- Mapping rules: `config/response_mapping.json`

## Required Request Pattern
- Endpoint: `POST /v2/chart/snapshots/analyze`
- Include:
  - `prompt`: full strategy prompt (session config + checklist + schema constraints)
  - `schema`: explicit schema text
  - `auto_save: "signals"` to persist trade plans in DB

## Required Response Behavior
- Strict JSON only (no markdown/prose)
- Must include trade plans for configured symbols when charts are readable
- Ensure each plan has actionable levels:
  - `entry_price` (or `entry`)
  - `stop_loss` (or `sl`)
  - TP resolved from first valid of:
    - `tp`, `take_profit`, `breakeven_trigger`, `tp1/tp2/tp3`,
    - `multiple_exits.tp1/tp2/tp3/full_tp.price`

## Auto Save Expectations
- On `auto_save: "signals"`, backend stores each valid trade plan as a signal row
- `auto_save_result` should return:
  - `saved: true`
  - `created: <count>`
  - `signals: [{ signal_id, sid, symbol }, ...]`

## Quick Verification
1. Run analyze request with `auto_save: "signals"`.
2. Confirm `parsed_json.trade_plan.length > 0`.
3. Confirm `auto_save_result.created >= 1`.
4. Confirm `signals` table has matching `sid/symbol/entry/sl/tp`.

