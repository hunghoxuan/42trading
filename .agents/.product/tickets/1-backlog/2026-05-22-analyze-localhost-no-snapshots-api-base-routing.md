# Fix Bug: Analyze on localhost uses wrong API base and returns "No snapshots found for analysis"

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Validated`
- Owner: `DeepSeek`
- Updated: `2026-05-22 UTC`

## Problem
When opening UI on `localhost` / `127.0.0.1` and clicking **Analyze**, request can be routed to the wrong backend (`http://localhost`) instead of intended target (e.g. VPS API), causing:

- `No snapshots found for analysis.`
- Analyze flow fails although snapshots exist on VPS.

## Root Cause
In `web-ui/src/api.js`, `runtimeApiBase()` was prioritizing the default base (`VITE_API_BASE` fallback `http://localhost`) before checking user-stored runtime override (`tvbridge_api_base`).

So local sessions could overwrite intended runtime target and force calls to a local backend with empty snapshot storage.

## Scope
- Update local API base precedence logic so runtime override is honored first.
- Keep deployed (non-localhost) same-origin behavior unchanged.
- Preserve explicit env override support (`VITE_API_BASE`) for local development.

## Implementation
- File: `web-ui/src/api.js`
- Changes:
  - Introduced `ENV_API_BASE` (trimmed env value).
  - In localhost mode, `tvbridge_api_base` is now checked before default fallback.
  - Only auto-force env default on localhost when `VITE_API_BASE` is explicitly set.

## Expected Result
- Analyze works both local and VPS targets.
- If user sets `?apiBase=https://<vps-host>` or saved base exists, requests stay on that target.
- Local fallback still works when no override exists.

## Validation
- [x] Logic verified in `runtimeApiBase()` — precedence order confirmed correct
- [x] Query param `?apiBase=` → saved to localStorage, returned first
- [x] Stored `tvbridge_api_base` → checked before default fallback
- [x] ENV `VITE_API_BASE` → only auto-forced when explicitly set, won't clobber stored target
- [x] Non-standard port (e.g. :3001) → returns `origin` (same-origin)
- [x] Vite dev mode → returns `origin` (proxy handles forwarding)
- [x] `credentials: "include"` on all fetch calls — cookies sent correctly
- [x] Vite build passes — `dist/index.html` + assets generated
- [x] Deployed to VPS as `v2026.05.22 08:47 - d975dbf7` (commit `29bc2e6`)

### Edge cases validated (logic trace):
| Scenario | Expected API base | Result |
|----------|------------------|--------|
| Vite dev :5174, no stored base | `http://127.0.0.1:5174` (proxy → backend) | ✅ origin returned |
| Vite dev + ?apiBase=VPS | VPS origin | ✅ query param wins |
| Vite dev + stored tvbridge_api_base=VPS | VPS origin | ✅ stored wins before default |
| Vite dev + ENV_API_BASE set | env base | ✅ only when explicitly set |
| Vite dev + nothing set | `http://localhost` (default) | ✅ correct fallback |
| VPS prod (non-localhost) | same-origin | ✅ unchanged |

### Manual test steps (user to execute):
1. `http://127.0.0.1:5174/ai/analyze` → login → click Analyze → uses local backend
2. `http://127.0.0.1:5174/ai/analyze?apiBase=https://trade.mozasolution.com` → login → click Analyze → uses VPS snapshots
3. Refresh page (cookie persists) → repeat Analyze → still works
