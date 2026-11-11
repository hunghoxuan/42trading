# cTrader automatic log retention

`TVBridge_CTrader.LogMaintenance.cs` is a required partial of `TVBridgeCBot`.
Include it beside the main source when copying or building the cBot.

- Check every 30 seconds of real elapsed time, scheduled from startup, timer and stop callbacks.
- Run file maintenance in a background task, with one scan at a time per cBot process.
- Trim files larger than 10 MiB to at most 2 MiB, retaining the newest complete UTF-8 lines and a trim notice.
- Scan this cBot assembly's native `log.txt` files below `cAlgo/Data/cBots/<assembly>` in the user home and Documents folders, plus `/tmp/42trade-bridge-debug.log` when present. Skip symbolic links and inaccessible subdirectories.
- Leave settings, event data, trade evidence JSON and market history untouched.
- Require an exclusive file handle before rewriting. Locked files are skipped and retried on a later scan. Consequently a log can exceed the limit while cTrader keeps it open; this is a retention threshold, not a hard cap on an active native writer.
- Maintenance failures never stop the cBot. A successful scan prints one summary message.

Break-even protection also remembers accepted SL changes per position. This prevents repeated successful modifications and native broker messages when a backtest exposes an old `Position.StopLoss` snapshot. Failed or throwing modifications restore the previous guard, allowing retries. Position closure clears the guard.

The thresholds are code defaults and add no cTrader parameters. Existing running instances must restart to load the new build.

Verification: `.local/log-retention-check/Check.csproj` runs retention, UTF-8 boundary, lock/retry, and successful/failed/reentrant break-even checks against the built cBot DLL.
