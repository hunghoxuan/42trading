import ChartSVG from "./ChartSVG";
import { useRealtimeChartData } from "../../hooks/useRealtimeChartData";

const STATUS_LABEL = {
  IDLE: "Idle",
  CONNECTING: "Connecting",
  READY: "Live",
  EMPTY: "No data",
  ERROR: "Error",
};

export default function RealTimeChart({
  symbol = "",
  timeframe = "5m",
  bars = 300,
  pollMs = 2500,
  height = 440,
  replaySession = null,
}) {
  const state = useRealtimeChartData({
    symbol,
    timeframe,
    bars,
    pollMs,
  });
  const replayBars = Array.isArray(replaySession?.visibleBars)
    ? replaySession.visibleBars
    : [];
  const barsToRender = replayBars.length ? replayBars : state.bars;
  const replayMode = Boolean(replaySession?.sessionId);

  const statusLabel = STATUS_LABEL[state.status] || state.status || "Idle";
  const lastUpdatedLabel = state.lastUpdatedAt
    ? new Date(state.lastUpdatedAt).toLocaleTimeString()
    : "Waiting";

  return (
    <section className="panel realtime-chart" data-component="RealTimeChart">
      <div className="realtime-chart__toolbar">
        <div>
          <div className="panel-label">Realtime Chart</div>
          <div className="minor-text">
            {String(symbol || "").toUpperCase()} · {String(timeframe || "").toUpperCase()} · {bars} bars
          </div>
          {replayMode ? (
            <div className="minor-text">
              Replay session {replaySession.sessionId} · {replaySession.playing ? "playing" : "paused"}
            </div>
          ) : null}
        </div>
        <div className="realtime-chart__status-group">
          <span
            className={[
              "realtime-chart__status-dot",
              state.status === "READY"
                ? "is-live"
                : state.status === "ERROR"
                  ? "is-error"
                  : "is-waiting",
            ].join(" ")}
          />
          <span className="minor-text">
            {statusLabel} {state.connected ? "connected" : "offline"}
          </span>
          <span className="minor-text">Updated {lastUpdatedLabel}</span>
          {replayMode ? (
            <span className="minor-text">
              Cursor {(Number(replaySession?.cursorIndex) || 0) + 1}/
              {Number(replaySession?.totalBars) || 0}
            </span>
          ) : null}
        </div>
      </div>
      {state.error ? (
        <div className="realtime-chart__notice realtime-chart__notice--error">
          {state.error}
        </div>
      ) : null}
      {!barsToRender.length && !state.error ? (
        <div className="realtime-chart__notice">
          {replayMode
            ? "Waiting for replay bars in this session."
            : "Waiting for broker bars for this symbol/timeframe."}
        </div>
      ) : null}
      {barsToRender.length ? (
        <ChartSVG
          bars={barsToRender}
          height={height}
          showLegend
          showIndicators={false}
          className="realtime-chart__svg"
        />
      ) : null}
    </section>
  );
}
