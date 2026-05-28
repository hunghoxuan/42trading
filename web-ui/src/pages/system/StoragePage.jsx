import { useEffect, useState } from "react";
import { api } from "../../api";
import { useConfirmDialog } from "../../components/ConfirmDialog";

export default function StoragePage() {
  const confirm = useConfirmDialog();
  const [stats, setStats] = useState(null);
  const [canHardDiskCleanup, setCanHardDiskCleanup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadStats() {
    try {
      setLoading(true);
      const data = await api.storageStats();
      setStats(data.stats);
      setCanHardDiskCleanup(Boolean(data.can_hard_disk_cleanup));
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to load storage stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
  }, []);



  async function handleCleanup(target) {
    const confirmMsg = target === "reset_user_data"
      ? "CRITICAL ACTION: This will delete ALL your signals and trades. Are you absolutely sure?"
      : target === "hard_disk"
        ? "Run server cleanup now? This will flush PM2 logs, truncate PostgreSQL file logs, clean apt/npm cache, and prune old temp/snapshot files."
      : target === "cache"
        ? "Clean all data caches? This will flush Redis, truncate market_data (bars) table, and clear memory cache. This will force a reload of all chart data."
      : `Are you sure you want to delete all ${target}? This cannot be undone.`;

    if (
      !(await confirm({
        title: "Confirm cleanup",
        message: confirmMsg,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    )
      return;

    try {
      setBusy(true);
      setMsg(`Cleaning up ${target}...`);
      const res = await api.storageCleanup(target);
      const out = res?.stats && typeof res.stats === "object" ? res.stats : res;
      if (target === "hard_disk") {
        const freed = Number(out?.freed_bytes || 0);
        setMsg(`Cleanup complete: freed ${formatBytes(freed)}.`);
      } else {
        setMsg(`Cleanup complete: ${JSON.stringify(out)}`);
      }
      await loadStats();
    } catch (e) {
      setError(e?.message || `Failed to clean up ${target}`);
      setMsg("");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 5000);
    }
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(value) / Math.log(k));
    return `${parseFloat((value / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  function formatPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return `${n.toFixed(0)}%`;
  }

  const diskTotal = Number(stats?.disk_total_bytes || 0);
  const diskUsed = Number(stats?.disk_used_bytes || 0);
  const diskAvail = Number(stats?.disk_avail_bytes || 0);
  const diskPct = Number(stats?.disk_use_pct || 0);

  return (
    <div className="stack-layout fadeIn">
      <h2 className="page-title">STORAGE & CLEANUP</h2>

      {error && <div className="error">{error}</div>}
      {msg && <div className="loading" style={{ padding: 10 }}>{msg}</div>}

      <div className="panel" style={{ maxWidth: "800px" }}>
        <div className="panel-label">YOUR STORAGE METRICS</div>
        {stats ? (
          <div style={{ marginBottom: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 10 }}>
            <div className="minor-text" style={{ marginBottom: 8 }}>
              Disk {stats.disk_mount || "/"}: {formatBytes(diskUsed)} used / {formatBytes(diskTotal)} total ({formatPct(diskPct)}) · {formatBytes(diskAvail)} left
            </div>
            <div style={{ width: "100%", height: 10, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, Number.isFinite(diskPct) ? diskPct : 0))}%`,
                  height: "100%",
                  background: diskPct >= 90 ? "#ef4444" : diskPct >= 75 ? "#f59e0b" : "#10b981",
                }}
              />
            </div>
          </div>
        ) : null}

        <table className="events-table">
          <thead>
            <tr>
              <th>CLEANUP TARGET</th>
              <th>METRICS</th>
              <th style={{ width: "120px", textAlign: "right" }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {loading && !stats ? (
              <tr><td colSpan="3" style={{ textAlign: "center", padding: "40px" }} className="muted">Loading stats...</td></tr>
            ) : stats ? (
              <>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Hard Disk Cleanup (System)</div>
                    <div className="minor-text">Flush PM2 logs, truncate PostgreSQL file logs, clean apt/npm cache, prune temp and old snapshots</div>
                  </td>
                  <td>
                    <span className="badge OTHER">Postgres logs: {formatBytes(stats.system_postgres_logs_size_bytes)}</span>
                    <span className="minor-text" style={{ marginLeft: 8 }}>Apt: {formatBytes(stats.system_apt_cache_size_bytes)} · PW: {formatBytes(stats.system_playwright_cache_size_bytes)} · Npm: {formatBytes(stats.system_npm_cache_size_bytes)}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("hard_disk")}
                      disabled={busy || !canHardDiskCleanup}
                      title={canHardDiskCleanup ? "" : "System role required"}
                    >
                      CLEAN
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Cancelled & Error Trades/Signals</div>
                    <div className="minor-text">Signals and Trades with status CANCEL, ERROR, or CANCELLED</div>
                  </td>
                  <td>
                    <span className="badge OTHER">{stats.cancelled_error_count} items</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("cancelled_error")}
                      disabled={busy || stats.cancelled_error_count === 0}
                    >
                      DELETE ALL
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Test Trades</div>
                    <div className="minor-text">Signals and Trades with symbol 'TEST'</div>
                  </td>
                  <td>
                    <span className="badge OTHER">{stats.test_trades_count} items</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("test_trades")}
                      disabled={busy || stats.test_trades_count === 0}
                    >
                      DELETE ALL
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Chart Snapshots</div>
                    <div className="minor-text">Images generated for analysis</div>
                  </td>
                  <td>
                    <span className="badge OTHER">{stats.snapshots_count} files</span>
                    <span className="minor-text" style={{ marginLeft: 8 }}>({formatBytes(stats.snapshots_size_bytes)})</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("snapshots")}
                      disabled={busy || stats.snapshots_count === 0}
                    >
                      DELETE ALL
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Activity & Event Logs</div>
                    <div className="minor-text">Internal events, signal history, and trade execution logs</div>
                  </td>
                  <td>
                    <span className="badge OTHER">{stats.logs_count} entries</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("logs")}
                      disabled={busy || stats.logs_count === 0}
                    >
                      DELETE ALL LOGS
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold" }}>Data Caches</div>
                    <div className="minor-text">Redis flush, market_data table truncate, memory cache clear</div>
                  </td>
                  <td>
                    <span className="badge OTHER">Volatile</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("cache")}
                      disabled={busy}
                    >
                      CLEAN CACHE
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style={{ fontWeight: "bold", color: "#ef4444" }}>RESET ALL DATA</div>
                    <div className="minor-text">Delete ALL your trades and signals (irreversible)</div>
                  </td>
                  <td>
                    <span className="badge SL">DANGER ZONE</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="danger-button"
                      onClick={() => handleCleanup("reset_user_data")}
                      disabled={busy}
                    >
                      RESET DATA
                    </button>
                  </td>
                </tr>
              </>
            ) : (
              <tr><td colSpan="3" style={{ textAlign: "center", padding: "40px" }} className="muted">No stats available</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
