import { useState, useCallback, useEffect } from "react";
import ImageViewer from "./ImageViewer";
import { api } from "../api";

export default function TradeFilesTab({ tradeSid, symbol, attachedFiles = [] }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      // Merge attached + server files, deduplicate by name
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

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button
          className="primary-button"
          style={{ fontSize: 10, padding: "4px 12px" }}
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh Files"}
        </button>
        {error && (
          <span className="minor-text" style={{ color: "#ef4444", fontSize: 10 }}>
            {error}
          </span>
        )}
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
          {loading ? "Loading files..." : "No snapshots yet. Capture from AI Analyze or Cron."}
        </div>
      )}
    </div>
  );
}
