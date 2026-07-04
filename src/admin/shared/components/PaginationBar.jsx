import React from "react";
import InputComboSelect from "./InputComboSelect";

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
  showPageSize = true,
}) {
  const current = Math.max(1, Number(page) || 1);
  const totalPages = Math.max(1, Number(pages) || 1);
  const showNav = showControls && totalPages > 1;
  const displayLabel =
    label !== null && label !== undefined
      ? label
      : total === null || total === undefined
        ? `${current}/${totalPages}`
        : `${current}/${totalPages} (${total})`;
  return (
    <>
      {/* <!-- COMPONENT: PaginationBar --> */}
      <div
        className={className}
        style={style}
        data-component="PaginationBar"
      >
        {showNav ? (
          <>
            <button
              className="secondary-button pager-mini-button"
              type="button"
              disabled={current <= 1}
              onClick={() => onPageChange?.(Math.max(1, current - 1))}
            >
              &lt;
            </button>
            <span className="minor-text">{displayLabel}</span>
            <button
              className="secondary-button pager-mini-button"
              type="button"
              disabled={current >= totalPages}
              onClick={() => onPageChange?.(Math.min(totalPages, current + 1))}
            >
              &gt;
            </button>
          </>
        ) : null}
        {showPageSize &&
        onPageSizeChange &&
        pageSize !== null &&
        pageSize !== undefined ? (
          <InputComboSelect
            className="pager-mini-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </InputComboSelect>
        ) : null}
      </div>
      {/* <!-- /COMPONENT: PaginationBar --> */}
    </>
  );
}
