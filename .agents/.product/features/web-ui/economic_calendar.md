# Feature: Economic Calendar

## User Flow
Stay informed about high-impact economic news that could affect your trades.

## Key Capabilities
- **High-Impact Filtering**: Automatically filters for "High" impact news events (Red Folders).
- **Automated Sync**: Background worker refreshes news every hour from ForexFactory.
- **Context Injection**: AI signals can incorporate upcoming news events into their analysis.
- **Dashboard Display**: Real-time ticker or list of today's relevant events.

## Technical Details
- **Provider**: ForexFactory JSON feed.
- **Logic**: `refreshEconomicCalendar` background job in `webhook/server.js`.
- **Caching**: News is stored in a dedicated memory cache with a 24h expiration.
