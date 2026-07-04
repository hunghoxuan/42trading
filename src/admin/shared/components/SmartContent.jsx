import { useState, useCallback } from "react";

/**
 * SmartContent — auto-detects format and renders appropriately.
 * Mode "readonly": display only.
 * Mode "editable": click text → switches to textarea, blur → back to view.
 * Light border in view mode.
 */
export function SmartContent({
  content,
  mode = "readonly",
  rows = 6,
  onChange,
  showCopy = false,
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const raw = content ?? "";
  const isEmpty = !raw || (typeof raw === "string" && !raw.trim());
  const isJson =
    typeof raw === "object" ||
    (typeof raw === "string" && raw.trim().startsWith("{"));
  const isHtml = typeof raw === "string" && /<[a-z][\s\S]*>/i.test(raw);

  const displayText = useCallback(() => {
    if (isJson && typeof raw === "object") return JSON.stringify(raw, null, 2);
    if (isJson && typeof raw === "string") {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return String(raw);
  }, [raw, isJson]);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const borderStyle = {
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 6,
  };

  if (mode === "readonly") {
    if (isEmpty) return <span className="minor-text">—</span>;
    if (isJson)
      return (
        <div style={{ position: "relative" }}>
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 300,
              overflow: "auto",
              color: "var(--text)",
              opacity: 0.85,
              ...borderStyle,
            }}
          >
            {displayText()}
          </pre>
          {showCopy ? (
            <button
              className="secondary-button"
              onClick={handleCopy}
              style={{
                position: "absolute",
                top: 4,
                right: 4,

                opacity: 0.8,
              }}
              title="Copy JSON"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
      );
    if (isHtml) return <div dangerouslySetInnerHTML={{ __html: raw }} />;
    const lines = String(raw)
      .split(/\.\s+|\n/)
      .filter(Boolean);
    return (
      <div style={{ lineHeight: 1.5, fontSize: 11, ...borderStyle }}>
        {lines.map((line, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            {line.trim()}
            {i < lines.length - 1 ? "." : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {editing ? (
        <textarea
          autoFocus
          style={{
            width: "100%",
            minHeight: rows * 18,
            fontSize: 10,
            padding: 6,
            background: "rgba(255,255,255,0.05)",
            color: "var(--text)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            resize: "vertical",
          }}
          value={typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <div style={{ position: "relative" }}>
          {isEmpty ? (
            <div
              onClick={() => setEditing(true)}
              style={{
                cursor: "text",
                fontSize: 10,
                ...borderStyle,
                color: "var(--muted)",
              }}
            >
              Click to edit...
            </div>
          ) : isJson ? (
            <pre
              onClick={() => setEditing(true)}
              style={{
                cursor: "text",
                margin: 0,
                fontSize: 10,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 250,
                overflow: "auto",
                color: "var(--text)",
                opacity: 0.85,
                ...borderStyle,
              }}
            >
              {displayText()}
            </pre>
          ) : isHtml ? (
            <div
              onClick={() => setEditing(true)}
              dangerouslySetInnerHTML={{ __html: raw }}
              style={{ cursor: "text", ...borderStyle }}
            />
          ) : (
            <div
              onClick={() => setEditing(true)}
              style={{
                cursor: "text",
                lineHeight: 1.5,
                fontSize: 11,
                ...borderStyle,
              }}
            >
              {String(raw)
                .split(/\.\s+|\n/)
                .filter(Boolean)
                .map((line, i, arr) => (
                  <div key={i} style={{ marginBottom: 3 }}>
                    {line.trim()}
                    {i < arr.length - 1 ? "." : ""}
                  </div>
                ))}
            </div>
          )}
          <button
            className="secondary-button"
            onClick={handleCopy}
            style={{
              position: "absolute",
              top: 4,
              right: 4,

              opacity: 0.6,
            }}
          >
            {copied ? "✓" : "📋"}
          </button>
        </div>
      )}
    </div>
  );
}
