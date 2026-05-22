import { useState, useCallback, useEffect, useRef } from "react";
import { api, getRuntimeApiKey } from "../api";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1D"];

function withApiKey(urlRaw) {
  const url = String(urlRaw || "").trim();
  if (!url) return "";
  const key = String(getRuntimeApiKey() || "").trim();
  if (!key) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (!u.searchParams.get("key")) u.searchParams.set("key", key);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
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

export default function TradeFilesTab({
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

  const loadFiles = useCallback(async () => {
    if (!tradeSid) return;
    setLoading(true);
    setError("");
    try {
      const [snapRes, uploadRes] = await Promise.all([
        api.tradeSnapshots(tradeSid).catch(() => ({ files: [] })),
        api.listTradeFiles(tradeSid).catch(() => ({ files: [] })),
      ]);

      const sidFiles = snapRes.files || snapRes.items || [];
      const uploadFiles = uploadRes.files || [];

      const serverFiles = [
        ...sidFiles.map((item) => ({
          name: item.name || item.file_name || "snapshot",
          url: withApiKey(
            item.url ||
              `/v2/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(item.file_name || item.name || "")}/content`,
          ),
          size_bytes: item.size_bytes || item.size || 0,
          source: "snapshot",
        })),
        ...uploadFiles.map((item) => ({
          name: item.name || item.file_name || "file",
          url: withApiKey(
            item.url ||
              `/v2/trades/${encodeURIComponent(tradeSid)}/files/${encodeURIComponent(item.file_name || item.name || "")}/content`,
          ),
          size_bytes: item.size_bytes || item.size || 0,
          source: "upload",
        })),
      ];

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
  }, [tradeSid]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Also reload when tradeSid changes (e.g. after analysis creates snapshots)
  useEffect(() => {
    if (tradeSid) loadFiles();
  }, [tradeSid]);

  const takeSnapshots = async () => {
    if (!tradeSid) {
      setError("Trade SID is required before saving files.");
      return;
    }
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
        trade_sid: tradeSid,
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
      prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf],
    );
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
        await api.uploadTradeFile(tradeSid, file);
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
      await api.deleteTradeFile(tradeSid, fileName);
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
        await api.deleteTradeFile(tradeSid, f.name);
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
  const usedSnapshots = Array.isArray(snapshotsUsed) ? snapshotsUsed : [];
  const submittedSnapshots = Array.isArray(snapshotFiles) ? snapshotFiles : [];
  const aiSnapshots = usedSnapshots.length ? usedSnapshots : submittedSnapshots;
  const aiSnapshotsLabel = usedSnapshots.length
    ? "Snapshots Used by AI"
    : "Snapshots Submitted";

  return (
    <div style={{ padding: "8px 0" }}>
      {aiSnapshots.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            border: "1px solid var(--accent-soft)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "var(--accent-soft)",
              marginBottom: 6,
            }}
          >
            {aiSnapshotsLabel}
            {!usedSnapshots.length && submittedSnapshots.length ? (
              <span style={{ opacity: 0.5, marginLeft: 6 }}>
                (AI did not return used list; showing submitted)
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {aiSnapshots.map((name, i) => {
              const safeName = String(name || "").trim();
              if (!safeName) return null;
              const displayName =
                safeName.length > 50 ? `${safeName.slice(0, 47)}...` : safeName;
              return (
                <a
                  key={`${safeName}-${i}`}
                  href={`/v2/chart/snapshots/${encodeURIComponent(safeName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={safeName}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.06)",
                    color: "var(--accent)",
                    textDecoration: "none",
                    border: "1px solid transparent",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "transparent";
                  }}
                >
                  {displayName}
                </a>
              );
            })}
          </div>
        </div>
      )}

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
        <span className="minor-text" style={{ fontSize: 9, opacity: 0.7 }}>
          TF:
        </span>
        {TIMEFRAMES.map((tf) => (
          <label
            key={tf}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
              fontSize: 10,
            }}
          >
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
          className="secondary-button"
          style={{ fontSize: 10, padding: "3px 10px" }}
          onClick={loadFiles}
          disabled={loading}
        >
          {loading ? "..." : "Refresh"}
        </button>
        <button
          className="primary-button"
          style={{ fontSize: 10, padding: "4px 12px", marginLeft: "auto" }}
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
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          textAlign: "center",
          cursor: tradeSid ? "pointer" : "not-allowed",
          background: dragOver
            ? "rgba(34,211,238,0.08)"
            : "rgba(255,255,255,0.02)",
          opacity: uploading ? 0.65 : 1,
        }}
      >
        <span className="minor-text" style={{ fontSize: 11 }}>
          {!tradeSid
            ? "Save trade plan first to enable uploads"
            : uploading
              ? "Uploading..."
              : "Drop files here or click to upload"}
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
              fontSize: 9,
              padding: "2px 8px",
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
            gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
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
                    height: 70,
                    objectFit: "cover",
                    background: "#000",
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 70,
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
                  height: 18,
                  borderRadius: "50%",
                  border: "none",
                  background: "rgba(239,68,68,0.85)",
                  color: "#fff",
                  fontSize: 10,
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
          {loading || capturing
            ? "Loading..."
            : tradeSid
              ? "No files yet. Take snapshots or upload files."
              : "Save the trade plan first, then files will appear here."}
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
            }}
            onClick={(e) => e.stopPropagation()}
          >
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
                {preview.name}
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
                  fontSize: 10,
                  padding: "4px 12px",
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
