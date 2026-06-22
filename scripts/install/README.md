# Install Scripts

Reusable machine-setup and launchd installation helpers.

## Files

- `install_local_autostart.sh`: install local stack autostart on macOS login
- `uninstall_local_autostart.sh`: remove that autostart
- `install_ctrader_executor_bridge.sh`: install the cTrader executor bridge on a VPS
- `install_ctrader_bars_launchd.sh`: schedule cTrader bar fetching
- `install_mt5_csv_sync_launchd.sh`: schedule MT5 CSV sync
- `install_token_toolchain.sh`: bootstrap common CLI tools

## Run

```bash
bash scripts/install/install_local_autostart.sh
bash scripts/install/uninstall_local_autostart.sh
```

## Safety Notes

- These scripts can alter local launchd state or remote VPS files.
- Review required env vars before running the bridge installers.
