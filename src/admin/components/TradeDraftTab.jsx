import { useState, useCallback, useEffect, useRef } from "react";
import { api, getRuntimeApiKey } from "../api";
import TimeframeSelector from "./TimeframeSelector";

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
    // Keep full URL so external/signed hosts are not broken.
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
  attachedFiles = [],
  snapshotsUsed = [],
  snapshotFiles = [],
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [selectedTfs, setSelectedTfs] = useState(["15m", "1h", "4h"]);
  const [previewFile, setPreviewFile] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const inputRef = useRef(null);
  const snapshotFilesRef = useRef(snapshotFiles);
  snapshotFilesRef.current = snapshotFiles;

  const loadFiles = useCallback(async () => {
    if (!tradeSid && !symbol) return;
    setLoading(true);
    setError("");
    try {
      const promises = [];
      if (tradeSid) {
        promises.push(
          api.tradeSnapshots(tradeSid).catch(() => ({ files: [] })),
        );
        promises.push(
          api.listTradeDraftFiles(tradeSid).catch(() => ({ files: [] })),
        );
      } else {
        promises.push(Promise.resolve({ files: [] }));
        promises.push(Promise.resolve({ files: [] }));
      }
      if (symbol) {
        promises.push(
          api.marketDataSnapshots(symbol, 3).catch(() => ({ files: [] })),
        );
      } else {
        promises.push(Promise.resolve({ files: [] }));
      }
      const [snapRes, uploadRes, mdRes] = await Promise.all(promises);

      const sidFiles = snapRes.files || snapRes.items || [];
      const uploadFiles = uploadRes.files || [];
      const sf = snapshotFilesRef.current;
      const propSnapshotFiles = (Array.isArray(sf) ? sf : [])
        .map((x) => String(x || "").trim())
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
        })),
        ...propSnapshotFiles.map((name) => ({
          name,
          url: withApiKey(
            `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`,
          ),
          size_bytes: 0,
          source: "snapshot-prop",
        })),
        ...uploadFiles.map((item) => ({
          name: item.name || item.file_name || "file",
          url: withApiKey(
            item.url ||
              `/api/trades/${encodeURIComponent(tradeSid)}/files/${encodeURIComponent(item.file_name || item.name || "")}/content`,
          ),
          size_bytes: item.size_bytes || item.size || 0,
          source: "upload",
        })),
        ...(mdRes.files || []).map((item) => ({
          name: item.name || "snapshot",
          url: withApiKey(item.url),
          size_bytes: item.size_bytes || 0,
          source: "market-data",
          created_at: item.created_at || null,
        })),
      ];

      // Sort: trade draft files first (ASC), market-data always last
      const sourceOrder = {
        snapshot: 0,
        "snapshot-prop": 0,
        upload: 1,
        "market-data": 2,
      };
      serverFiles.sort((a, b) => {
        const s = (sourceOrder[a.source] ?? 9) - (sourceOrder[b.source] ?? 9);
        if (s !== 0) return s;
        return String(a.name).localeCompare(String(b.name));
      });

      const seen = new Set();
      const all = [];
      for (const f of serverFiles) {
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
  }, [tradeSid, symbol]);

  useEffect(() => {
    if (tradeSid || symbol) loadFiles();
  }, [tradeSid, symbol]);

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

  const uploadFiles = async (fileList) => {
    if (!tradeSid) {
      setError("Trade SID is required before uploading files.");
      return;
    }
    const selected = Array.from(fileList || []).filter(Boolean);
    if (!selected.length) return;
    setUploading(true);
    setError("");
    const errors = [];
    for (const file of selected) {
      try {
        await api.uploadTradeDraftFile(tradeSid, file);
      } catch (e) {
        errors.push(`${file.name}: ${e?.message || "upload failed"}`);
      }
    }
    if (errors.length) setError(errors.join("; "));
    setUploading(false);
    await loadFiles();
  };

  const deleteFile = async (fileName, e) => {
    e.stopPropagation();
    if (!tradeSid || !fileName) return;
    setDeleting(fileName);
    try {
      await api.deleteTradeDraftFile(tradeSid, fileName);
      setFiles((prev) => prev.filter((f) => f.name !== fileName));
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const deleteAll = async () => {
    if (!tradeSid || !files.length) return;
    if (!confirm(`Delete all ${files.length} files?`)) return;
    setDeleting("__all__");
    const errors = [];
    for (const f of files) {
      try {
        await api.deleteTradeDraftFile(tradeSid, f.name);
      } catch (e) {
        errors.push(`${f.name}: ${e?.message || "delete failed"}`);
      }
    }
    if (errors.length) setError(errors.join("; "));
    setDeleting(null);
    await loadFiles();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  };

  const isImage = (name) =>
    /\.(png|jpg|jpeg|gif|webp)$/i.test(String(name || ""));
  const preview = previewFile
    ? files.find((f) => f.name === previewFile)
    : null;
  const previewIdx = previewFile
    ? files.findIndex((f) => f.name === previewFile)
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

  // Keyboard navigation
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
      {/* Toolbar */}
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
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => tradeSid && inputRef.current?.click()}
          style={{
            border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 6,
            padding: "4px 8px",
            textAlign: "center",
            cursor: tradeSid ? "pointer" : "not-allowed",
            background: dragOver
              ? "rgba(34,211,238,0.08)"
              : "rgba(255,255,255,0.02)",
            opacity: uploading ? 0.65 : 1,
            minWidth: 220,
            maxWidth: 280,
            marginLeft: "auto",
          }}
        >
          <span className="minor-text" style={{ fontSize: 10 }}>
            {!tradeSid
              ? "Save trade first"
              : uploading
                ? "Uploading..."
                : "Drop files / click upload"}
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            disabled={!tradeSid}
            onChange={(e) => uploadFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>
        <button
          className="primary-button"
          onClick={takeSnapshots}
          disabled={capturing || !symbol}
        >
          {capturing ? "Capturing..." : "Take Snapshots"}
        </button>
      </div>

      {error && (
        <div
          className="minor-text"
          style={{ color: "#ef4444", fontSize: 10, marginBottom: 8 }}
        >
          {error}
        </div>
      )}

      {/* Delete All + count */}
      {files.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span className="minor-text" style={{ fontSize: 10 }}>
            {files.length} file{files.length !== 1 ? "s" : ""}
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
      )}

      {/* Thumbnail grid */}
      {files.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 6,
          }}
        >
          {files.map((f) => (
            <div
              key={f.name}
              style={{
                background: "rgba(255,255,255,0.03)",
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
                cursor: "pointer",
                position: "relative",
              }}
              onClick={() => setPreviewFile(f.name)}
            >
              {isImage(f.name) ? (
                <img
                  src={f.url}
                  alt={f.name}
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
                  {f.name}
                </span>
                {f.size_bytes > 0 && (
                  <span style={{ opacity: 0.5, flexShrink: 0 }}>
                    {fmtSize(f.size_bytes)}
                  </span>
                )}
              </div>
              {/* Delete button overlay */}
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
                onClick={(e) => deleteFile(f.name, e)}
                disabled={deleting === f.name}
                title="Delete file"
              >
                {deleting === f.name ? "·" : "✕"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="minor-text"
          style={{ fontSize: 11, padding: 16, textAlign: "center" }}
        >
          {loading || capturing ? "Loading..." : "No files yet."}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
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
            {/* Left/Right navigation */}
            {files.length > 1 && (
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
            )}
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
                {previewIdx + 1}/{files.length} — {preview.name}
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
                ⬇ Download
              </a>
              <button
                className="secondary-button"
                style={{

                  color: "#fff",
                  borderColor: "rgba(255,255,255,0.3)",
                }}
                onClick={() => setPreviewFile(null)}
              >
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
