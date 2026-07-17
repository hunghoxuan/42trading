import { useMemo, useState } from "react";
import PageHeader from "../../../shared/components/PageHeader";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import SymbolChartReplayTest from "../components/charts/SymbolChartReplayTest";

const SYMBOL_OPTIONS = [
  { value: "BTCUSD", label: "BTCUSD" },
  { value: "ETHUSD", label: "ETHUSD" },
  { value: "XAUUSD", label: "XAUUSD" },
  { value: "EURUSD", label: "EURUSD" },
];

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d" },
];

const BARS_OPTIONS = [
  { value: "1000", label: "1000" },
  { value: "2000", label: "2000" },
  { value: "4000", label: "4000" },
  { value: "8000", label: "8000" },
];

const REPLAY_SPEED_OPTIONS = [
  { value: "100", label: "0.1s" },
  { value: "200", label: "0.2s" },
  { value: "500", label: "0.5s" },
  { value: "1000", label: "1s" },
  { value: "2000", label: "2s" },
];

const REPLAY_EXPERIMENT_BUTTONS = [
  {
    key: "replay1",
    label: "Replay1",
    title: "Incrementally recompute artifacts as the replay cursor advances using completed replay bars.",
  },
  {
    key: "replay2",
    label: "Replay2",
    title: "Recompute artifacts from replay-rendered bars on every replay step, including the current replay slice.",
  },
];

export default function ReplayArtifactsTestPage() {
  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState("1m");
  const [barsCount, setBarsCount] = useState(4000);
  const [replayArtifactMode, setReplayArtifactMode] = useState("default");
  const [replaySpeedMs, setReplaySpeedMs] = useState(500);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayRunNonce, setReplayRunNonce] = useState(0);
  const [replayProgress, setReplayProgress] = useState({
    enabled: false,
    playing: false,
    progressIndex: 0,
    progressTotal: 0,
    clockTimeSec: null,
    barsVisible: 0,
    replayArtifactMode: "default",
  });

  const requestedTimeframes = useMemo(() => [String(timeframe || "1m")], [timeframe]);
  const backtestReplay = useMemo(
    () => ({
      enabled: true,
      playing: replayPlaying,
      speedMs: replaySpeedMs,
      speedOptions: REPLAY_SPEED_OPTIONS.map((option) => ({
        value: Number(option.value),
        label: option.label,
      })),
      runKey: [
        "replay-test",
        symbol,
        timeframe,
        barsCount,
        replayRunNonce,
      ].join("|"),
      startTradeSid: "",
      currentTradeIndex: -1,
      totalTrades: 1,
      onSpeedChange: (nextSpeedMs) =>
        setReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 500)),
      onToggle: () => setReplayPlaying((prev) => !prev),
      onComplete: () => setReplayPlaying(false),
    }),
    [barsCount, replayPlaying, replayRunNonce, replaySpeedMs, symbol, timeframe],
  );

  const statusText = replayProgress.playing
    ? `${String(replayProgress.replayArtifactMode || replayArtifactMode)} · ${Number(replayProgress.progressIndex) || 0}/${Number(replayProgress.progressTotal) || 0}`
    : `ready · mode ${replayArtifactMode}`;

  const debugText = [
    `playing=${replayProgress.playing ? "1" : "0"}`,
    `bars=${Number(replayProgress.barsVisible) || 0}`,
    `progress=${Number(replayProgress.progressIndex) || 0}/${Number(replayProgress.progressTotal) || 0}`,
    `clock=${Number.isFinite(Number(replayProgress.clockTimeSec)) ? Number(replayProgress.clockTimeSec) : "n/a"}`,
  ].join(" | ");

  const triggerReplay = (mode = "default") => {
    const normalizedMode = ["replay1", "replay2"].includes(String(mode || "").trim().toLowerCase())
      ? String(mode || "").trim().toLowerCase()
      : "default";
    setReplayArtifactMode(normalizedMode);
    setReplayRunNonce((prev) => prev + 1);
    setReplayPlaying(true);
  };

  return (
    <div className="stack-layout" style={{ gap: 14 }}>
      <PageHeader
        title="Replay Artifact Test"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <InputComboSelect
              value={symbol}
              onChange={(event) => setSymbol(String(event.target.value || "BTCUSD"))}
              style={{ minWidth: 120 }}
            >
              {SYMBOL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
            <InputComboSelect
              value={timeframe}
              onChange={(event) => setTimeframe(String(event.target.value || "1m"))}
              style={{ minWidth: 88 }}
            >
              {TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
            <InputComboSelect
              value={String(barsCount)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setBarsCount(Number.isFinite(next) && next > 0 ? next : 4000);
              }}
              style={{ minWidth: 96 }}
            >
              {BARS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </InputComboSelect>
          </div>
        }
      />

      <ResponsivePanel
        title="Test Notes"
        showToggle={false}
        border="always"
        bodyClassName="stack-layout"
      >
        <div className="minor-text" style={{ lineHeight: 1.6 }}>
          This page reuses the chart-native replay render path. Only artifact recompute mode changes
          between `Replay`, `Replay1`, and `Replay2`.
        </div>
        <div className="minor-text" style={{ fontSize: 11 }}>
          Status: {statusText}
        </div>
        <div className="minor-text" style={{ fontSize: 11 }}>
          {debugText}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <InputComboSelect
            value={String(replaySpeedMs)}
            onChange={(event) => {
              const next = Number(event.target.value);
              setReplaySpeedMs(Number.isFinite(next) && next > 0 ? next : 500);
            }}
            style={{ minWidth: 88 }}
          >
            {REPLAY_SPEED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InputComboSelect>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReplayPlaying((prev) => !prev)}
          >
            {replayPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => triggerReplay("default")}
          >
            Replay
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => triggerReplay("replay1")}
          >
            Replay1
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => triggerReplay("replay2")}
          >
            Replay2
          </button>
        </div>
      </ResponsivePanel>

      <SymbolChartReplayTest
        key={`${symbol}:${timeframe}:${barsCount}`}
        symbol={symbol}
        timeframes={requestedTimeframes}
        liveBars={false}
        bootstrapLiveBarsOnMount={false}
        defaultMode="cache"
        syncModeWithLocationHash={false}
        initialGridCols={1}
        initialBarsCount={barsCount}
        provider="ICMARKETS"
        skipFetch={false}
        autoLoadOnMount
        showAnalyzeButton={false}
        showTradeButton={false}
        showSnapshotButton
        showEditButton={false}
        showPerCardLayoutControls={false}
        fillViewportForFourCharts={false}
        backtestReplay={backtestReplay}
        replayArtifactExperimentMode={replayArtifactMode}
        replayArtifactExperimentButtons={REPLAY_EXPERIMENT_BUTTONS}
        onReplayArtifactExperimentModeChange={setReplayArtifactMode}
        replayTestSpeedMs={replaySpeedMs}
        onReplayProgressChange={setReplayProgress}
        hideInternalReplayControls
      />
    </div>
  );
}
