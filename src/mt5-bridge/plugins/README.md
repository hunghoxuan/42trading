# 42trade cTrader backtest worker

`BacktestWorkerPlugin.cs` is a native cTrader Plugin that claims queued jobs from 42trade, runs several `BacktestingProcess` instances in parallel, and posts cTrader JSON/HTML reports back to the 42trade History store.

## Local installation

The active cTrader project on this Mac is `BacktestWorker42trade`. This repository file is the source of truth. Before building, copy the entire source file into the active project so cTrader cloud synchronisation cannot overwrite the repository copy:

```sh
cp src/mt5-bridge/plugins/BacktestWorkerPlugin.cs \
  ~/cAlgo/Sources/Plugins/BacktestWorker42trade/BacktestWorker42trade/BacktestWorkerPlugin.cs
```

The active project is:

`~/cAlgo/Sources/Plugins/BacktestWorker42trade/BacktestWorker42trade/BacktestWorker42trade.csproj`

Pin the project to the Automate API shipped by the installed cTrader build. cTrader 5.9.142 on this Mac uses `cTrader.Automate` `1.0.19`:

```xml
<PackageReference Include="cTrader.Automate" Version="1.0.19" />
```

Using a newer wildcard package can compile successfully but fail at runtime when `BacktestingSettings` members do not exist in the installed application.

Build the plugin in cTrader, then set:

- `42trade API`: `http://127.0.0.1:3001`
- `API Key`: the existing 42trade signal API key
- `Worker ID`: a stable unique name for this cTrader installation
- `Max Parallel`: maximum native backtests to run at once (default `3`)
- `Poll Seconds`: queue polling interval (default `3`)

In 42trade, open **Backtests → cTrader Queue**, define the cBot, symbols, timeframes, date range, costs, and any cBot parameter overrides, then queue the batch. Completed jobs appear in normal Backtest History and retain their launch configuration and native HTML report path.

## Native plugin versus cTrader CLI

The plugin uses cTrader's native `Backtesting.Start` engine inside the running desktop application. It adds 42trade queue orchestration, parallel slots, parameter/result capture, and automatic History storage; it does not implement a separate simulator.

The official `ctrader-cli backtest` command runs the same cTrader backtesting capability headlessly and is better suited to shell jobs, schedulers, and process pools. It requires the official CLI, account credentials, and a .NET 8 cBot build. The desktop plugin requires cTrader to remain open, while CLI workers do not require the cTrader UI.

42trade's headless queue consumer is `src/mt5-bridge/ctraderCliWorker.js`. Configure it with:

```sh
SIGNAL_API_KEY=... \
CTRADER_CLI_PATH="$HOME/.local/bin/ctrader-cli" \
CTRADER_CTID=... \
CTRADER_PWD_FILE=/absolute/path/to/ctrader-cli.pwd \
CTRADER_ACCOUNT=... \
CTRADER_CBOT_PATH=/absolute/path/to/tvbridge.algo \
CTRADER_WORKER_MAX_PARALLEL=3 \
node src/mt5-bridge/ctraderCliWorker.js
```

Append `--check` to validate the paths and environment without claiming a job.

Choose **cTrader CLI (headless)** in the 42trade queue form. CLI and plugin jobs are isolated, so a desktop plugin cannot accidentally claim a headless job. The CLI worker writes one private parameter set, log, JSON report, HTML report, and data directory per job under `~/.local/share/42trade/ctrader/`, then sends the full resolved parameter snapshot and report to 42trade History.
