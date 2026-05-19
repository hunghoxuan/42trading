# Feature: MT5 Broker Bridge

## User Flow
Seamlessly connects the web dashboard to the MetaTrader 5 (MT5) terminal. No manual entry required.

## Key Capabilities
- **Poll-Based Execution**: The MT5 Expert Advisor (EA) polls the server for new trades every second.
- **Bi-Directional Sync**:
    - **Downstream**: EA pulls new trades and modifications from the server.
    - **Upstream**: EA pushes account balance, equity, and open positions back to the dashboard.
- **Health Monitoring**: VPS and EA heartbeat tracking to ensure the connection is live.
- **Bulk Sync**: High-efficiency synchronization of multiple trades in a single request.

## Technical Details
- **Endpoints**: `/mt5/ea/pull`, `/mt5/ea/ack`, `/mt5/ea/sync`, `/mt5/ea/heartbeat`.
- **Security**: API key validation for EA requests.
- **Architecture**: Queue-based system where trades are "Leased" by the EA to prevent double execution.
