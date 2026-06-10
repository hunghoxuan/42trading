import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import DataTable from "./DataTable";
import { formatRelativeDateTime, showDateTime } from "../utils/format";

function sortLogFiles(files = []) {
  return [...files].sort((a, b) => {
    const aTime = String(a?.last_modified || "");
    const bTime = String(b?.last_modified || "");
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    return String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

function detectLogFormat(lines = [], forcedFormat = null) {
  if (forcedFormat) return forcedFormat;
  const sample = lines.filter(Boolean).slice(0, 5);
  if (!sample.length) return "text";
  const standardCount = sample.filter((line) =>
    /^\[[^\]]+\]\s+\[[^\]]+\]\s+\[[^\]]+\]\s+/.test(String(line || "")),
  ).length;
  return standardCount >= Math.max(1, Math.ceil(sample.length / 2))
    ? "standard"
    : "text";
}

function parseStructuredMessage(rest = "") {
  const match = String(rest).match(/,\s+[A-Za-z_][A-Za-z0-9_]*=/);
  if (!match || match.index == null) {
    return { message: String(rest || ""), metadataText: "" };
  }
  return {
    message: String(rest || "").slice(0, match.index),
    metadataText: String(rest || "").slice(match.index + 2),
  };
}

function parseStandardLogLine(line, index) {
  const match = String(line || "").match(
    /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/,
  );
  if (!match) {
    return {
      id: `raw-${index}`,
      raw: String(line || ""),
      timestamp: "",
      level: "RAW",
      eventType: "RAW",
      message: String(line || ""),
      metadataText: "",
    };
  }

  const [, timestamp, level, eventType, rest] = match;
  const parsed = parseStructuredMessage(rest);
  return {
    id: `${timestamp}-${eventType}-${index}`,
    raw: String(line || ""),
    timestamp,
    level: String(level || "").toUpperCase(),
    eventType: String(eventType || "").toUpperCase(),
    message: parsed.message,
    metadataText: parsed.metadataText,
  };
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimeAgo(value) {
  return formatRelativeDateTime(value);
}

function levelBadge(level) {
  const v = String(level || "").toUpperCase();
  if (v === "ERROR" || v === "FATAL") return "ERROR";
  if (v === "WARN" || v === "WARNING") return "ACTIVE";
  if (v === "INFO") return "START";
  if (v === "DEBUG" || v === "TRACE") return "INACTIVE";
  return "OTHER";
}

function typeBadgeClass(type = "") {
  const v = String(type || "").toUpperCase();
  if (v.includes("ERROR") || v.includes("FAIL")) return "SL";
  if (v.includes("WARN")) return "ACTIVE";
  if (v.includes("INFO")) return "START";
  if (v.includes("SUCCESS") || v.includes("OK")) return "TP";
  return "OTHER";
}

function levelTextClass(level = "") {
  const v = String(level || "").toUpperCase();
  if (v === "ERROR" || v === "FATAL") return "status-danger";
  if (v === "WARN" || v === "WARNING" || v === "INFO") return "status-warn";
  if (v === "SUCCESS" || v === "OK") return "status-success";
  return "status-neutral";
}

function typeTextClass(type = "") {
  const v = String(type || "").toUpperCase();
  if (v.includes("ERROR") || v.includes("FAIL") || v.includes("REJECT")) {
    return "status-danger";
  }
  if (v.includes("WARN") || v.includes("INFO")) return "status-warn";
  if (v.includes("SUCCESS") || v.includes("OK") || v.includes("DONE")) {
    return "status-success";
  }
  if (v.includes("OPEN") || v.includes("FILLED")) return "status-accent";
  return "status-neutral";
}

export default function LogViewer({
  source,
  objectId,
  fileName = "",
  logFormat = null,
  limit = 200,
  emptyText = "No log files found.",
  staticLines = null,
  staticLoading = false,
  hideToolbar = false,
}) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(fileName || "");
  const [lines, setLines] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isStaticMode = Array.isArray(staticLines);

  const activeFileMeta = useMemo(
    () => files.find((entry) => entry.name === selectedFile) || null,
    [files, selectedFile],
  );

  const effectiveLines = isStaticMode ? staticLines : lines;
  const effectiveTotalLines = isStaticMode ? staticLines.length : totalLines;
  const effectiveLoading = isStaticMode ? staticLoading : loading;

  const effectiveFormat = useMemo(
    () => detectLogFormat(effectiveLines, logFormat),
    [effectiveLines, logFormat],
  );

  const tableRows = useMemo(
    () =>
      effectiveLines
        .map((line, index) => parseStandardLogLine(line, index))
        .reverse(),
    [effectiveLines],
  );

  const tableColumns = useMemo(
    () => [
      {
        accessorKey: "timestamp",
        header: "Time",
        size: 180,
        cell: ({ row }) => {
          const value = row.original.timestamp;
          const level = row.original.level || "RAW";
          const timeAgo = formatTimeAgo(value);
          return (
            <div className="cell-wrap">
              <span className="cell-major time-ago">{timeAgo || "—"}</span>
              <span
                className={`cell-minor ${levelTextClass(level)}`}
                style={{ fontSize: 10, fontWeight: 800 }}
              >
                {level}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "eventType",
          header: "Message",
          size: 360,
          cell: ({ row }) => (
            <div className="cell-wrap">
              <span
                className={typeTextClass(row.original.eventType)}
                style={{
                  fontWeight: 800,
                  letterSpacing: "0.02em",
                  fontSize: 11,
                }}
              >
                {row.original.eventType || "RAW"}
              </span>
              <span className="cell-minor">
                {row.original.message || row.original.raw || "—"}
              </span>
          </div>
        ),
      },
      {
        accessorKey: "metadataText",
        header: "Info",
        size: 420,
        cell: ({ row }) => (
          <div className="cell-wrap">
            <span className="cell-major">
              {row.original.metadataText || "—"}
            </span>
          </div>
        ),
      },
    ],
    [],
  );

  const loadLogs = useCallback(
    async (preferredFile = "") => {
      if (isStaticMode) {
        setError("");
        return;
      }
      if (!source || !objectId) {
        setFiles([]);
        setSelectedFile("");
        setLines([]);
        setTotalLines(0);
        setError("");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const sourcesRes = await api.systemSources();
        const sourceFiles =
          sourcesRes?.sources?.[source]?.[objectId]?.files || {};
        const availableFiles = sortLogFiles(
          Object.entries(sourceFiles).map(([name, meta]) => ({
            name,
            ...(meta || {}),
          })),
        );
        setFiles(availableFiles);

        if (!availableFiles.length) {
          setSelectedFile("");
          setLines([]);
          setTotalLines(0);
          return;
        }

        const nextFile =
          preferredFile &&
          availableFiles.some((entry) => entry.name === preferredFile)
            ? preferredFile
            : fileName &&
                availableFiles.some((entry) => entry.name === fileName)
              ? fileName
              : availableFiles[0].name;

        setSelectedFile(nextFile);
        const fileRes = await api.systemLogFile(
          source,
          objectId,
          nextFile,
          limit,
        );
        const nextLines = Array.isArray(fileRes?.lines) ? fileRes.lines : [];
        setLines(nextLines);
        setTotalLines(Number(fileRes?.total_lines || nextLines.length || 0));
      } catch (err) {
        setError(err?.message || "Failed to load logs.");
        setLines([]);
        setTotalLines(0);
      } finally {
        setLoading(false);
      }
    },
    [source, objectId, fileName, limit, isStaticMode],
  );

  useEffect(() => {
    setSelectedFile(fileName || "");
  }, [fileName, source, objectId]);

  useEffect(() => {
    if (isStaticMode) return;
    loadLogs(fileName || "");
  }, [loadLogs, fileName, isStaticMode]);

  return (
    <div className="stack-layout">
      {!hideToolbar ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {files.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {files.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className={`secondary-button ${selectedFile === entry.name ? "active" : ""}`}
                  onClick={() => loadLogs(entry.name)}
                  disabled={effectiveLoading}
                >
                  {entry.name}
                  {entry.scope === "legacy" ? " (legacy)" : ""}
                </button>
              ))}
            </div>
          ) : null}
          <span
            className="minor-text"
            style={{ marginLeft: files.length ? 4 : 0 }}
          >
            Latest{" "}
            {Math.min(
              limit,
              effectiveTotalLines || effectiveLines.length || limit,
            )}{" "}
            lines
            {effectiveTotalLines > 0 ? ` of ${effectiveTotalLines}` : ""}
            {activeFileMeta?.last_modified
              ? ` • updated ${showDateTime(activeFileMeta.last_modified)}`
              : ""}
            {activeFileMeta?.size_bytes != null
              ? ` • ${formatBytes(activeFileMeta.size_bytes)}`
              : ""}
          </span>
          {!isStaticMode ? (
            <button
              type="button"
              className="secondary-button"
              style={{ marginLeft: "auto" }}
              onClick={() => loadLogs(selectedFile)}
              disabled={effectiveLoading || !source || !objectId}
            >
              {effectiveLoading ? "Loading..." : "Refresh"}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="form-message msg-error">{error}</div> : null}

      {!effectiveLoading && !error && !isStaticMode && files.length === 0 ? (
        <div className="minor-text">{emptyText}</div>
      ) : null}

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--panel)",
          padding: 12,
          minHeight: 320,
        }}
      >
        {effectiveLoading ? (
          <div className="minor-text">Loading logs...</div>
        ) : effectiveFormat === "standard" ? (
          <DataTable
            columns={tableColumns}
            data={tableRows}
            loading={false}
            emptyText="No log lines available."
          />
        ) : effectiveLines.length ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 560,
              overflow: "auto",
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {effectiveLines.join("\n")}
          </pre>
        ) : (
          <div className="minor-text">No log lines available.</div>
        )}
      </div>
    </div>
  );
}
