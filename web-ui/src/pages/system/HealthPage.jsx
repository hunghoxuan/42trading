import { useState, useEffect } from "react";
import { api } from "../../api";

function StatusDot({ ok }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#22c55e" : "#666",
        flexShrink: 0,
        marginRight: 8,
      }}
    />
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logMeta, setLogMeta] = useState(null);

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

  const openLog = async (source, id, file) => {
    setSelected({ source, id, file });
    setLogLoading(true);
    setLogMeta(null);
    try {
      const d = await api.systemLogFile(source, id, file, 200);
      setLogLines(d.lines || []);
      setLogMeta({ total: d.total_lines });
    } catch (e) {
      setLogLines(["Error: " + (e?.message || e)]);
      setLogMeta(null);
    } finally {
      setLogLoading(false);
    }
  };

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
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return Math.round(d) + "s ago";
    if (d < 3600) return Math.round(d / 60) + "m ago";
    if (d < 86400) return Math.round(d / 3600) + "h ago";
    return Math.round(d / 86400) + "d ago";
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

  const Row = ({ ok, label, right }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <StatusDot ok={ok} />
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
                onClick={() => openLog(srcKey, idKey, fName)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "3px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10,
                  cursor: "pointer",
                  background: isSel ? "var(--accent-soft)" : "transparent",
                  borderRadius: 2,
                }}
              >
                <StatusDot ok={isRecent(idData?.last_activity)} />
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
                <StatusDot ok={isRecent(idData?.last_activity)} />
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
                    onClick={() => openLog(srcKey, idKey, fName)}
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
              ok={health?.ok}
              label="Server"
              right={health?.ok ? "Online" : "Offline"}
            />
            <Row
              ok={health?.postgres === "ok"}
              label="PostgreSQL"
              right={health?.postgres || "-"}
            />
            <Row
              ok={health?.redis === "ok" || health?.redis === "disabled"}
              label="Redis"
              right={health?.redis || "-"}
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
            <div
              style={{
                flex: 1,
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: 10,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {logLoading ? (
                <div className="minor-text">Loading...</div>
              ) : logLines.length === 0 ? (
                <div className="minor-text">Empty.</div>
              ) : (
                logLines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "1px 0",
                      borderBottom: "1px solid var(--border)",
                      opacity: 0.85,
                    }}
                  >
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
