import { useCallback, useMemo, useState } from "react";

function formatBytesShort(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(size) / Math.log(1024)),
  );
  const amount = size / Math.pow(1024, index);
  return `${amount.toFixed(index === 0 ? 0 : amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function isLikelyHtml(value = "") {
  return typeof value === "string" && /<[a-z][\s\S]*>/i.test(value);
}

function inferModeFromValue(content, mimeType = "", fileName = "") {
  const mime = String(mimeType || "").trim().toLowerCase();
  const name = String(fileName || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    return "html";
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    name.endsWith(".json") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".log")
  ) {
    return "text";
  }
  if (typeof content === "object" && content !== null) return "text";
  if (isLikelyHtml(content)) return "html";
  if (typeof content === "string") return "text";
  return "binary";
}

function normalizeTextContent(content) {
  if (content == null) return "";
  if (typeof content === "object") {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function extractBinarySource(content) {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    if (typeof content.src === "string") return content.src;
    if (typeof content.url === "string") return content.url;
    if (typeof content.dataUrl === "string") return content.dataUrl;
  }
  return "";
}

function ContentInfo({ mode = "", sizeBytes = null, mimeType = "", showInfo = false }) {
  if (!showInfo) return null;
  const parts = [];
  const label = String(mode || "").trim();
  const sizeLabel = formatBytesShort(sizeBytes);
  if (label) parts.push(label.toUpperCase());
  if (mimeType) parts.push(String(mimeType).trim());
  if (sizeLabel) parts.push(sizeLabel);
  if (!parts.length) return null;
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 10,
        color: "var(--muted)",
        lineHeight: 1.3,
      }}
    >
      {parts.join(" • ")}
    </div>
  );
}

/**
 * SmartContent
 * - Preview modes: auto | binary | image | video | text | html
 * - Legacy interaction modes still supported through mode="readonly|editable"
 */
export function SmartContent({
  content,
  mode = "auto",
  interactionMode = "readonly",
  rows = 6,
  onChange,
  showCopy = false,
  showInfo = false,
  show_info = undefined,
  sizeBytes = null,
  size_bytes = undefined,
  mimeType = "",
  mime_type = undefined,
  fileName = "",
  file_name = undefined,
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const normalizedMode = String(mode || "auto").trim().toLowerCase();
  const legacyInteractionMode =
    normalizedMode === "readonly" || normalizedMode === "editable"
      ? normalizedMode
      : "";
  const effectiveInteractionMode =
    legacyInteractionMode ||
    String(interactionMode || "readonly").trim().toLowerCase() ||
    "readonly";
  const requestedPreviewMode = legacyInteractionMode ? "auto" : normalizedMode;
  const resolvedMimeType = mime_type ?? mimeType;
  const resolvedFileName = file_name ?? fileName;
  const resolvedSizeBytes = size_bytes ?? sizeBytes;
  const resolvedShowInfo = typeof show_info === "boolean" ? show_info : showInfo;
  const effectiveMode =
    requestedPreviewMode === "auto"
      ? inferModeFromValue(content, resolvedMimeType, resolvedFileName)
      : requestedPreviewMode;
  const rawText = useMemo(() => normalizeTextContent(content), [content]);
  const isEmpty = !rawText.trim();
  const isJsonObject = typeof content === "object" && content !== null;
  const isJsonString =
    typeof content === "string" &&
    (content.trim().startsWith("{") || content.trim().startsWith("["));
  const source = extractBinarySource(content);

  const displayText = useCallback(() => {
    if (isJsonObject) return rawText;
    if (isJsonString) {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return rawText;
      }
    }
    return rawText;
  }, [content, isJsonObject, isJsonString, rawText]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(displayText()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [displayText]);

  const borderStyle = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 8,
    background: "rgba(255,255,255,0.02)",
  };

  const renderTextPreview = (editable = false) => {
    if (isEmpty) {
      return (
        <div
          onClick={editable ? () => setEditing(true) : undefined}
          style={{
            ...borderStyle,
            cursor: editable ? "text" : "default",
            color: "var(--muted)",
            fontSize: 11,
          }}
        >
          {editable ? "Click to edit..." : "—"}
        </div>
      );
    }
    const textValue = displayText();
    const looksJson = isJsonObject || isJsonString;
    if (looksJson) {
      return (
        <pre
          onClick={editable ? () => setEditing(true) : undefined}
          style={{
            ...borderStyle,
            cursor: editable ? "text" : "default",
            margin: 0,
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 320,
            overflow: "auto",
            color: "var(--text)",
            opacity: 0.9,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {textValue}
        </pre>
      );
    }
    return (
      <pre
        onClick={editable ? () => setEditing(true) : undefined}
        style={{
          ...borderStyle,
          cursor: editable ? "text" : "default",
          margin: 0,
          fontSize: 11,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 320,
          overflow: "auto",
          color: "var(--text)",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        {textValue}
      </pre>
    );
  };

  const renderHtmlPreview = () => {
    if (isEmpty) return <span className="minor-text">—</span>;
    return (
      <div
        style={{
          ...borderStyle,
          maxHeight: 320,
          overflow: "auto",
        }}
        dangerouslySetInnerHTML={{ __html: rawText }}
      />
    );
  };

  const renderImagePreview = () => {
    if (!source) {
      return <div style={borderStyle} className="minor-text">No image preview available.</div>;
    }
    return (
      <div style={borderStyle}>
        <img
          src={source}
          alt={String(resolvedFileName || "preview")}
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight: 360,
            width: "auto",
            height: "auto",
            margin: "0 auto",
            borderRadius: 6,
          }}
        />
      </div>
    );
  };

  const renderVideoPreview = () => {
    if (!source) {
      return <div style={borderStyle} className="minor-text">No video preview available.</div>;
    }
    return (
      <div style={borderStyle}>
        <video
          src={source}
          controls
          style={{
            display: "block",
            width: "100%",
            maxHeight: 360,
            borderRadius: 6,
            background: "#000",
          }}
        />
      </div>
    );
  };

  const renderBinaryPreview = () => (
    <div
      style={{
        ...borderStyle,
        minHeight: 92,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        fontSize: 11,
        textAlign: "center",
      }}
    >
      Binary preview is not available.
    </div>
  );

  const renderReadonlyPreview = () => {
    if (effectiveMode === "image") return renderImagePreview();
    if (effectiveMode === "video") return renderVideoPreview();
    if (effectiveMode === "html") return renderHtmlPreview();
    if (effectiveMode === "binary") return renderBinaryPreview();
    return renderTextPreview(false);
  };

  const canEdit = effectiveInteractionMode === "editable" && effectiveMode === "text";

  if (canEdit && editing) {
    return (
      <div>
        <textarea
          autoFocus
          style={{
            width: "100%",
            minHeight: rows * 18,
            fontSize: 11,
            padding: 8,
            background: "rgba(255,255,255,0.05)",
            color: "var(--text)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            resize: "vertical",
          }}
          value={rawText}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={() => setEditing(false)}
        />
        <ContentInfo
          mode={effectiveMode}
          sizeBytes={resolvedSizeBytes}
          mimeType={resolvedMimeType}
          showInfo={resolvedShowInfo}
        />
      </div>
    );
  }

  const showCopyButton =
    showCopy && (effectiveMode === "text" || effectiveMode === "html");

  return (
    <div>
      <div style={{ position: "relative" }}>
        {effectiveMode === "text" && canEdit
          ? renderTextPreview(true)
          : renderReadonlyPreview()}
        {showCopyButton ? (
          <button
            className="secondary-button"
            onClick={handleCopy}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              opacity: 0.8,
            }}
            title="Copy content"
            type="button"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      <ContentInfo
        mode={effectiveMode}
        sizeBytes={resolvedSizeBytes}
        mimeType={resolvedMimeType}
        showInfo={resolvedShowInfo}
      />
    </div>
  );
}

export default SmartContent;
