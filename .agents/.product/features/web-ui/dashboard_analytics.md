# Feature: Dashboard & Analytics

## User Flow
A high-density overview of trading performance, current risk, and system health.

## Key Capabilities
- **Performance Summaries**: Balance, Equity, PnL, and Win Rate tracking.
- **Advanced Metrics**: R-Multiple (RR) tracking, Expectancy, and Drawdown analysis.
- **Interactive Charts**: PnL series visualization and account growth curves.
- **Filterable History**: Search and filter trades by symbol, account, date, or status.
- **Real-Time Feed**: Live signal and trade status updates.

## Technical Details
- **Endpoints**: `/mt5/dashboard/summary`, `/mt5/dashboard/advanced`, `/mt5/dashboard/pnl-series`.
- **Frontend**: Custom dashboard components in `web-ui/src/pages/dashboard/`.
- **Data Aggregation**: Real-time SQL aggregation of the `trades` and `user_accounts` tables.
