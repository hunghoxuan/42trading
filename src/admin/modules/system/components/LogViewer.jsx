import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../app/api";
import { realtimeClient } from "../../42trade/realtime/realtimeClientSingleton";
import LogsComponent from "../../../shared/components/LogsComponent.jsx";
import { formatRelativeDateTime, showDateTime } from "../../../shared/utils/format";
import { normalizeActivityResult } from "../../../shared/utils/activityResult.js";

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

function splitMetadataEntries(metadataText = "") {
  const source = String(metadataText || "").trim();
  if (!source) return [];
  const entries = [];
  let current = "";
  let quote = null;
  let bracketDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const prev = index > 0 ? source[index - 1] : "";
    if (quote) {
      current += char;
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{" || char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === "}" || char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }
    if (char === "," && bracketDepth === 0) {
      const next = source[index + 1] || "";
      if (next === " ") {
        entries.push(current.trim());
        current = "";
        index += 1;
        continue;
      }
    }
    current += char;
  }

  if (current.trim()) entries.push(current.trim());
  return entries.filter(Boolean);
}

function parseMetadataValue(rawValue = "") {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    try {
      return JSON.parse(`"${inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    } catch {
      return inner;
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseMetadataText(metadataText = "") {
  const out = {};
  for (const entry of splitMetadataEntries(metadataText)) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trim();
    if (!key) continue;
    out[key] = parseMetadataValue(entry.slice(separator + 1));
  }
  return out;
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
  const metadata = parseMetadataText(parsed.metadataText);
  const result = normalizeActivityResult(
    metadata && typeof metadata.result === "object"
      ? metadata.result
      : {
          ...metadata,
          message: parsed.message,
          level: level,
          event: eventType,
        },
    { ok: String(level || "").toUpperCase() !== "ERROR" },
  );
  return {
    id: `${timestamp}-${eventType}-${index}`,
    raw: String(line || ""),
    timestamp,
    level: String(level || "").toUpperCase(),
    eventType: String(eventType || "").toUpperCase(),
    message: String(result.message || parsed.message || "").trim(),
    metadataText: parsed.metadataText,
    metadata,
    result,
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
  useCrudContainer = false,
}) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(fileName || "");
  const [lines, setLines] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState("");
  const isStaticMode = Array.isArray(staticLines);
  const realtimeUnsubscribeRef = useRef(null);

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

  const selectedRow = useMemo(
    () => tableRows.find((row) => row.id === selectedRowId) || null,
    [selectedRowId, tableRows],
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

  const handleSelectRow = useCallback((row) => {
    const nextId = String(row?.id || "");
    if (!nextId) return;
    setSelectedRowId(nextId);
    setDetailOpen(true);
  }, []);

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
    if (!tableRows.length) {
      setSelectedRowId("");
      setDetailOpen(false);
      return;
    }
    if (selectedRowId && tableRows.some((row) => row.id === selectedRowId)) {
      return;
    }
    setSelectedRowId("");
    setDetailOpen(false);
  }, [selectedRowId, tableRows]);

  useEffect(() => {
    if (isStaticMode) return;
    loadLogs(fileName || "");
  }, [loadLogs, fileName, isStaticMode]);

  useEffect(() => {
    if (isStaticMode) return undefined;
    if (!source || !objectId || !selectedFile) return undefined;
    const topic = `logs:${String(source || "").trim().toLowerCase()}:${String(objectId || "").trim()}:${String(selectedFile || "").trim()}`;
    realtimeUnsubscribeRef.current = realtimeClient.subscribe(
      topic,
      { bars: limit },
      (envelope) => {
        if (envelope?.type === "snapshot") {
          const nextLines = Array.isArray(envelope?.data?.lines)
            ? envelope.data.lines
            : [];
          setLines(nextLines);
          setTotalLines(
            Number(envelope?.data?.total_lines || nextLines.length || 0),
          );
          return;
        }
        if (envelope?.type !== "log_append") return;
        const nextLine = String(envelope?.data?.line || "");
        if (!nextLine) return;
        setLines((prev) => [...prev, nextLine].slice(-Math.max(1, limit)));
        setTotalLines((prev) => Math.max(0, Number(prev || 0)) + 1);
        setFiles((prev) =>
          prev.map((entry) =>
            entry.name === selectedFile
              ? {
                  ...entry,
                  last_modified: new Date().toISOString(),
                }
              : entry,
          ),
        );
      },
      {
        onError: (streamError) => {
          console.warn("[LogViewer] realtime log stream error:", streamError);
        },
      },
    );
    return () => {
      if (typeof realtimeUnsubscribeRef.current === "function") {
        realtimeUnsubscribeRef.current();
      }
      realtimeUnsubscribeRef.current = null;
    };
  }, [isStaticMode, limit, objectId, selectedFile, source]);

  const fileButtons = files.length > 0 ? (
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
  ) : null;

  const toolbarContent = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {fileButtons}
      <span className="minor-text" style={{ marginLeft: files.length ? 4 : 0 }}>
        Latest {Math.min(limit, effectiveTotalLines || effectiveLines.length || limit)} lines
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
  );

  const logRows = useMemo(
    () =>
      tableRows.map((row) => ({
        id: row.id,
        time: row.timestamp,
        entryType: row.eventType || "RAW",
        status: row.level || "",
        title: row.eventType || "RAW",
        summary: row.message || row.raw || "—",
        info: row.metadataText || "—",
        source: activeFileMeta?.name || source || "LOGS",
        payload: {
          id: row.id,
          timestamp: row.timestamp,
          level: row.level,
          eventType: row.eventType,
          message: row.message,
          metadata: row.metadata,
          raw: row.raw,
        },
      })),
    [activeFileMeta?.name, source, tableRows],
  );

  const sharedColumns = useMemo(
    () => [
      {
        accessorKey: "time",
        header: "Time",
        size: 180,
        cell: ({ row }) => {
          const value = row.original.time;
          const status = row.original.status || "RAW";
          const timeAgo = formatTimeAgo(value);
          return (
            <div className="cell-wrap">
              <span className="cell-major time-ago">{timeAgo || "—"}</span>
              <span
                className={`cell-minor ${levelTextClass(status)}`}
                style={{ fontSize: 10, fontWeight: 800 }}
              >
                {status}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "title",
        header: "Message",
        size: 360,
        cell: ({ row }) => (
          <div className="cell-wrap">
            <span
              className={typeTextClass(row.original.title)}
              style={{ fontWeight: 800, letterSpacing: "0.02em", fontSize: 11 }}
            >
              {row.original.title || "RAW"}
            </span>
            <span className="cell-minor">
              {row.original.summary || "—"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "info",
        header: "Info",
        size: 420,
        cell: ({ row }) => (
          <div className="cell-wrap">
            <span className="cell-major">{row.original.info || "—"}</span>
          </div>
        ),
      },
    ],
    [],
  );

  if (effectiveFormat === "standard") {
    return (
      <LogsComponent
        rows={logRows}
        columns={sharedColumns}
        loading={effectiveLoading}
        error={error}
        emptyText={!isStaticMode ? emptyText : "No log lines available."}
        title={activeFileMeta?.name || "Activity"}
        subtitle="Click a log row to inspect the full payload"
        toolbar={!hideToolbar ? toolbarContent : null}
        onRefresh={
          !isStaticMode ? () => loadLogs(selectedFile) : null
        }
        refreshDisabled={effectiveLoading || (!isStaticMode && (!source || !objectId))}
        getDetailTitle={(row) => row?.title || "Log Detail"}
        getDetailSubtitle={(row) =>
          row?.time ? `${showDateTime(row.time)} • ${row.status || "RAW"}` : "Select a log row to inspect its JSON payload"
        }
      />
    );
  }

  return (
    <div className="stack-layout">
      {!hideToolbar ? (
        toolbarContent
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
