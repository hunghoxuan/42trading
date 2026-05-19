# Feature: Unified Settings Dashboard

## User Flow
A single control panel to manage API keys (Gemini, Claude, OpenAI), symbols, and automated cron jobs.

## Key Capabilities
- **High Performance**: Caching system (StateRepo) reduces DB hits for setting reads.
- **Security**: Sensitive keys are encrypted in DB and only decrypted on-demand via the "Reveal" UI.
- **Dynamic Controls**: Inline toggles for cron job status (Active/Inactive).
- **Timezone Mode Toggle**: UI supports client-side `Local` vs `Selected Timezone` mode switching from the session clock, and this mode applies to all `showDateTime` outputs without server refresh.
- **Live Chart Timezone Sync**: TradingView live iframe charts receive the effective timezone parameter so chart axis time follows the same Local/Selected mode.

## Implementation Details
- **Backend**: `StateRepo` bucket `USER_SETTINGS` (6h TTL).
- **Frontend**: `SettingsPage.jsx` with unified "CONFIGURATIONS" view.
- **Client Runtime**:
  - `ui_display_timezone` stores the selected timezone.
  - `ui_display_timezone_mode` stores `selected|local`.
  - `ui-timezone-changed` browser event triggers instant rerender/update across UI.
- **Storage**: `user_settings` table with `type` and `name` unique constraints.
