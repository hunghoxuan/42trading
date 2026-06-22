# Tests

Purpose: canonical home for repo-level tests.

## Canonical Rule

- All repo-level tests live in `tests/`.
- Do not create new tests in `scripts/test/`.
- `scripts/` is for operational automation only.
- Keep generated artifacts in `tests/results/`.
- Package-owned framework tests may keep their package-local layout only when required by that package's runner.

## Main Test Types Here

- `*.test.mjs` / `*.test.js`: node/unit regression tests
- `test_*.sh`: local/remote smoke and API verification scripts
- `test_*.py`: specialized verification helpers
- `results/`: saved logs and output artifacts

## Local Webhook Health Verification

Script: `tests/verify_webhook_local.sh`

What it does:
- Polls `http://127.0.0.1:3001/health` (or `BASE_URL`) until timeout
- Exits `0` only when `"ok":true` is observed
- Exits non-zero on timeout/failure

Run:
```bash
bash tests/verify_webhook_local.sh
PORT=3001 TIMEOUT_SEC=20 bash tests/verify_webhook_local.sh
```

## Analyze Parse Mapping Check

Script: `tests/test_analyze_parse_mapping.sh`

What it does:
- Calls `POST /api/ai/analyze`
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
API_KEY="<key>" bash tests/test_analyze_parse_mapping.sh
API_KEY="<key>" SYMBOL="CADJPY" bash tests/test_analyze_parse_mapping.sh
```

Output:
- JSON response saved to `tests/results/analyze-parse-<symbol>-<timestamp>.json`
- Console prints `[PASS]` or `[FAIL]`
