# Chart Snapshots Symbols Panel Filters (Plan)

## Goal
Improve symbol selection speed on AI Chart Snapshots page by adding panel visibility control and quick symbol segmentation tabs.

## User Behavior
1. User can hide/show symbols panel using `Open >>` / `Close <<` toggle button.
2. User can filter symbols by `Favourite`, `All`, `Crypto`, `Forex`.
3. `Favourite` symbols come from user settings metadata watchlist.
4. Existing search input filters the currently selected tab result.

## UX Requirements
- Remove header text `Symbols`.
- Keep search input and `+` add button.
- Add panel toggle button immediately after `+`.
- Keep dense trading-style layout; no visual regression on mobile.

## Data/State Contract
- Favorites source:
  - `GET /auth/me` -> `user.metadata.watchlist`
  - `PUT /auth/metadata` with updated `watchlist`
- No schema migration required.

## Default Asset Lists
- Crypto (fixed default): `BTCUSD`, `ETHUSD`, `ADAUSD`
- Forex (fixed default): `EURUSD`, `GBPUSD`, `USDJPY`, `AUDUSD`, `USDCAD`, `USDCHF`, `NZDUSD`, `EURJPY`, `GBPJPY`, `AUDJPY`

## Non-Goals
- No new backend endpoint.
- No change to AI analysis contract.
- No refactor of unrelated Chart Snapshots logic.

## Acceptance
- `Favourite | All | Crypto | Forex` tabs are visible and functional.
- Toggle button collapses/expands symbols area.
- Favorites persist and reload per logged-in user.
