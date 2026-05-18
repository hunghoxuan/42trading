import { useState, useCallback, useEffect } from "react";
import { api } from "../api";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"];

function fmtSize(bytes) {
  if (!bytes || bytes === 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function TradeFilesTab({ tradeSid, symbol, attachedFiles = [] }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [selectedTfs, setSelectedTfs] = useState(["15m", "1h", "4h"]);
  const [previewFile, setPreviewFile] = useState(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const attached = (Array.isArray(attachedFiles) ? attachedFiles : []).map((file) => {
        const name = typeof file === "string" ? file : file?.file_name || file?.name || "";
        return { name, url: `/v2/chart/snapshots/${encodeURIComponent(tradeSid || "")}/${encodeURIComponent(name)}`, size_bytes: file?.size_bytes || 0 };
      });

      const sidList = tradeSid
        ? await api.tradeSnapshots(tradeSid).catch(() => ({ files: [] }))
        : null;
      const globalList = await api.chartSnapshots(200).catch(() => ({ items: [] }));

      const serverFiles = [
        ...(sidList?.files || []).map((item) => ({
          name: item.name || item.file_name || "snapshot",
          url: item.url || `/v2/chart/snapshots/${encodeURIComponent(tradeSid || "")}/${encodeURIComponent(item.file_name || item.name || "")}`,
          size_bytes: item.size_bytes || item.size || 0,
        })),
        ...(globalList?.items || []).map((item) => ({
          name: item.file_name || item.name || "snapshot",
          url: item.url || `/v2/chart/snapshots/${encodeURIComponent(item.file_name || "")}`,
          size_bytes: item.size_bytes || item.size || 0,
        })),
      ];

      const seen = new Set();
      const all = [];
      for (const f of [...attached, ...serverFiles]) {
        if (!f.name || seen.has(f.name)) continue;
        seen.add(f.name);
        all.push(f);
      }
      setFiles(all);
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [tradeSid, attachedFiles]);

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
      setError(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  const toggleTf = (tf) => {
    setSelectedTfs((prev) =>
      prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf]
    );
  };

  const isImage = (name) => /\.(png|jpg|jpeg|gif|webp)$/i.test(String(name || ""));
  const preview = previewFile ? files.find((f) => f.name === previewFile) : null;

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12, padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px solid var(--border)" }}>
        <span className="minor-text" style={{ fontSize: 9, opacity: 0.7 }}>TF:</span>
        {TIMEFRAMES.map((tf) => (
          <label key={tf} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 10 }}>
            <input type="checkbox" checked={selectedTfs.includes(tf)} onChange={() => toggleTf(tf)} style={{ margin: 0 }} />
            {tf}
          </label>
        ))}
        <button className="secondary-button" style={{ fontSize: 10, padding: "3px 10px" }} onClick={loadFiles} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
        <button className="primary-button" style={{ fontSize: 10, padding: "4px 12px", marginLeft: "auto" }} onClick={takeSnapshots} disabled={capturing || !symbol}>
          {capturing ? "Capturing..." : "Take Snapshots"}
        </button>
      </div>

      {error && <div className="minor-text" style={{ color: "#ef4444", fontSize: 10, marginBottom: 8 }}>{error}</div>}

      {/* Thumbnail grid */}
      {files.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 6 }}>
          {files.map((f) => (
            <div
              key={f.name}
              style={{
                background: "rgba(255,255,255,0.03)",
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
                cursor: "pointer",
              }}
              onClick={() => setPreviewFile(f.name)}
            >
              {isImage(f.name) ? (
                <img src={f.url} alt={f.name} style={{ width: "100%", height: 70, objectFit: "cover", background: "#000" }} />
              ) : (
                <div style={{ height: 70, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 20 }}>📄</div>
              )}
              <div style={{ padding: "3px 6px", fontSize: 9, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
                {f.size_bytes > 0 && <span style={{ marginLeft: 4, opacity: 0.5 }}>{fmtSize(f.size_bytes)}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="minor-text" style={{ fontSize: 11, padding: 16, textAlign: "center" }}>
          {loading || capturing ? "Loading..." : "No files yet."}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          onClick={() => setPreviewFile(null)}
        >
          <div style={{ maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }} onClick={(e) => e.stopPropagation()}>
            {isImage(preview.name) ? (
              <img src={preview.url} alt={preview.name} style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 8 }} />
            ) : (
              <div style={{ padding: 40, color: "#fff", fontSize: 40 }}>📄</div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#fff", fontSize: 11 }}>{preview.name}</span>
              <a href={preview.url} download={preview.name} className="primary-button" style={{ fontSize: 10, padding: "4px 12px", textDecoration: "none" }}>⬇ Download</a>
              <button className="secondary-button" style={{ fontSize: 10, padding: "4px 12px", color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => setPreviewFile(null)}>✕ Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
