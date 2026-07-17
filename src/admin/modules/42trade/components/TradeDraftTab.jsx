import { useState, useCallback, useEffect, useRef } from "react";
import { api, getRuntimeApiKey } from "../../../app/api";
import TimeframeSelector from "../../system/components/TimeframeSelector";

const TIMEFRAMES = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1D", label: "1d" },
];

function withApiKey(urlRaw) {
  const url = String(urlRaw || "").trim();
  if (!url) return "";
  const key = String(getRuntimeApiKey() || "").trim();
  try {
    const u = new URL(url, window.location.origin);
    const isSameOrigin = u.origin === window.location.origin;
    if (key && isSameOrigin && !u.searchParams.get("key")) {
      u.searchParams.set("key", key);
    }
    return u.toString();
  } catch {
    if (!key) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(key)}`;
  }
}

function fmtSize(bytes) {
  if (!bytes || bytes === 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function TradeDraftTab({
  tradeSid,
  symbol,
  snapshotFiles = [],
  apiScope = "",
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [selectedTfs, setSelectedTfs] = useState(["15m", "1h", "4h"]);
  const [previewFile, setPreviewFile] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const snapshotFilesRef = useRef(snapshotFiles);
  snapshotFilesRef.current = snapshotFiles;

  const loadFiles = useCallback(async () => {
    if (!tradeSid) return;
    setLoading(true);
    setError("");
    try {
      const snapRes = await api.tradeSnapshots(tradeSid, {
        scope: apiScope,
      }).catch(() => ({
        files: [],
      }));
      const sidFiles = snapRes.files || snapRes.items || [];
      const propSnapshotFiles = (Array.isArray(snapshotFilesRef.current)
        ? snapshotFilesRef.current
        : []
      )
        .map((item) => String(item || "").trim())
        .filter(Boolean);

      const serverFiles = [
        ...sidFiles.map((item) => ({
          name: item.name || item.file_name || "snapshot",
          url: withApiKey(
            item.url ||
              `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(item.file_name || item.name || "")}/content`,
          ),
          size_bytes: item.size_bytes || item.size || 0,
          source: "snapshot",
          created_at: item.created_at || null,
        })),
        ...propSnapshotFiles.map((name) => ({
          name,
          url: withApiKey(
            `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`,
          ),
          size_bytes: 0,
          source: "snapshot-prop",
          created_at: null,
        })),
      ];

      serverFiles.sort((a, b) => {
        const timeDiff =
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime();
        if (timeDiff !== 0) return timeDiff;
        return String(a.name).localeCompare(String(b.name));
      });

      const seen = new Set();
      const all = [];
      for (const file of serverFiles) {
        if (!file.name || seen.has(file.name)) continue;
        seen.add(file.name);
        all.push(file);
      }
      setFiles(all);
    } catch (e) {
      setError(e?.message || "Failed to load snapshots");
    } finally {
      setLoading(false);
    }
  }, [tradeSid, apiScope]);

  useEffect(() => {
    if (tradeSid) loadFiles();
  }, [tradeSid, loadFiles]);

  const takeSnapshots = async () => {
    if (!tradeSid) {
      setError("No trade SID available. Save the trade first.");
      return;
    }
    if (!symbol) {
      setError("No symbol available.");
      return;
    }
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
        trade_sid: tradeSid,
      });
      await loadFiles();
    } catch (e) {
      setError(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  const deleteFile = async (fileName, e) => {
    e.stopPropagation();
    if (!tradeSid || !fileName) return;
    setDeleting(fileName);
    try {
      await api.deleteTradeDraftFile(tradeSid, fileName);
      setFiles((prev) => prev.filter((file) => file.name !== fileName));
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const deleteAll = async () => {
    if (!tradeSid || !files.length) return;
    if (!confirm(`Delete all ${files.length} snapshots?`)) return;
    setDeleting("__all__");
    const errors = [];
    for (const file of files) {
      try {
        await api.deleteTradeDraftFile(tradeSid, file.name);
      } catch (e) {
        errors.push(`${file.name}: ${e?.message || "delete failed"}`);
      }
    }
    if (errors.length) setError(errors.join("; "));
    setDeleting(null);
    await loadFiles();
  };

  const isImage = (name) =>
    /\.(png|jpg|jpeg|gif|webp)$/i.test(String(name || ""));
  const preview = previewFile
    ? files.find((file) => file.name === previewFile)
    : null;
  const previewIdx = previewFile
    ? files.findIndex((file) => file.name === previewFile)
    : -1;
  const goPrev = () => {
    if (files.length === 0) return;
    const idx = previewIdx <= 0 ? files.length - 1 : previewIdx - 1;
    setPreviewFile(files[idx].name);
  };
  const goNext = () => {
    if (files.length === 0) return;
    const idx = previewIdx >= files.length - 1 ? 0 : previewIdx + 1;
    setPreviewFile(files[idx].name);
  };

  useEffect(() => {
    if (!previewFile || files.length <= 1) return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "Escape") setPreviewFile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewFile, files]);

  return (
    <div style={{ padding: "8px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "6px 10px",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        <TimeframeSelector
          value={selectedTfs}
          onChange={setSelectedTfs}
          options={TIMEFRAMES}
          multiple
          ariaLabel="Snapshot timeframes"
          size="sm"
        />
        <button
          className="secondary-button"
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? "..." : "Refresh"}
        </button>
        <button
          className="primary-button"
          onClick={takeSnapshots}
          disabled={capturing || !symbol || !tradeSid}
          style={{ marginLeft: "auto" }}
        >
          {capturing ? "Capturing..." : "Take Snapshots"}
        </button>
      </div>

      {error ? (
        <div
          className="minor-text"
          style={{ color: "#ef4444", fontSize: 10, marginBottom: 8 }}
        >
          {error}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span className="minor-text" style={{ fontSize: 10 }}>
            {files.length} snapshot{files.length !== 1 ? "s" : ""}
          </span>
          <button
            className="secondary-button"
            style={{
              color: "#ef5350",
              borderColor: "#ef5350",
              marginLeft: "auto",
            }}
            onClick={deleteAll}
            disabled={deleting === "__all__"}
          >
            {deleting === "__all__" ? "Deleting..." : "Delete All"}
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 6,
          }}
        >
          {files.map((file) => (
            <div
              key={file.name}
              style={{
                background: "rgba(255,255,255,0.03)",
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
                cursor: "pointer",
                position: "relative",
              }}
              onClick={() => setPreviewFile(file.name)}
            >
              {isImage(file.name) ? (
                <img
                  src={file.url}
                  alt={file.name}
                  style={{
                    width: "100%",
                    height: 300,
                    objectFit: "cover",
                    background: "#000",
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 300,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--muted)",
                    fontSize: 20,
                  }}
                >
                  📄
                </div>
              )}
              <div
                style={{
                  padding: "3px 6px",
                  fontSize: 9,
                  color: "var(--muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.name}
                </span>
                {file.size_bytes > 0 ? (
                  <span style={{ opacity: 0.5, flexShrink: 0 }}>
                    {fmtSize(file.size_bytes)}
                  </span>
                ) : null}
              </div>
              <button
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 18,
                  border: "none",
                  background: "rgba(239,68,68,0.85)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
                onClick={(e) => deleteFile(file.name, e)}
                disabled={deleting === file.name}
                title="Delete snapshot"
              >
                {deleting === file.name ? "·" : "✕"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="minor-text"
          style={{ fontSize: 11, padding: 16, textAlign: "center" }}
        >
          {loading || capturing ? "Loading..." : "No snapshots yet."}
        </div>
      )}

      {preview ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={() => setPreviewFile(null)}
        >
          <div
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {files.length > 1 ? (
              <>
                <button
                  onClick={goPrev}
                  style={{
                    position: "absolute",
                    left: -60,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 48,
                    border: "2px solid rgba(255,255,255,0.3)",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ‹
                </button>
                <button
                  onClick={goNext}
                  style={{
                    position: "absolute",
                    right: -60,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 48,
                    border: "2px solid rgba(255,255,255,0.3)",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ›
                </button>
              </>
            ) : null}
            {isImage(preview.name) ? (
              <img
                src={preview.url}
                alt={preview.name}
                style={{
                  maxWidth: "90vw",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  borderRadius: 8,
                }}
              />
            ) : (
              <div style={{ padding: 40, color: "#fff", fontSize: 40 }}>📄</div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#fff", fontSize: 11 }}>
                {previewIdx + 1}/{files.length} - {preview.name}
              </span>
              <a
                href={preview.url}
                download={preview.name}
                className="primary-button"
                style={{
                  fontSize: 10,
                  padding: "4px 12px",
                  textDecoration: "none",
                }}
              >
                Download
              </a>
              <button
                className="secondary-button"
                style={{
                  color: "#fff",
                  borderColor: "rgba(255,255,255,0.3)",
                }}
                onClick={() => setPreviewFile(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
