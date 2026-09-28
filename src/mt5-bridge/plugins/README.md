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

Build the plugin in cTrader, then set:

- `42trade API`: `http://127.0.0.1:3001`
- `API Key`: the existing 42trade signal API key
- `Worker ID`: a stable unique name for this cTrader installation
- `Max Parallel`: maximum native backtests to run at once (default `3`)
- `Poll Seconds`: queue polling interval (default `3`)

In 42trade, open **Backtests → cTrader Queue**, define the cBot, symbols, timeframes, date range, costs, and any cBot parameter overrides, then queue the batch. Completed jobs appear in normal Backtest History and retain their launch configuration and native HTML report path.
