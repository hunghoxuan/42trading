import { useEffect, useState } from "react";
import { api } from "../../../../app/api";
import ResponsivePanel from "../../../../shared/components/ResponsivePanel";
import SymbolChart from "../../components/charts/SymbolChart";
import { useReplaySession } from "../../hooks/useReplaySession";
import { useRealtimeSymbolChartAdapter } from "../../hooks/useRealtimeSymbolChartAdapter";

const TF_OPTIONS = ["1m", "5m", "15m", "1h", "4h", "d"];

export default function RealtimeChartPage() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("5m");
  const [bars, setBars] = useState(300);
  const [pollMs, setPollMs] = useState(2500);
  const [draftSymbol, setDraftSymbol] = useState("XAUUSD");
  const [draftTimeframe, setDraftTimeframe] = useState("5m");
  const [draftBars, setDraftBars] = useState("300");
  const [draftPollMs, setDraftPollMs] = useState("2500");
  const [replaySessionId, setReplaySessionId] = useState("");
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayError, setReplayError] = useState("");
  const replayState = useReplaySession(replaySessionId, 400);
  const replaySession = replayState.session;
  const chartAdapter = useRealtimeSymbolChartAdapter({
    symbol,
    timeframe,
    bars,
    pollMs,
    replaySession,
  });

  const applyConfig = (event) => {
    event.preventDefault();
    const nextSymbol = String(draftSymbol || "")
      .trim()
      .toUpperCase();
    if (!nextSymbol) return;
    setSymbol(nextSymbol);
    setTimeframe(String(draftTimeframe || "5m").trim().toLowerCase());
    setBars(Math.max(50, Math.min(5000, Number(draftBars) || 300)));
    setPollMs(Math.max(1000, Math.min(30000, Number(draftPollMs) || 2500)));
  };

  useEffect(() => {
    return () => {
      if (replaySessionId) {
        api.deleteReplaySession(replaySessionId).catch(() => {});
      }
    };
  }, [replaySessionId]);

  const createReplay = async () => {
    setReplayBusy(true);
    setReplayError("");
    try {
      if (replaySessionId) {
        await api.deleteReplaySession(replaySessionId).catch(() => {});
      }
      const response = await api.createReplaySession({
        symbol,
        timeframe,
        bars,
        pollMs: Math.max(100, Math.floor(pollMs / 2)),
      });
      const nextSessionId = String(response?.session?.sessionId || "").trim();
      if (!nextSessionId) throw new Error("Replay session was not created");
      setReplaySessionId(nextSessionId);
    } catch (error) {
      setReplayError(String(error?.message || error || "Failed to create replay"));
    } finally {
      setReplayBusy(false);
    }
  };

  const controlReplay = async (action, payload = {}) => {
    if (!replaySessionId) return;
    setReplayBusy(true);
    setReplayError("");
    try {
      await api.controlReplaySession(replaySessionId, { action, ...payload });
    } catch (error) {
      setReplayError(String(error?.message || error || "Replay control failed"));
    } finally {
      setReplayBusy(false);
    }
  };

  const destroyReplay = async () => {
    if (!replaySessionId) return;
    setReplayBusy(true);
    setReplayError("");
    try {
      await api.deleteReplaySession(replaySessionId);
      setReplaySessionId("");
    } catch (error) {
      setReplayError(String(error?.message || error || "Failed to stop replay"));
    } finally {
      setReplayBusy(false);
    }
  };

  return (
    <div className="stack-layout realtime-chart-page">
      <ResponsivePanel
        title="Realtime Chart Lab"
        subtitle="Transport-agnostic chart stream facade with SSE as the first provider."
        showToggle={false}
      >
        <form className="toolbar-panel realtime-chart-page__form" onSubmit={applyConfig}>
          <label className="realtime-chart-page__field">
            <span className="minor-text">Symbol</span>
            <input
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              className="realtime-chart-page__input"
              placeholder="XAUUSD"
            />
          </label>
          <label className="realtime-chart-page__field">
            <span className="minor-text">Timeframe</span>
            <select
              value={draftTimeframe}
              onChange={(event) => setDraftTimeframe(event.target.value)}
              className="realtime-chart-page__input"
            >
              {TF_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="realtime-chart-page__field">
            <span className="minor-text">Bars</span>
            <input
              value={draftBars}
              onChange={(event) => setDraftBars(event.target.value)}
              className="realtime-chart-page__input"
              inputMode="numeric"
            />
          </label>
          <label className="realtime-chart-page__field">
            <span className="minor-text">Poll ms</span>
            <input
              value={draftPollMs}
              onChange={(event) => setDraftPollMs(event.target.value)}
              className="realtime-chart-page__input"
              inputMode="numeric"
            />
          </label>
          <button type="submit" className="primary-button">
            Apply
          </button>
        </form>
      </ResponsivePanel>

      <ResponsivePanel
        title="Replay Session"
        subtitle="Server-owned replay cursor streamed through replay:{sessionId} topics."
        showToggle={false}
      >
        <div className="toolbar-panel realtime-chart-page__controls">
          <button
            type="button"
            className="secondary-button"
            onClick={createReplay}
            disabled={replayBusy}
          >
            {replaySessionId ? "Restart Replay" : "Create Replay"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => controlReplay("play", { pollMs: Math.max(100, Math.floor(pollMs / 2)) })}
            disabled={!replaySessionId || replayBusy}
          >
            Play
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => controlReplay("pause")}
            disabled={!replaySessionId || replayBusy}
          >
            Pause
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => controlReplay("step", { step: 1 })}
            disabled={!replaySessionId || replayBusy}
          >
            Step
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => controlReplay("reset")}
            disabled={!replaySessionId || replayBusy}
          >
            Reset
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={destroyReplay}
            disabled={!replaySessionId || replayBusy}
          >
            Stop
          </button>
        </div>
        <div className="realtime-chart-page__session-meta minor-text">
          {replaySessionId
            ? `Session ${replaySessionId} · ${replayState.connected ? "connected" : "offline"}`
            : "No replay session created yet."}
        </div>
        {replayError ? (
          <div className="realtime-chart__notice realtime-chart__notice--error">
            {replayError}
          </div>
        ) : null}
      </ResponsivePanel>

      <SymbolChart
        symbol={symbol}
        timeframes={[timeframe]}
        defaultMode="cache"
        initialBarsCount={bars}
        skipFetch
        autoLoadOnMount={false}
        showAnalyzeButton={false}
        showTradeButton={false}
        showEditButton={false}
        showSnapshotButton={false}
        showPerCardLayoutControls={false}
        externalChartData={chartAdapter}
      />
    </div>
  );
}
