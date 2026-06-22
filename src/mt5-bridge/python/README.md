# src/mt5-bridge/python

Purpose: dedicated internal Python MT5 bridge for `42trade`.

Current status:
- health endpoints are live
- read-only bridge endpoints are implemented
- execution endpoints are intentionally not implemented yet

Implemented endpoints:
- `GET /health`
- `GET /ready`
- `GET /bridge/health`
- `POST /bridge/account/summary`
- `POST /bridge/account/readiness`
- `POST /bridge/account/positions`
- `POST /bridge/account/orders`
- `POST /bridge/account/deals`
- `POST /bridge/market/quote`

Auth:
- optional `x-bridge-key: <MT5_PYTHON_BRIDGE_API_KEY>`
- or `Authorization: Bearer <MT5_PYTHON_BRIDGE_API_KEY>`

Runtime note:
- real MT5 connectivity requires the `MetaTrader5` Python package and a Windows MT5 terminal host
- on macOS/Linux, health works but MT5-backed read endpoints will return bridge runtime errors

Next phase:
- add execution endpoints
- add Node internal bridge client
- add feature-flagged bridge routing from `src/api`
