import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";

const ChartSnapshotsPage = lazy(() => import("../ai/ChartSnapshotsPage"));

function normalizeTempResponseSid(value = "") {
  const raw = String(value || "").trim().replace(/^trade-/, "");
  if (!raw) return "";
  const parts = raw.split("-");
  if (parts.length >= 3) {
    const last = String(parts[parts.length - 1] || "").trim().toUpperCase();
    const prev = String(parts[parts.length - 2] || "").trim().toUpperCase();
    if (last && prev && last === prev) {
      return parts.slice(0, -1).join("-");
    }
  }
  return raw;
}

async function fetchTempFolders() {
  const base = window.location.origin;
  const res = await fetch(`${base}/api/trades/temp`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export default function TempTradesPage() {
  const navigate = useNavigate();
  const { symbol: paramSid } = useParams();
  const activeSid = normalizeTempResponseSid(paramSid);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await fetchTempFolders();
        const arr = Array.isArray(res?.entries) ? res.entries : [];
        arr.sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0));
        setEntries(arr);
        // Auto-select first (latest) if no SID in URL
        if (!paramSid && arr.length > 0) {
          const first = arr[0];
          const sid = normalizeTempResponseSid(first.sid || first.folder);
          navigate(`/trades/response/${encodeURIComponent(sid)}`, { replace: true });
        }
      } catch (_) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []); // only on mount

  const handleSelect = (folder) => {
    const sid = normalizeTempResponseSid(folder);
    navigate(`/trades/response/${encodeURIComponent(sid)}`);
  };

  return (
    <section style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left panel: folder list */}
      <aside
        className="temp-response-panel"
        style={{
          width: 320,
          minWidth: 280,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          className="temp-response-header"
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          Responses ({entries.length})
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
          {loading && (
            <div
              className="temp-response-loading"
              style={{ padding: 24, textAlign: "center", fontSize: 12 }}
            >
              Loading...
            </div>
          )}
          {entries.map((e) => {
            const sid = normalizeTempResponseSid(e.sid || e.folder);
            const isActive = activeSid === sid;
            const decision = e.has_response
              ? { text: "OK", color: "#10b981" }
              : e.has_error
                ? { text: "FAILED", color: "#ef4444" }
                : { text: "PENDING", color: "#f59e0b" };
            const time = e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "";
            return (
              <div
                className={`temp-response-item${isActive ? " is-active" : ""}`}
                key={e.folder}
                onClick={() => handleSelect(e.sid || e.folder)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="temp-response-item__sid"
                    style={{ fontWeight: 700, fontSize: 12 }}
                  >
                    {sid}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: decision.color + "22",
                      color: decision.color,
                      fontWeight: 700,
                    }}
                  >
                    {decision.text}
                  </span>
                </div>
                <span
                  className="temp-response-item__time"
                  style={{ fontSize: 10 }}
                  title={e.failure_message || ""}
                >
                  {time}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right panel: ChartSnapshotsPage detail (only when SID selected) */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {paramSid ? (
          <Suspense fallback={<div className="loading-container">Loading response...</div>}>
            <ChartSnapshotsPage />
          </Suspense>
        ) : (
          <div
            className="temp-response-empty"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
            }}
          >
            Select a response →
          </div>
        )}
      </main>
    </section>
  );
}
