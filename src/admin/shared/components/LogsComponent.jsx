import { useEffect, useMemo, useState } from "react";
import CrudContainer from "./CrudContainer";
import DataTable from "./DataTable";
import { StatusDisplay } from "./StatusBadge";
import { showDateTime } from "../utils/format";
import { normalizeActivityResult } from "../utils/activityResult.js";
import "./LogsComponent.css";

export function stringifyLogPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function compactLogPayloadSummary(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return stringifyLogPayload(payload).slice(0, 160) || "-";
  }
  const entries = Object.entries(payload).filter(([, value]) => {
    if (value == null || value === "") return false;
    if (typeof value === "object" && Object.keys(value || {}).length === 0) {
      return false;
    }
    return true;
  });
  if (!entries.length) return "Empty payload";
  return entries
    .slice(0, 4)
    .map(([key, value]) => {
      const compactValue =
        typeof value === "object"
          ? stringifyLogPayload(value).replace(/\s+/g, " ").slice(0, 60)
          : String(value);
      return `${key}: ${compactValue}`;
    })
    .join(" • ");
}

function formatLogSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeLogRow(row = {}, index = 0) {
  const id = String(row.id || row.key || `${row.source || "log"}:${index}`);
  const payload = row.payload ?? row.data ?? row.raw ?? {};
  const result = normalizeActivityResult(
    row.result ||
      (payload && typeof payload === "object" ? payload.result || payload : {}) ||
      row,
    { ok: row?.ok !== false },
  );
  const entryType =
    row.entryType ||
    row.entry_type ||
    payload?.entry_type ||
    payload?.entryType ||
    payload?.event_type ||
    payload?.eventType ||
    row.type ||
    row.level ||
    "LOG";
  const status =
    result.status ||
    row.status ||
    payload?.status ||
    payload?.execution_status ||
    payload?.executionStatus ||
    payload?.dispatch_status ||
    payload?.dispatchStatus ||
    payload?.result ||
    payload?.state ||
    payload?.direction ||
    "";
  return {
    id,
    source: row.source || "LOG",
    type: row.type || row.level || "LOG",
    result,
    entryType,
    status,
    title: row.title || row.name || row.eventType || row.type || "Log",
    summary:
      row.summary ||
      result.message ||
      compactLogPayloadSummary(payload),
    time: row.time || row.updated_at || row.created_at || row.timestamp || "",
    size: row.size || row.size_bytes || 0,
    payload,
    raw: row,
  };
}

