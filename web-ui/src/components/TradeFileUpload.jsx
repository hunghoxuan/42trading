import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../api";

function fmtSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function TradeFileUpload({ tradeId, disabled = false }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const loadFiles = useCallback(async () => {
    if (!tradeId) return;
    try {
      const data = await api.listTradeFiles(tradeId);
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch {
      // silent — folder may not exist yet
    }
  }, [tradeId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const uploadFiles = async (fileList) => {
    if (!tradeId || !fileList || fileList.length === 0) return;
    setUploading(true);
    setError("");
    for (const f of fileList) {
      try {
        await api.uploadTradeFile(tradeId, f);
      } catch (e) {
        setError(e?.message || "Upload failed");
      }
    }
    setUploading(false);
    await loadFiles();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDelete = async (fileName) => {
    if (!tradeId) return;
    try {
      await api.deleteTradeFile(tradeId, fileName);
      await loadFiles();
    } catch (e) {
      setError(e?.message || "Delete failed");
    }
  };

  if (!tradeId) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <label
        className="minor-text"
        style={{
          fontWeight: "700",
          fontSize: "9px",
          textTransform: "uppercase",
          color: "var(--muted-bright)",
          opacity: 0.8,
          display: "block",
          marginBottom: 4,
        }}
      >
        Attachments
      </label>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {files.map((f) => (
            <div
              key={f.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 8px",
                marginBottom: 2,
                background: "rgba(255,255,255,0.03)",
                borderRadius: 4,
                fontSize: 10,
                color: "var(--text)",
              }}
            >
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📎 {f.name}
                {f.size ? <span style={{ color: "var(--muted)", marginLeft: 6 }}>{fmtSize(f.size)}</span> : null}
              </span>
              {!disabled && (
                <button
                  className="secondary-button"
                  onClick={() => handleDelete(f.name)}
                  style={{
                    height: "18px",
                    fontSize: "9px",
                    padding: "0 6px",
                    marginLeft: 8,
                    color: "#ef5350",
                    borderColor: "transparent",
                    background: "transparent",
                  }}
                  title="Delete file"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {!disabled && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 6,
            padding: "10px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "rgba(255,255,255,0.05)" : "transparent",
            transition: "background 0.15s, border-color 0.15s",
            opacity: uploading ? 0.5 : 1,
          }}
        >
          {uploading ? (
            <span className="minor-text" style={{ fontSize: 10 }}>
              Uploading...
            </span>
          ) : (
            <span className="minor-text" style={{ fontSize: 10 }}>
              Drop files here or click to upload
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={(e) => uploadFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>
      )}

      {error && (
        <span className="minor-text msg-error" style={{ fontSize: 9, display: "block", marginTop: 4 }}>
          {error}
        </span>
      )}
    </div>
  );
}
