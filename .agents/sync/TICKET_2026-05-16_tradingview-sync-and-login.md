# TICKET_2026-05-16_tradingview-sync-and-login

## Image Analysis
- **Text**: `300`, `Live`, `C`, `S`, `+`, `-`
- **Context**: `SymbolChart` component header toolbar.
- **Visuals**: 
    - A dark mode toolbar with rounded buttons. 
    - `Live` button is active (blue border/glow).
    - `C` and `S` are inactive.
    - `+` and `-` for grid adjustment.
    - User wants 3 more toggle buttons and a `Login` button to appear specifically when `Live` is active.

## Analysis
The user wants to bridge the gap between "Live" (TradingView iframe) and "Static/Snapshot" (Lightweight Charts) data. 
1. **Viewport Sync**: The user requested synchronization of number of bars, time ranges, and price levels. Since the Iframe is a black box, this requires a "Live LWC" option or standardizing on the built-in chart for high-precision syncing.
2. **Account Integration**: The user wants to see their private indicators and layouts. Since the iframe doesn't support this via standard embedding, the server must perform the login via Playwright to facilitate high-quality, authenticated snapshots in "S" (Snapshot) mode.
3. **UI Enhancements**: 
    - Adding Sidebar, Top Toolbar, and Legend toggles to the Live iframe URL.
    - Adding a Login Modal for TradingView credentials.
    - Ensuring toggles and login only show in `Live` mode to prevent UI clutter in `C` and `S` modes.

## Execution Plan
1. **UI Layer (`SymbolChart.jsx`)**:
    - [ ] Add `tvSettings` state: `{ showSidebar: false, showToolbar: false, showLegend: false }`.
    - [ ] Implement `Login` button and `TradingViewLoginModal` component.
    - [ ] Add 3 toggle buttons (icons or short text) to the header.
    - [ ] Update `iframe` source logic to append `hide_side_toolbar`, `hide_top_toolbar`, and `hide_legend` based on state.
2. **State Layer**:
    - [ ] Ensure toggles/login are conditionally rendered: `mode === 'live'`.
3. **Backend Layer (`webhook/server.js`)**:
    - [ ] Implement `/v2/tv/login` endpoint.
    - [ ] Integrate Playwright script to navigate to `tradingview.com`, perform login, and store cookies in `tv_session.json`.
4. **Snapshot Integration**:
    - [ ] Update `captureTradingViewSnapshotWithBrowser` to load stored cookies if available.

## Goal & Expectation
- **Success**: User can toggle chart features on the fly in Live mode.
- **Success**: User can log in to TV once, and subsequent AI snapshots show their private indicators/layouts.
- **Verification**: UI toggles should reload the iframe with requested features. Snapshots should be audited to ensure private content is visible.

---

## Handoff & Prompt for Next Agent
**Context**: We are enhancing the TradingView integration to support multi-chart synchronization and authenticated snapshots.
**Task**: 
1. Implement the UI toggles in `SymbolChart.jsx`.
2. Implement the `/v2/tv/login` backend bridge.
**Starting Point**: Refer to `TICKET_2026-05-16_tradingview-sync-and-login.md` in `.agents/sync/`.
