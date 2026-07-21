import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import LogsComponent, {
  compactLogPayloadSummary,
} from "../../../shared/components/LogsComponent.jsx";
import { formatRelativeDateTime, showDateTime } from "../../../shared/utils/format";

function looksJsonFile(fileName = "", mimeType = "") {
  return (
    String(fileName || "").toLowerCase().endsWith(".json") ||
    String(mimeType || "").toLowerCase().includes("json")
  );
}

function eventLabel(event = {}) {
  return (
    event.event_type ||
    event.type ||
    event.action ||
    event.status ||
    event.name ||
    event.kind ||
    "EVENT"
  );
}

function eventTime(event = {}) {
  return event.event_time || event.created_at || event.updated_at || event.time || "";
}

export default function TradeLogsTab({
  tradeSid,
  emptyText = "No log files found.",
  apiScope = "",
  events = [],
}) {
  const [files, setFiles] = useState([]);
  const [contents, setContents] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
        const apiOptions = apiScope ? { scope: apiScope } : {};
        const listRes = await api.tradeLogs(tradeSid, apiOptions);
        const nextFiles = Array.isArray(listRes?.files) ? listRes.files : [];
        setFiles(nextFiles);

        const entries = await Promise.all(
          nextFiles.map(async (file) => {
            const name = String(file?.name || "").trim();
            if (!name) return null;
            try {
              const contentRes = await api.tradeLogContent(tradeSid, name, apiOptions);
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
    [apiScope, tradeSid],
  );

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const logRows = useMemo(
    () =>
      files.map((file, index) => {
        const name = String(file?.name || "").trim() || `log-${index + 1}`;
        const content = contents[name] || null;
        const parsedJson = content?.parsed_json;
        const textContent = content?.content == null ? "" : String(content.content);
        const contentError = String(content?.error || "").trim();
        const payload = contentError
          ? { error: contentError }
          : parsedJson || textContent || {};
        return {
          id: `file:${name}`,
          source: "TRADE LOG",
          title: looksJsonFile(name, file?.mime_type) ? "JSON_FILE" : "TEXT_FILE",
          status: "INFO",
          summary: name,
          info:
            contentError ||
            (parsedJson
              ? compactLogPayloadSummary(parsedJson)
              : textContent.slice(0, 180)) ||
            "Empty file",
          time: file?.updated_at || file?.created_at || "",
          size: file?.size_bytes || 0,
          payload,
        };
      }),
    [contents, files],
  );

  const eventRows = useMemo(
    () =>
      (Array.isArray(events) ? events : []).map((event, index) => ({
        id: `event:${event?.id || event?.event_id || eventTime(event) || index}`,
        source: "TRADE EVENT",
        title: String(eventLabel(event)).toUpperCase(),
        status:
          event.execution_status ||
          event.dispatch_status ||
          event.level ||
          "INFO",
        summary:
          event.message ||
          event.reason ||
          compactLogPayloadSummary(event),
        info: compactLogPayloadSummary(event),
        time: eventTime(event),
        size: 0,
        payload: event || {},
      })),
    [events],
  );

  const rows = useMemo(() => [...logRows, ...eventRows], [eventRows, logRows]);
  const toolbar = useMemo(
    () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span className="minor-text">
          {files.length} log file{files.length !== 1 ? "s" : ""} • {eventRows.length} event{eventRows.length !== 1 ? "s" : ""}
        </span>
        <span className="minor-text">
          {rows.length ? `Latest ${rows.length} items` : "No activity yet"}
        </span>
      </div>
    ),
    [eventRows.length, files.length, rows.length],
  );

  const handleDeleteAll = useCallback(async () => {
    if (!tradeSid || deleting || files.length <= 0) return;
    const confirmed = window.confirm(
      `Delete all ${files.length} log file${files.length !== 1 ? "s" : ""} for trade ${tradeSid}?`,
    );
    if (!confirmed) return;
    setDeleting(true);
    setError("");
    try {
      await api.deleteTradeLogs(tradeSid, apiScope ? { scope: apiScope } : {});
      await loadLogs({ background: false });
    } catch (err) {
      setError(err?.message || "Failed to delete trade logs.");
    } finally {
      setDeleting(false);
    }
  }, [apiScope, deleting, files.length, loadLogs, tradeSid]);

  const columns = useMemo(
    () => [
      {
        accessorKey: "time",
        header: "Time",
        size: 180,
        cell: ({ row }) => {
          const value = row.original.time;
          const status = String(row.original.status || "INFO").toUpperCase();
          return (
            <div className="cell-wrap">
              <span className="cell-major time-ago">
                {formatRelativeDateTime(value) || "—"}
              </span>
              <span className="cell-minor" style={{ fontSize: 10, fontWeight: 800 }}>
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
            <span style={{ fontWeight: 800, letterSpacing: "0.02em", fontSize: 11 }}>
              {row.original.title || "EVENT"}
            </span>
            <span className="cell-minor">{row.original.summary || "—"}</span>
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

  return (
    <div style={{ padding: "8px 0" }}>
      <LogsComponent
        rows={rows}
        columns={columns}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyText={emptyText}
        title="Activity"
        subtitle="Click a log row to inspect the full payload"
        toolbar={toolbar}
        headerActions={
          <button
            type="button"
            className="secondary-button"
            onClick={handleDeleteAll}
            disabled={!tradeSid || deleting || loading || files.length <= 0}
            title={files.length > 0 ? "Delete all log files" : "No log files to delete"}
          >
            {deleting ? "Deleting..." : "Delete All"}
          </button>
        }
        onRefresh={() => loadLogs({ background: true })}
        refreshDisabled={!tradeSid}
        getDetailTitle={(row) => row?.title || "Log Detail"}
        getDetailSubtitle={(row) =>
          row?.time ? `${showDateTime(row.time)} • ${String(row.status || "INFO").toUpperCase()}` : "Select a log row to inspect the full payload"
        }
      />
    </div>
  );
}
