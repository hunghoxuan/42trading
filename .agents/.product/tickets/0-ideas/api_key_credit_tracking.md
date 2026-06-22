# Feature: API Key Management & Credit Tracking

## Overview
Modernize API key storage and management to include real-time credit/balance tracking for AI and data providers. This ensures users are aware of their remaining quotas directly from the settings dashboard.

## 1. Schema Refactor
The `user_settings` records of type `api_key` will move from a simple string-based value to a structured metadata object.

**From (Encrypted JSON):**
```json
{
  "value": "sk-..."
}
```

**To (Encrypted JSON):**
```json
{
  "api_key": "sk-...",
  "credits": 15.20,
  "updated_at": "2026-05-06T14:58:00Z",
  "provider_metadata": {
    "usage_month": 2.45,
    "limit": 50.00
  }
}
```

## 2. Technical Components

### A. Backend Services (`webhook/server.js`)
- **Compatibility Layer**: Update `loadUserApiKeysMap` to handle both `dec.value` and `dec.api_key` to ensure zero downtime during migration.
- **Credit Refresh Service**: A dedicated background service that calls provider APIs:
    - **OpenRouter**: Uses `/api/v1/auth/key` for balance.
    - **Google/OpenAI**: Uses usage/billing endpoints where available.
- **Manual Refresh API**: `POST /api/settings/api-key/refresh` to trigger an immediate update.
- **Cron Integration**: Periodic updates (e.g., every 12 hours) via the internal cron engine.

### B. Frontend UI (`src/ui`)
- **Settings Panel Upgrade**:
    - Replace the single "value" field with a "Key & Balance" section.
    - Show a `Credits` badge next to the key name.
    - Add a "Refresh Credits" button with a loading state.
- **Input Masking**: Maintain "Eye" (reveal) and "Copy" functionality.

## 3. Implementation Plan
1. **Phase 1**: Backend migration script to convert existing string values to the new object schema.
2. **Phase 2**: Add the `api-key/refresh` endpoint and credit-fetching logic.
3. **Phase 3**: Update the Settings dashboard UI components.
4. **Phase 4**: Enable the background cron job for automatic updates.

## 4. Documentation Strategy
- Link to [../architecture/db-schema.md] for `user_settings` table details.
- Add to [../tickets/feature_tracker.md] as a planned feature.
