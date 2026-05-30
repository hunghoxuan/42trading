import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from "@tanstack/react-table";
import { useMemo, useCallback } from "react";

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
}) {
  const tableState = useMemo(() => ({
    sorting: sorting ? [{ id: sorting.key, desc: sorting.dir === "desc" }] : [],
    globalFilter,
  }), [sorting?.key, sorting?.dir, globalFilter]);

  const handleSortingChange = useCallback((updater) => {
    if (!onSortingChange) return;
    const s = typeof updater === "function" ? updater([]) : updater;
    if (s.length > 0) {
      onSortingChange({ key: s[0].id, dir: s[0].desc ? "desc" : "asc" });
    } else {
      onSortingChange(null);
    }
  }, [onSortingChange]);

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
                className={rowClassName ? rowClassName(row.original) : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
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