export default function LogsComponent({
  rows = [],
  columns = null,
  loading = false,
  refreshing = false,
  error = "",
  emptyText = "No logs found.",
  title = "History",
  subtitle = "",
  onRefresh = null,
  refreshDisabled = false,
  className = "",
  toolbar = null,
  getDetailTitle = null,
  getDetailSubtitle = null,
  renderDetail = null,
  normalizeRow = null,
  headerActions = null,
  onDeleteAll = null,
  deleteAllDisabled = false,
  deleteAllLabel = "Delete all log items",
  deleteAllIcon = "🗑",
}) {
  const [selectedRowId, setSelectedRowId] = useState("");
  const [detailOpen, setDetailOpen] = useState(true);

  const normalizedRows = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).map(
        normalizeRow || normalizeLogRow,
      ),
    [normalizeRow, rows],
  );

  const selectedRow = useMemo(
    () => normalizedRows.find((row) => row.id === selectedRowId) || null,
    [normalizedRows, selectedRowId],
  );

  useEffect(() => {
    if (selectedRowId && normalizedRows.some((row) => row.id === selectedRowId)) {
      return;
    }
    setSelectedRowId(normalizedRows[0]?.id || "");
  }, [normalizedRows, selectedRowId]);

  useEffect(() => {
    if (selectedRow?.id) setDetailOpen(true);
  }, [selectedRow?.id]);

  const defaultColumns = useMemo(
    () => [
      {
        accessorKey: "entryType",
        header: "Entry Type",
        size: 190,
        cell: ({ row }) => (
          <div className="cell-wrap">
            <span className="cell-major logs-component__type">
              {row.original.entryType || "-"}
            </span>
            <span className="cell-minor">{row.original.source}</span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) =>
          row.original.status ? (
            <StatusDisplay
              status={row.original.status}
              label={String(row.original.status).toUpperCase()}
              size="mini"
            />
          ) : (
            "-"
          ),
      },
      {
        accessorKey: "title",
        header: "Summary",
        cell: ({ row }) => (
          <div className="cell-wrap">
            <span className="cell-major logs-component__summary">
              {row.original.summary || row.original.title || "-"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "time",
        header: "Updated",
        size: 170,
        cell: ({ row }) => showDateTime(row.original.time) || "-",
      },
      {
        accessorKey: "size",
        header: "Size",
        size: 100,
        cell: ({ row }) => formatLogSize(row.original.size) || "-",
      },
    ],
    [],
  );

  const payloadText = stringifyLogPayload(selectedRow?.payload);
  const resolvedColumns = columns || defaultColumns;
  const detailTitle = getDetailTitle
    ? getDetailTitle(selectedRow)
    : selectedRow?.title || "Detail";
  const detailSubtitle = getDetailSubtitle
    ? getDetailSubtitle(selectedRow)
    : selectedRow?.time
      ? showDateTime(selectedRow.time)
      : selectedRow?.source || "";
  const detailContent = renderDetail
    ? renderDetail(selectedRow, payloadText)
    : selectedRow
      ? (
        <div className="logs-component__payload-shell">
          <pre className="logs-component__payload">{payloadText || "{}"}</pre>
        </div>
      )
      : (
        <div className="minor-text logs-component__empty-detail">
          Select a log row.
        </div>
      );

  return (
    <div className={["logs-component-wrap", className].filter(Boolean).join(" ")}>
      {error ? (
        <div className="minor-text logs-component__error">{error}</div>
      ) : null}

      {toolbar ? <div className="logs-component__toolbar">{toolbar}</div> : null}

      <CrudContainer
        className="logs-component"
        sameHeight
        detailVisible={Boolean(selectedRow)}
        detailOpen={detailOpen && Boolean(selectedRow)}
        onDetailOpenChange={setDetailOpen}
        detailCloseButton
        list={{
          title,
          subtitle,
          headerActions:
            headerActions || onDeleteAll || onRefresh ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {headerActions}
                {onDeleteAll ? (
                  <button
                    type="button"
                    className="danger-button logs-component__icon-button"
                    onClick={onDeleteAll}
                    disabled={loading || deleteAllDisabled}
                    aria-label={deleteAllLabel}
                    title={deleteAllLabel}
                  >
                    {deleteAllIcon}
                  </button>
                ) : null}
                {onRefresh ? (
                  <button
                    type="button"
                    className="secondary-button logs-component__icon-button"
                    onClick={onRefresh}
                    disabled={loading || refreshing || refreshDisabled}
                    aria-label="Refresh logs"
                    title="Refresh"
                  >
                    {refreshing ? "..." : "↻"}
                  </button>
                ) : null}
              </div>
            ) : null,
          panelClassName: "db-manager-rows-panel logs-component__list-panel",
          tableProps: {
            columns: resolvedColumns,
            data: normalizedRows,
            loading,
            emptyText,
            className: "events-table events-table--compact logs-component__table",
            onRowClick: (row) => setSelectedRowId(row?.id || ""),
            getRowId: (row) => row?.id,
            selectedRowId,
          },
        }}
        detail={{
          title: detailTitle,
          subtitle: detailSubtitle,
          headerActions: selectedRow ? (
            <button
              type="button"
              className="secondary-button logs-component__icon-button"
              onClick={() => navigator.clipboard.writeText(payloadText)}
              aria-label="Copy payload"
              title="Copy"
            >
              ⧉
            </button>
          ) : null,
          panelClassName: "logs-component__detail-panel",
          children: detailContent,
        }}
      />
    </div>
  );
}
