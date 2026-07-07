import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useMemo, useCallback, useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

function getIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

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
  mobileCard = null,
}) {
  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "auto",
  });

  const rows = table.getRowModel().rows;

  if (mobileCard && isMobile) {
    return (
      <div className="data-table-mobile-list">
        {loading ? (
          <div className="minor-text">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="minor-text">{emptyText}</div>
        ) : (
          rows.map((row) => {
            const original = row.original;
            const imageLabel =
              mobileCard.getImageLabel?.(original) ||
              mobileCard.getTitle(original) ||
              "";
            const amount = mobileCard.getAmount?.(original);
            const badges = mobileCard.getBadges?.(original) || [];
            const detailRows = mobileCard.getRows?.(original) || [];
            const footerText = mobileCard.getFooterText?.(original) || "";
            const actions = mobileCard.getActions?.(original) || [];

            return (
              <div
                key={row.id}
                className={[
                  "data-table-mobile-card",
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
                      src={mobileCard.getImageSrc?.(original) || ""}
                      alt={mobileCard.getImageAlt?.(original) || imageLabel}
                      label={imageLabel}
                    />
                    <div className="cell-wrap data-table-mobile-card__copy">
                      <strong className="data-table-mobile-card__title">
                        {mobileCard.getTitle(original)}
                      </strong>
                      {mobileCard.getSubtitle?.(original) ? (
                        <span className="minor-text">
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
          })
        )}
      </div>
    );
  }

  return (
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
                className={
                  rowClassName ? rowClassName(row.original) : undefined
                }
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
  );
}
