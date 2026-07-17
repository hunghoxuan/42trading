import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useMemo, useCallback, useEffect, useState } from "react";

import useIsMobile from "../hooks/useIsMobile.js";
import ComboButtonMenu from "./ComboButtonMenu.jsx";

function getFallbackInitials(input) {
  const parts = String(input || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "•";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function toneClassName(tone) {
  const value = String(tone || "").trim().toLowerCase();
  if (!value) return "";
  return `is-${value}`;
}

function MobileCardThumb({ src = "", alt = "", label = "" }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(String(src || "").trim()) && !failed;

  if (showImage) {
    return (
      <img
        src={src}
        alt={alt || label}
        className="data-table-mobile-card__thumb"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="data-table-mobile-card__thumb data-table-mobile-card__thumb--fallback">
      {getFallbackInitials(label)}
    </div>
  );
}

/**
 * Headless data table wrapping @tanstack/react-table.
 * Renders <table className="table-dense"> with sortable headers.
 * No CSS opinions — uses existing .table-dense + .events-table classes.
 *
 * Props:
 *   columns       – TanStack column defs [{ accessorKey, header, cell, ... }]
 *   data          – row data array
 *   sorting       – { key, dir } | null
 *   onSortingChange – ({ key, dir }) => void
 *   globalFilter  – string (search across all columns)
 *   loading       – boolean
 *   emptyText     – string
 *   rowClassName  – (row) => string | undefined
 *   onRowClick    – (row) => void
 *   className     – additional table class
 *   mode          – "table" | "datagrid" | "list" | "grid" | "cards" | "card" | "carousel" | "slide"
 *   onModeChange  – (mode) => void
 *   showModeSwitcher – boolean
 *   getRowId      – (row, index) => string
 *   selectedRowId – string | number
 *   mobileCard    – {
 *     getImageSrc?: (row) => string,
 *     getImageAlt?: (row) => string,
 *     getImageLabel?: (row) => string,
 *     getTitle: (row) => string,
 *     getSubtitle?: (row) => string,
 *     getAmount?: (row) => { value: string, tone?: string, subvalue?: string },
 *     getBadges?: (row) => Array<{ label: string, tone?: string }>,
 *     getRows?: (row) => Array<Array<{ value: string, tone?: string }>>,
 *     getFooterText?: (row) => string,
 *     getActions?: (row) => Array<{ label: string, onClick?: (row) => void, className?: string }>,
 *   }
 */
export default function DataTable({
  columns,
  data,
  sorting,
  onSortingChange,
  globalFilter = "",
  loading = false,
  emptyText = "No data.",
  rowClassName,
  onRowClick,
  className,
  mode = "list",
  onModeChange,
  showModeSwitcher = false,
  getRowId,
  selectedRowId = null,
  mobileCard = null,
}) {
  const isMobile = useIsMobile();
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedMode, setSelectedMode] = useState(mode || "list");
  const normalizeMode = useCallback((value) => {
    const raw = String(value || "list").trim().toLowerCase() || "list";
    if (raw === "table" || raw === "datagrid") return "list";
    if (raw === "cards") return "card";
    if (raw === "carousel") return "slide";
    return raw;
  }, []);
  const displayMode = useCallback((value) => {
    const raw = String(value || "list").trim().toLowerCase() || "list";
    if (raw === "list" || raw === "table" || raw === "datagrid") {
      return "table";
    }
    if (raw === "card" || raw === "cards") return "cards";
    if (raw === "slide" || raw === "carousel") return "carousel";
    return raw;
  }, []);

  const resolveRowId = useCallback(
    (row, index) => {
      if (typeof getRowId === "function") {
        const nextId = getRowId(row, index);
        if (nextId !== undefined && nextId !== null && String(nextId).trim()) {
          return String(nextId);
        }
      }

      if (row?.id !== undefined && row?.id !== null) return String(row.id);
      if (row?.sid !== undefined && row?.sid !== null) return String(row.sid);
      return String(index);
    },
    [getRowId],
  );
  const normalizedSelectedRowId =
    selectedRowId === undefined || selectedRowId === null
      ? ""
      : String(selectedRowId);
  const tableState = useMemo(
    () => ({
      sorting: sorting
        ? [{ id: sorting.key, desc: sorting.dir === "desc" }]
        : [],
      globalFilter,
    }),
    [sorting?.key, sorting?.dir, globalFilter],
  );

  const handleSortingChange = useCallback(
    (updater) => {
      if (!onSortingChange) return;
      const s = typeof updater === "function" ? updater([]) : updater;
      if (s.length > 0) {
        onSortingChange({ key: s[0].id, dir: s[0].desc ? "desc" : "asc" });
      } else {
        onSortingChange(null);
      }
    },
    [onSortingChange],
  );

  const table = useReactTable({
    data,
    columns,
    state: tableState,
    onSortingChange: handleSortingChange,
    getRowId: resolveRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "auto",
  });

  const rows = table.getRowModel().rows;
  const normalizedMode = normalizeMode(selectedMode);
  const requestedMode = ["list", "grid", "card", "slide"].includes(normalizedMode)
    ? normalizedMode
    : "list";
  const effectiveMode =
    isMobile && (requestedMode === "list" || requestedMode === "grid")
      ? "card"
      : requestedMode;

  useEffect(() => {
    setSelectedMode(mode || "list");
  }, [mode]);

  useEffect(() => {
    setSlideIndex((current) => {
      const maxIndex = Math.max(rows.length - 1, 0);
      return Math.min(current, maxIndex);
    });
  }, [rows.length, effectiveMode]);

  const isSelectedRow = useCallback(
    (row) => Boolean(normalizedSelectedRowId) && String(row.id) === normalizedSelectedRowId,
    [normalizedSelectedRowId],
  );

  const modeItems = useMemo(
    () => [
      { value: "table", label: "Table" },
      { value: "grid", label: "Grid" },
      { value: "cards", label: "Cards" },
      { value: "carousel", label: "Carousel" },
    ],
    [],
  );

  const handleModeSelect = useCallback(
    (nextMode) => {
      const rawMode = String(nextMode || "").toLowerCase();
      const safeMode =
        [
          "table",
          "datagrid",
          "list",
          "grid",
          "cards",
          "card",
          "carousel",
          "slide",
        ].includes(rawMode)
          ? normalizeMode(rawMode)
          : "list";
      setSelectedMode(safeMode);
      onModeChange?.(safeMode);
    },
    [normalizeMode, onModeChange],
  );

  const modeSwitcher = showModeSwitcher ? (
    <div className="data-table-header">
      <div className="data-table-header__actions">
        <ComboButtonMenu
          selectId="data-table-mode-switcher"
          value={displayMode(requestedMode)}
          buttonText={`Mode: ${modeItems.find((item) => item.value === displayMode(requestedMode))?.label || "Table"}`}
          onChange={handleModeSelect}
          items={modeItems}
          ariaLabel="Select data table mode"
          align="end"
          sideOffset={6}
          triggerClassName="data-table-mode-switcher"
        />
      </div>
    </div>
  ) : null;

  const renderCard = useCallback(
    (row, { slide = false } = {}) => {
      const original = row.original;
      const imageLabel =
        mobileCard?.getImageLabel?.(original) ||
        mobileCard?.getTitle?.(original) ||
        "";
      const amount = mobileCard?.getAmount?.(original);
      const badges = mobileCard?.getBadges?.(original) || [];
      const detailRows = mobileCard?.getRows?.(original) || [];
      const footerText = mobileCard?.getFooterText?.(original) || "";
      const actions = mobileCard?.getActions?.(original) || [];

      return (
        <div
          key={row.id}
          className={[
            "data-table-mobile-card",
            slide ? "data-table-mobile-card--slide" : "",
            isSelectedRow(row) ? "is-selected" : "",
            rowClassName ? rowClassName(original) : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={onRowClick ? () => onRowClick(original) : undefined}
          style={onRowClick ? { cursor: "pointer" } : undefined}
          role={onRowClick ? "button" : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onKeyDown={
            onRowClick
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(original);
                  }
                }
              : undefined
          }
        >
          <div className="data-table-mobile-card__head">
            <div className="data-table-mobile-card__media">
              <MobileCardThumb
                src={mobileCard?.getImageSrc?.(original) || ""}
                alt={mobileCard?.getImageAlt?.(original) || imageLabel}
                label={imageLabel}
              />
              <div className="cell-wrap data-table-mobile-card__copy ui-data-stack">
                <strong className="data-table-mobile-card__title ui-data-title">
                  {mobileCard?.getTitle?.(original)}
                </strong>
                {mobileCard?.getSubtitle?.(original) ? (
                  <span className="minor-text ui-data-meta">
                    {mobileCard.getSubtitle(original)}
                  </span>
                ) : null}
                {badges.length ? (
                  <div className="data-table-mobile-card__badges">
                    {badges.map((badge, index) => (
                      <span
                        key={`${row.id}-badge-${index}`}
                        className={[
                          "badge",
                          badge.tone ? String(badge.tone).toUpperCase() : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {amount ? (
              <div className="data-table-mobile-card__side">
                <strong
                  className={[
                    "data-table-mobile-card__amount",
                    toneClassName(amount.tone),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {amount.value}
                </strong>
                {amount.subvalue ? (
                  <span className="minor-text">{amount.subvalue}</span>
                ) : null}
              </div>
            ) : null}
          </div>

          {detailRows.length ? (
            <div className="data-table-mobile-card__rows">
              {detailRows.map((items, rowIndex) => (
                <div
                  key={`${row.id}-detail-${rowIndex}`}
                  className={[
                    "data-table-mobile-card__row",
                    items.length > 1
                      ? "data-table-mobile-card__row--split"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {items.map((item, itemIndex) => (
                    <span
                      key={`${row.id}-detail-${rowIndex}-${itemIndex}`}
                      className={[
                        "minor-text",
                        "ui-data-meta",
                        "data-table-mobile-card__value",
                        toneClassName(item.tone),
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {item.value}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {footerText || actions.length ? (
            <div className="data-table-mobile-card__footer">
              <span className="data-table-mobile-card__timestamp minor-text">
                {footerText}
              </span>
              <div className="data-table-mobile-card__actions">
                {actions.map((action, index) => (
                  <button
                    key={`${row.id}-action-${index}`}
                    type="button"
                    className={action.className || "secondary-button"}
                    onClick={(event) => {
                      event.stopPropagation();
                      action.onClick?.(original);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    },
    [isSelectedRow, mobileCard, onRowClick, rowClassName],
  );

  if (mobileCard && (effectiveMode === "card" || effectiveMode === "grid")) {
    return (
      <div className="data-table-shell">
        {modeSwitcher}
        <div
          className={[
            "data-table-mobile-list",
            "data-table-mobile-list--desktop-aware",
            effectiveMode === "grid"
              ? "data-table-mobile-list--grid"
              : "data-table-mobile-list--card",
            className || "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {loading ? (
            <div className="minor-text">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="minor-text">{emptyText}</div>
          ) : (
            rows.map((row) => renderCard(row))
          )}
        </div>
      </div>
    );
  }

  if (mobileCard && effectiveMode === "slide") {
    const currentRow = rows[slideIndex] || null;
    const canGoPrev = slideIndex > 0;
    const canGoNext = slideIndex < rows.length - 1;
    return (
      <div className={["data-table-shell", className || ""].filter(Boolean).join(" ")}>
        {modeSwitcher}
        <div className="data-table-slide-view">
          <div className="data-table-slide-nav">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSlideIndex(0)}
              disabled={!canGoPrev}
              aria-label="First item"
              title="First"
            >
              ⏮
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSlideIndex((current) => Math.max(0, current - 1))}
              disabled={!canGoPrev}
              aria-label="Previous item"
              title="Previous"
            >
              ◀
            </button>
            <div className="minor-text data-table-slide-status">
              {rows.length ? `${slideIndex + 1} / ${rows.length}` : "0 / 0"}
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setSlideIndex((current) => Math.min(rows.length - 1, current + 1))
              }
              disabled={!canGoNext}
              aria-label="Next item"
              title="Next"
            >
              ▶
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSlideIndex(Math.max(rows.length - 1, 0))}
              disabled={!canGoNext}
              aria-label="Last item"
              title="Last"
            >
              ⏭
            </button>
          </div>
          {loading ? (
            <div className="minor-text">Loading...</div>
          ) : !currentRow ? (
            <div className="minor-text">{emptyText}</div>
          ) : (
            <div className="data-table-slide-stage">
              {renderCard(currentRow, { slide: true })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="data-table-shell">
      {modeSwitcher}
      <div className="events-table-wrap">
        <table className={`table-dense ${className || ""}`}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{
                      cursor: header.column.getCanSort() ? "pointer" : "default",
                      userSelect: "none",
                      width: header.column.columnDef.size || undefined,
                      minWidth: header.column.columnDef.size || undefined,
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{
                      asc: " ▲",
                      desc: " ▼",
                    }[header.column.getIsSorted()] || null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="loading">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  {emptyText}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={[
                    isSelectedRow(row) ? "is-selected" : "",
                    rowClassName ? rowClassName(row.original) : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        width: cell.column.columnDef.size || undefined,
                        minWidth: cell.column.columnDef.size || undefined,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
