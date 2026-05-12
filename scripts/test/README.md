# Test Scripts

Purpose: run remote/local smoke tests for webhook and UI.

## Analyze Parse Mapping Check

Script: `scripts/test/test_analyze_parse_mapping.sh`

What it does:
- Calls `POST /v2/ai/analyze`
- Reads `raw_response` and `parsed_json`
- Compares trade-plan mapping (`entry`, `sl`, `tp`)
- Fails if parsed data drops fields that exist in raw response

Required env:
- `API_KEY` (required)

Optional env:
- `BASE_URL` (default: `https://trade.mozasolution.com/webhook`)
- `SYMBOL` (default: `US30`)
- `MODEL` (default: `claude-sonnet-4-0`)
- `PROVIDER` (default: `claude`)
- `BARS_COUNT` (default: `300`)
- `TIMEFRAMES` (default: `D,4H,15M,5M`)
- `PAYLOAD_FILE` (custom JSON payload file path)

Run:
```bash
API_KEY="<key>" bash scripts/test/test_analyze_parse_mapping.sh
API_KEY="<key>" SYMBOL="CADJPY" bash scripts/test/test_analyze_parse_mapping.sh
```

Output:
- JSON response saved to `test-results/analyze-parse-<symbol>-<timestamp>.json`
- Console prints `[PASS]` or `[FAIL]`
