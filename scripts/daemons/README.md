# Daemon Scripts

Reusable long-running bridge and broker helper processes.

## Files

- `v2_broker_executor_daemon.js`: paper broker executor for `/api/broker/*`
- `ctrader_downstream_server.js`: cTrader downstream service
- `ctrader_executor_bridge.js`: cTrader execution bridge
- `fetch_ctrader_bars.sh`: pull bars from cTrader broker APIs
- `mt5_csv_sync.sh`: sync MT5 CSV payloads
- `switch_demo_mode.sh`: switch VPS demo execution mode between adapters

## Run

```bash
node scripts/daemons/v2_broker_executor_daemon.js
bash scripts/daemons/mt5_csv_sync.sh
```

## Safety Notes

- Some scripts in this folder call live or remote trading infrastructure.
- `switch_demo_mode.sh` changes VPS execution wiring and should be treated carefully.
