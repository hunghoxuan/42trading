import { useState, useCallback, useEffect } from "react";
import ImageViewer from "./ImageViewer";
import { api } from "../api";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"];

export default function TradeFilesTab({ tradeSid, symbol, attachedFiles = [] }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [selectedTfs, setSelectedTfs] = useState(["15m", "1h", "4h"]);

  const loadFiles = useCallback(async () => {
    if (!tradeSid && !symbol) return;
    setLoading(true);
    setError("");
    try {
      const attached = (Array.isArray(attachedFiles) ? attachedFiles : []).map((file) => {
        const name = typeof file === "string" ? file : file?.file_name || file?.name || "";
        return {
          name,
          url: tradeSid
            ? `/v2/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`
            : `/v2/chart/snapshots/${encodeURIComponent(name)}`,
          size_bytes: file?.size_bytes || 0,
        };
      });

      const listed = tradeSid
        ? await api.tradeSnapshots(tradeSid).catch(() => ({ files: [] }))
        : await api.chartSnapshots(200).catch(() => ({ items: [] }));

      const serverFiles = (listed?.files || listed?.items || []).map((item) => ({
        name: item.name || item.file_name || "snapshot",
        url: item.url || `/v2/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
        size_bytes: item.size_bytes || item.size || 0,
      }));

      const seen = new Set();
      const all = [];
      for (const f of [...attached, ...serverFiles]) {
        if (!f.name || seen.has(f.name)) continue;
        seen.add(f.name);
        all.push(f);
      }
      setFiles(all);
    } catch (e) {
      setError(e?.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [tradeSid, symbol, attachedFiles]);

  useEffect(() => { loadFiles(); }, []);

  const takeSnapshots = async () => {
    if (!symbol) return;
    setCapturing(true);
    setError("");
    try {
      await api.chartSnapshotCreateBatch({
        symbol,
        timeframes: selectedTfs,
        format: "png",
        theme: "dark",
        width: 1200,
        height: 800,
        trade_sid: tradeSid || "",
      });
      await loadFiles();
    } catch (e) {
      setError(e?.message || "Snapshot capture failed");
    } finally {
      setCapturing(false);
    }
  };

  const toggleTf = (tf) => {
    setSelectedTfs((prev) =>
      prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf]
    );
  };

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Capture controls */}
      <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="minor-text" style={{ fontSize: 9, opacity: 0.7 }}>TF:</span>
          {TIMEFRAMES.map((tf) => (
            <label key={tf} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 10 }}>
              <input
                type="checkbox"
                checked={selectedTfs.includes(tf)}
                onChange={() => toggleTf(tf)}
                style={{ margin: 0 }}
              />
              {tf}
            </label>
          ))}
          <button
            className="primary-button"
            style={{ fontSize: 10, padding: "4px 12px", marginLeft: "auto" }}
            onClick={takeSnapshots}
            disabled={capturing || !symbol}
          >
            {capturing ? "Capturing..." : "Take Snapshots"}
          </button>
        </div>
      </div>

      {/* File list controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button
          className="secondary-button"
          style={{ fontSize: 10, padding: "3px 10px" }}
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh List"}
        </button>
        {error && (
          <span className="minor-text" style={{ color: "#ef4444", fontSize: 10 }}>
            {error}
          </span>
        )}
        <span className="minor-text" style={{ fontSize: 9, opacity: 0.5, marginLeft: "auto" }}>
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {files.length > 0 ? (
        <ImageViewer
          files={files}
          getUrl={(f) => f.url}
          showDelete={false}
          showDownload
        />
      ) : (
        <div className="minor-text" style={{ fontSize: 11, padding: 16, textAlign: "center" }}>
          {capturing ? "Taking snapshots..." : loading ? "Loading files..." : "No snapshots yet. Click Take Snapshots above."}
        </div>
      )}
    </div>
  );
}
