# Chart Snapshot Save Settings Not Persisted After Refresh

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `N/A`
- Updated: `2026-05-21 09:43 UTC`

## Problem

On the Chart Snapshots page, clicking **Save** shows a green toast "Settings saved" and an inline "Saved" status — but after a page refresh, the toolbar values (`bars`, `quality`, `merge`) revert to their defaults (`300 bars`, `Q80`, `Merge: true`). The save appears to succeed but the values do not survive a reload.

**Screenshot evidence:**
- Toolbar: `1M | 300 bars | Q80 | ☑ Merge | + | -` → user changes values → clicks Save → toast appears
- After refresh: same default values restored

## Investigation

### Root Cause Found ✅

**File:** `src/ui/src/pages/ai/ChartSnapshotsPage.jsx` — `useEffect` on mount (L2519–2529)

**Bug:** Wrong response key used when reading back saved settings.

```src/ui/src/pages/ai/ChartSnapshotsPage.jsx#L2519-2529
// Load ANALYSE_SETTINGS from user_settings on mount
useEffect(() => {
  api.getSettings().then(res => {
    const s = (res?.items || []).find(x => x.type === 'settings' && x.name === 'ANALYSE_SETTINGS');
    //              ^^^^ BUG: should be res?.settings
    if (s?.data && typeof s.data === 'object') {
      setCfg(prev => ({ ...prev, ...s.data }));
    }
  }).catch(() => {});
}, []);
```

**API contract:** `GET /v2/settings` returns `{ ok: true, settings: [...] }` (server.js L17585).

The code reads `res?.items` → `undefined` → `.find()` returns `undefined` → settings are never applied → `DEFAULT_CONFIG` always wins.

Compare with `loadWatchlist` at L4413 which correctly uses `out?.settings`:
```src/ui/src/pages/ai/ChartSnapshotsPage.jsx#L4413-4415
const settings = Array.isArray(out?.settings) ? out.settings : [];
```

**Save path is correct:** `saveSettings` (L2531–2545) calls `api.upsertSetting` which does an `INSERT … ON CONFLICT DO UPDATE` in `user_settings` table — data IS written to DB. The toast is truthful. Only the load is broken.

### Evidence Summary
- `api.getSettings()` → `{ ok: true, settings: [] }` — key is `settings`
- Load code reads `res?.items` — key is `items` — always `undefined`
- `saveSettings` correctly persists `{ lookbackBars, snapshotQuality, mergeSnapshots }` to DB
- `loadWatchlist` uses `out?.settings` — correct pattern
- No other load path re-applies these values after mount

### Open Questions
- Confirm: is there a second override path (e.g. `handleSelectTemplate`) that resets `cfg` before the async load resolves?
  - Candidate: `handleSelectTemplate` (L4356–4401) resets `cfg` to `DEFAULT_CONFIG`. If it fires concurrently with the load `useEffect`, it could clobber the result. Investigate ordering.

## Solution

### Fix 1 — Wrong key on load (required)

**File:** `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`

Change line ~2524:
```/dev/null/before.jsx#L1-1
const s = (res?.items || []).find(x => x.type === 'settings' && x.name === 'ANALYSE_SETTINGS');
```
→
```/dev/null/after.jsx#L1-1
const s = (res?.settings || []).find(x => x.type === 'settings' && x.name === 'ANALYSE_SETTINGS');
```

### Fix 2 — Add console.log on Save (required for verification)

In `saveSettings` callback, add a log before the API call:

```/dev/null/saveSettings-log.jsx#L1-3
console.log('[ANALYSE_SETTINGS] Saving:', {
  lookbackBars: cfg.lookbackBars, snapshotQuality: cfg.snapshotQuality, mergeSnapshots: cfg.mergeSnapshots
});
```

And on successful load in the `useEffect`:

```/dev/null/load-log.jsx#L1-2
console.log('[ANALYSE_SETTINGS] Loaded from DB:', s.data);
```

### Fix 3 — Guard against template reset race (investigate)

If `handleSelectTemplate` fires after mount and resets `cfg`, the loaded settings will be lost. Ensure the load `useEffect` either:
- runs after template selection, or
- merges only the specific fields (`lookbackBars`, `snapshotQuality`, `mergeSnapshots`) without being clobbered

Current merge is already scoped: `setCfg(prev => ({ ...prev, ...s.data }))` — this is correct as long as it runs last.

## Expected Output / Verification

- [ ] Click **Save** with non-default values (e.g. `600 bars`, `Q90`, `Merge off`)
- [ ] Console shows `[ANALYSE_SETTINGS] Saving: { lookbackBars: "600", snapshotQuality: "90", mergeSnapshots: false }`
- [ ] Console shows no error from save
- [ ] Hard-refresh page
- [ ] Console shows `[ANALYSE_SETTINGS] Loaded from DB: { lookbackBars: "600", snapshotQuality: "90", mergeSnapshots: false }`
- [ ] Toolbar shows `600 bars`, `Q90`, `Merge` unchecked
- [ ] No regression to other settings (watchlist, templates, profile TFs)
