import { useState, useRef, useEffect, useCallback } from "react";
import { api, getRuntimeApiBase } from "../api";

function fmtSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function isImage(name) {
  return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(String(name || ""));
}

function fileUrl(tradeId, name) {
  return `${getRuntimeApiBase()}/v2/trades/${encodeURIComponent(tradeId)}/files/${encodeURIComponent(name)}/content`;
}

export function TradeFileUpload({ tradeId, disabled = false, showList = true, showLabel = true }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
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
      if (previewFile === fileName) setPreviewFile(null);
      await loadFiles();
    } catch (e) {
      setError(e?.message || "Delete failed");
    }
  };

  if (!tradeId) return null;

  return (
    <div style={{ marginTop: 8 }}>
{showLabel && (
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
      )}

      {/* File list */}
      {showList && files.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          {files.map((f) => (
            <div key={f.name}>
              <div
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
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setPreviewFile(previewFile === f.name ? null : f.name)
                  }
                  title={
                    isImage(f.name) ? "Click to preview" : "Click for details"
                  }
                >
                  {isImage(f.name) ? "🖼 " : "📎 "}
                  {f.name}
                  {f.size ? (
                    <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                      {fmtSize(f.size)}
                    </span>
                  ) : null}
                </span>
                <a
                  href={fileUrl(tradeId, f.name)}
                  download={f.name}
                  className="secondary-button"
                  style={{
                    height: "18px",
                    fontSize: "9px",
                    padding: "0 6px",
                    marginLeft: 4,
                    textDecoration: "none",
                    lineHeight: "18px",
                  }}
                  title="Download"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⬇
                </a>
                {!disabled && (
                  <button
                    className="secondary-button"
                    onClick={() => handleDelete(f.name)}
                    style={{
                      height: "18px",
                      fontSize: "9px",
                      padding: "0 6px",
                      marginLeft: 4,
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

              {/* Image preview */}
              {previewFile === f.name && isImage(f.name) && (
                <div
                  style={{
                    marginBottom: 4,
                    padding: "4px",
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: 4,
                    textAlign: "center",
                  }}
                >
                  <img
                    src={fileUrl(tradeId, f.name)}
                    alt={f.name}
                    style={{
                      maxWidth: "100%",
                      maxHeight: 200,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      window.open(fileUrl(tradeId, f.name), "_blank")
                    }
                    title="Click to open full size"
                  />
                </div>
              )}

              {/* Non-image preview */}
              {previewFile === f.name && !isImage(f.name) && (
                <div
                  style={{
                    marginBottom: 4,
                    padding: "6px 8px",
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: 4,
                    fontSize: 10,
                    color: "var(--muted)",
                  }}
                >
                  <a
                    href={fileUrl(tradeId, f.name)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                  >
                    Open file in new tab
                  </a>
                </div>
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
        <span
          className="minor-text msg-error"
          style={{ fontSize: 9, display: "block", marginTop: 4 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
