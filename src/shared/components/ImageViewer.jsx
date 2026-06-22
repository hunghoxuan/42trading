import { useState } from "react";

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

export default function ImageViewer({
  files = [],
  onDelete,
  onDownload,
  getUrl,
  disabled = false,
  showDelete = false,
  showDownload = true,
}) {
  const [previewFile, setPreviewFile] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const toggleSelect = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!onDelete || !selected.size) return;
    const filesToDelete = [...selected];
    for (const name of filesToDelete) {
      try {
        await onDelete(name);
      } catch (e) {}
    }
    setSelected(new Set());
    setSelectMode(false);
  };

  if (!files.length) return null;

  return (
    <div>
      {/* Select mode toolbar */}
      {showDelete && files.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 6,
            alignItems: "center",
          }}
        >
          <button
            className="secondary-button"
            onClick={() => {
              setSelectMode(!selectMode);
              setSelected(new Set());
            }}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
          {selectMode && selected.size > 0 && (
            <button
              className="danger-button"
              onClick={deleteSelected}
            >
              Delete {selected.size} selected
            </button>
          )}
        </div>
      )}

      {/* File list */}
      {files.map((f) => {
        const name = f.name || f.file_name || "";
        const url = getUrl ? getUrl(f) : f.url || "";
        const size = f.size || f.size_bytes || 0;
        if (!isImage(name) && !url) return null;

        return (
          <div key={name}>
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
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggleSelect(name)}
                  style={{ marginRight: 6 }}
                />
              )}
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
                onClick={() =>
                  setPreviewFile(previewFile === name ? null : name)
                }
                title="Click to preview"
              >
                🖼 {name}
                {size > 0 && (
                  <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                    {fmtSize(size)}
                  </span>
                )}
              </span>
              {showDownload && (
                <a
                  href={url}
                  download={name}
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
              )}
              {!disabled && showDelete && !selectMode && (
                <button
                  className="secondary-button"
                  onClick={() => onDelete?.(name)}
                  style={{



                    marginLeft: 4,
                    color: "#ef5350",
                    borderColor: "transparent",
                    background: "transparent",
                  }}
                  title="Delete"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Image preview modal */}
            {previewFile === name && (
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
                  <img
                    src={url}
                    alt={name}
                    style={{
                      maxWidth: "90vw",
                      maxHeight: "80vh",
                      objectFit: "contain",
                      borderRadius: 8,
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: "#fff", fontSize: 11 }}>{name}</span>
                    {showDownload && (
                      <a
                        href={url}
                        download={name}
                        className="primary-button"
                        style={{
                          fontSize: 10,
                          padding: "4px 12px",
                          textDecoration: "none",
                        }}
                      >
                        ⬇ Download
                      </a>
                    )}
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
      })}
    </div>
  );
}
