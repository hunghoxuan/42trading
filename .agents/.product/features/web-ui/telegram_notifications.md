# Feature: Telegram Notifications

## User Flow
Receive real-time alerts about system events directly on your phone.

## Key Capabilities
- **Signal Alerts**: Notification when a new AI signal is generated.
- **Trade Execution**: Alerts for new orders, fills, and closures.
- **System Health**: Notifications about VPS issues or EA connection drops.
- **Rich Formatting**: Uses Markdown for clean, readable messages with emojis for status indication.

## Technical Details
- **Provider**: Telegram Bot API.
- **Configuration**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.
- **Logic**: Centralized `sendTelegramMessage` helper in `webhook/server.js`.
