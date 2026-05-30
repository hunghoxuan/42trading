import { useState, useEffect, lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";

const ChartSnapshotsPage = lazy(() => import("../ai/ChartSnapshotsPage"));

async function fetchTempFolders() {
  const base = window.location.origin;
  const res = await fetch(`${base}/v2/trades/temp`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export default function TempTradesPage() {
  const navigate = useNavigate();
  const { symbol: paramSid } = useParams();
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
          const sid = first.folder.replace(/^trade-/, "");
          navigate(`/ai/response/${encodeURIComponent(sid)}`, { replace: true });
        }
      } catch (_) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []); // only on mount

  const handleSelect = (folder) => {
    const sid = folder.replace(/^trade-/, "");
    navigate(`/ai/response/${encodeURIComponent(sid)}`);
  };

  return (
    <section style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left panel: folder list */}
      <aside
        style={{
          width: 320,
          minWidth: 280,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg-card, #0f172a)",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            fontWeight: 700,
            fontSize: 13,
            color: "var(--foreground, #e5e7eb)",
          }}
        >
          Responses ({entries.length})
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 6 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 12 }}>
              Loading...
            </div>
          )}
          {entries.map((e) => {
            const sid = e.folder.replace(/^trade-/, "");
            const isActive = paramSid === sid;
            const decision = e.has_response
              ? { text: "YES", color: "#10b981" }
              : { text: "NO", color: "#ef4444" };
            const time = e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "";
            return (
              <div
                key={e.folder}
                onClick={() => handleSelect(e.folder)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: "pointer",
                  border: isActive
                    ? "1px solid var(--accent, #38bdf8)"
                    : "1px solid var(--border)",
                  background: isActive
                    ? "rgba(56,189,248,0.08)"
                    : "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: "#e5e7eb" }}>
                    {e.symbol || sid}
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
                <span style={{ fontSize: 10, color: "#64748b" }}>{time}</span>
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
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
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
