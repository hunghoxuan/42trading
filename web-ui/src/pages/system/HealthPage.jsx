import { useState, useEffect } from "react";
import { api } from "../../api";
import LogsViewer from "../../components/LogsViewer";
import { formatRelativeDateTime } from "../../utils/format";

function StatusDot({ state = "unknown" }) {
  const cls =
    state === "ok"
      ? "ok"
      : state === "disabled"
        ? "disabled"
        : state === "error"
          ? "error"
          : "idle";
  return (
    <span
      className={`status-dot ${cls}`}
      style={{ flexShrink: 0, marginRight: 8 }}
    />
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const d = await api.health();
      setHealth(d);
      setError("");
    } catch (e) {
      setError(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);
  useEffect(() => {
    const t = setInterval(fetchHealth, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading && !health)
    return (
      <div className="panel minor-text" style={{ padding: 24 }}>
        Loading...
      </div>
    );
  if (error && !health)
    return (
      <div className="panel msg-error" style={{ padding: 24 }}>
        {error}
      </div>
    );

  const timeAgo = (iso) => {
    if (!iso) return "-";
    return formatRelativeDateTime(iso);
  };

  const logSources = health?.log_sources || {};
  const sourceLabels = {
    accounts: "ACCOUNTS",
    trades: "TRADES",
    cron: "CRON",
    api: "API",
    system: "SYSTEM",
    ui: "UI",
  };
  const isRecent = (iso) =>
    iso && Date.now() - new Date(iso).getTime() < 300000;
  const logSections = ["accounts", "cron", "api"];
  const hasLogData = logSections.some(
    (k) => logSources[k] && Object.keys(logSources[k]).length,
  );

  const Row = ({ state, label, right }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <StatusDot state={state} />
      <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span className="minor-text" style={{ marginLeft: "auto", fontSize: 11 }}>
        {right}
      </span>
    </div>
  );

  const renderSourceSection = (srcKey) => {
    const data = logSources[srcKey];
    if (!data || !Object.keys(data).length) return null;
    const labels = sourceLabels[srcKey] || srcKey;
    const resolveRowState = (source, id, lastActivityIso) => {
      if (source === "cron") {
        const idUpper = String(id || "").toUpperCase();
        if (idUpper === "BULLMQ") {
          if (health?.bullmq) {
            if (health?.bullmq?.enabled === false) return "disabled";
            return health?.bullmq?.ok ? "ok" : "error";
          }
          const qEnabled = Boolean(health?.diagnostics?.cron?.queue_enabled);
          const qReady = Boolean(health?.diagnostics?.cron?.queue_ready);
          if (!qEnabled) return "disabled";
          return qReady ? "ok" : "error";
        }
        const st = String(health?.cronStatusByName?.[id]?.status || "").toUpperCase();
        if (st) return st === "ACTIVE" ? "ok" : "disabled";
        if (idUpper.includes("ANALYSIS") || idUpper.includes("CRON_AI")) {
          return Number(health?.diagnostics?.cron?.configs?.analysis_active || 0) >
            0
            ? "ok"
            : "disabled";
        }
        if (idUpper.includes("SNAPSHOT")) {
          return Number(health?.diagnostics?.cron?.configs?.snapshots_active || 0) >
            0
            ? "ok"
            : "disabled";
        }
        if (idUpper.includes("MARKET_DATA") || idUpper.includes("CRON_MD")) {
          return Number(
            health?.diagnostics?.cron?.configs?.market_data_active || 0,
          ) > 0
            ? "ok"
            : "disabled";
        }
      }
      return isRecent(lastActivityIso) ? "ok" : "error";
    };

    return (
      <div key={srcKey} style={{ marginBottom: 14 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 12,
            textTransform: "uppercase",
            color: "var(--accent)",
            marginBottom: 6,
          }}
        >
          {labels}
        </div>
        {Object.entries(data).map(([idKey, idData]) => {
          const files = idData?.files || {};
          const fileEntries = Object.entries(files);
          // Flat source: one file, name equals ID — show as single row
          if (fileEntries.length === 1 && fileEntries[0][0] === idKey) {
            const [fName, fInfo] = fileEntries[0];
            const isSel =
              selected?.source === srcKey &&
              selected?.id === idKey &&
              selected?.file === fName;
            return (
              <div
                key={idKey}
                onClick={() => setSelected({ source: srcKey, id: idKey, file: fName })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "3px 0",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10,
                  cursor: "pointer",
                  background: isSel ? "var(--accent-soft)" : "transparent",
                  borderRadius: 2,
                }}
              >
                <StatusDot
                  state={resolveRowState(srcKey, idKey, idData?.last_activity)}
                />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 11,
                    color: isSel ? "var(--accent)" : "inherit",
                  }}
                >
                  {fName}.log
                </span>
                <span className="minor-text" style={{ marginLeft: "auto" }}>
                  {timeAgo(fInfo?.last_modified)}
                </span>
              </div>
            );
          }
          // Hierarchical source: subdirectory with multiple files
          return (
            <div key={idKey} style={{ marginBottom: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "3px 0",
                }}
              >
                <StatusDot
                  state={resolveRowState(srcKey, idKey, idData?.last_activity)}
                />
                <span style={{ fontWeight: 600, fontSize: 11 }}>{idKey}</span>
                <span
                  className="minor-text"
                  style={{ marginLeft: "auto", fontSize: 10 }}
                >
                  {timeAgo(idData?.last_activity)}
                </span>
              </div>
              {fileEntries.map(([fName, fInfo]) => {
                const isSel =
                  selected?.source === srcKey &&
                  selected?.id === idKey &&
                  selected?.file === fName;
                return (
                  <div
                    key={fName}
                    onClick={() => setSelected({ source: srcKey, id: idKey, file: fName })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginLeft: 20,
                      padding: "1px 4px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 10,
                      cursor: "pointer",
                      background: isSel ? "var(--accent-soft)" : "transparent",
                      borderRadius: 2,
                    }}
                  >
                    <span
                      style={{ color: isSel ? "var(--accent)" : "inherit" }}
                    >
                      {fName}.log
                    </span>
                    <span className="minor-text" style={{ marginLeft: "auto" }}>
                      {timeAgo(fInfo?.last_modified)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="stack-layout fadeIn"
      style={{ maxWidth: selected ? 1100 : 760 }}
    >
      <div className="topbar" style={{ marginBottom: 4 }}>
        <h2 className="page-title">System Health</h2>
        <button
          className="secondary-button"
          onClick={fetchHealth}
          disabled={loading}
          style={{ height: 30, fontSize: 11, padding: "0 12px" }}
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        <div
          className="stack-layout"
          style={{
            flex: selected ? "0 0 380px" : 1,
            maxWidth: selected ? 380 : 760,
          }}
        >
          <div className="panel" style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
              STATUS
            </div>
            <Row
              state={health?.ok ? "ok" : "error"}
              label="Server"
              right={health?.ok ? "Online" : "Offline"}
            />
            <Row
              state={health?.postgres === "ok" ? "ok" : "error"}
              label="PostgreSQL"
              right={health?.postgres || "-"}
            />
            <Row
              state={
                health?.redis === "ok"
                  ? "ok"
                  : health?.redis === "disabled"
                    ? "disabled"
                    : "error"
              }
              label="Redis"
              right={health?.redis || "-"}
            />
            <Row
              state={
                health?.bullmq?.enabled === false
                  ? "disabled"
                  : health?.bullmq?.ok
                    ? "ok"
                    : "error"
              }
              label="BullMQ"
              right={
                health?.bullmq?.enabled === false
                  ? "disabled"
                  : `q:${health?.bullmq?.queue_name || "market-data-bars"} w:${health?.bullmq?.counts?.waiting || 0} a:${health?.bullmq?.counts?.active || 0} f:${health?.bullmq?.counts?.failed || 0}`
              }
            />
          </div>
          {hasLogData ? (
            <div className="panel" style={{ padding: "14px 18px" }}>
              {logSections.map(renderSourceSection)}
            </div>
          ) : (
            <div className="panel" style={{ padding: "14px 18px" }}>
              <div className="minor-text">No log data yet.</div>
            </div>
          )}
        </div>

        {selected && (
          <div
            className="panel"
            style={{
              flex: 1,
              padding: "14px 18px",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {selected.source}/{selected.id}/{selected.file}.log
                {logMeta && (
                  <span
                    className="minor-text"
                    style={{ marginLeft: 8, fontSize: 10 }}
                  >
                    ({logMeta.total} lines)
                  </span>
                )}
              </div>
              <button
                className="secondary-button"
                onClick={() => setSelected(null)}
                style={{ fontSize: 10, padding: "2px 8px" }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <LogsViewer
                source={selected.source}
                objectId={selected.id}
                fileName={selected.file}
                hideToolbar
                limit={200}
                emptyText="No log lines available."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
