import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import { SmartContent } from "../../../shared/components/SmartContent.jsx";
import { showDateTime } from "../../../shared/utils/format";

function fmtSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function looksJsonFile(fileName = "", mimeType = "") {
  return (
    String(fileName || "").toLowerCase().endsWith(".json") ||
    String(mimeType || "").toLowerCase().includes("json")
  );
}

export default function TradeLogsTab({ tradeSid, emptyText = "No log files found." }) {
  const [files, setFiles] = useState([]);
  const [contents, setContents] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadLogs = useCallback(
    async ({ background = false } = {}) => {
      if (!tradeSid) {
        setFiles([]);
        setContents({});
        setError("");
        return;
      }
      if (background) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const listRes = await api.tradeLogs(tradeSid);
        const nextFiles = Array.isArray(listRes?.files) ? listRes.files : [];
        setFiles(nextFiles);

        const entries = await Promise.all(
          nextFiles.map(async (file) => {
            const name = String(file?.name || "").trim();
            if (!name) return null;
            try {
              const contentRes = await api.tradeLogContent(tradeSid, name);
              return [name, contentRes || null];
            } catch (contentError) {
              return [
                name,
                {
                  ok: false,
                  error:
                    contentError instanceof Error
                      ? contentError.message
                      : String(contentError),
                },
              ];
            }
          }),
        );

        setContents(
          Object.fromEntries(entries.filter((entry) => Array.isArray(entry))),
        );
      } catch (err) {
        setFiles([]);
        setContents({});
        setError(err?.message || "Failed to load trade logs.");
      } finally {
        if (background) setRefreshing(false);
        else setLoading(false);
      }
    },
    [tradeSid],
  );

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const sections = useMemo(
    () =>
      files.map((file) => {
        const name = String(file?.name || "").trim();
        const content = contents[name] || null;
        return { file, name, content };
      }),
    [files, contents],
  );

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
        <span className="minor-text" style={{ fontSize: 11 }}>
          {files.length} log file{files.length !== 1 ? "s" : ""}
        </span>
        <button
          className="secondary-button"
          onClick={() => loadLogs({ background: true })}
          disabled={loading || refreshing || !tradeSid}
          style={{ marginLeft: "auto" }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
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

      {loading ? (
        <div
          className="minor-text"
          style={{ fontSize: 11, padding: 16, textAlign: "center" }}
        >
          Loading logs...
        </div>
      ) : sections.length === 0 ? (
        <div
          className="minor-text"
          style={{ fontSize: 11, padding: 16, textAlign: "center" }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sections.map(({ file, name, content }) => {
            const parsedJson = content?.parsed_json;
            const contentError = String(content?.error || "").trim();
            const textContent =
              content?.content == null ? "" : String(content.content);
            const isJson = looksJsonFile(name, file?.mime_type);

            return (
              <section
                key={name}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.03)",
                    flexWrap: "wrap",
                  }}
                >
                  <strong style={{ fontSize: 12 }}>{name}</strong>
                  {file?.mime_type ? (
                    <span className="minor-text" style={{ fontSize: 10 }}>
                      {file.mime_type}
                    </span>
                  ) : null}
                  {file?.size_bytes ? (
                    <span className="minor-text" style={{ fontSize: 10 }}>
                      {fmtSize(file.size_bytes)}
                    </span>
                  ) : null}
                  {file?.updated_at ? (
                    <span
                      className="minor-text"
                      style={{ fontSize: 10, marginLeft: "auto" }}
                    >
                      {showDateTime(file.updated_at)}
                    </span>
                  ) : null}
                </div>
                <div style={{ padding: 12 }}>
                  {contentError ? (
                    <div className="minor-text" style={{ color: "#ef4444" }}>
                      {contentError}
                    </div>
                  ) : parsedJson && typeof parsedJson === "object" ? (
                    <SmartContent content={parsedJson} mode="readonly" showCopy />
                  ) : textContent ? (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 12,
                        lineHeight: 1.55,
                        color: isJson ? "var(--text)" : "inherit",
                      }}
                    >
                      {textContent}
                    </pre>
                  ) : (
                    <div className="minor-text">Empty file.</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
