import React from "react";

export default function PaginationBar({
  page = 1,
  pages = 1,
  total = null,
  pageSize = null,
  pageSizeOptions = [50, 100, 200],
  onPageChange,
  onPageSizeChange,
  className = "pager-mini",
  style,
  label = null,
  showControls = true,
}) {
  const current = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Number(pages) || 1);
  const displayLabel =
    label !== null && label !== undefined
      ? label
      : total === null || total === undefined
        ? `Page ${current} / ${totalPages}`
        : `Page ${current} / ${totalPages} (${total})`;
  return (
    <div className={className} style={style}>
      {showControls ? (
        <>
          <button
            className="secondary-button"
            type="button"
            disabled={current <= 1}
            onClick={() => onPageChange?.(Math.max(1, current - 1))}
          >
            &lt;
          </button>
          <span className="minor-text">{displayLabel}</span>
          <button
            className="secondary-button"
            type="button"
            disabled={current >= totalPages}
            onClick={() => onPageChange?.(Math.min(totalPages, current + 1))}
          >
            &gt;
          </button>
        </>
      ) : null}
      {onPageSizeChange && pageSize !== null && pageSize !== undefined ? (
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}/page
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
