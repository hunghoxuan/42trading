import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from "@tanstack/react-table";
import { TableVirtuoso } from "react-virtuoso";

/**
 * Virtual scrolling data table. Combines TanStack Table (headless) with
 * react-virtuoso (DOM recycling). Use when rows > 500.
 *
 * Props: same as DataTable minus rowClassName/onRowClick for now.
 */
export default function VirtualTable({ columns, data, sorting, onSortingChange, loading, emptyText, className }) {
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: sorting ? [{ id: sorting.key, desc: sorting.dir === "desc" }] : [],
    },
    onSortingChange: (updater) => {
      if (!onSortingChange) return;
      const s = typeof updater === "function" ? updater([]) : updater;
      if (s.length > 0) onSortingChange({ key: s[0].id, dir: s[0].desc ? "desc" : "asc" });
      else onSortingChange(null);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  if (loading) return <div className="loading">Loading...</div>;
  if (!rows.length) return <div className="empty-state">{emptyText || "No data."}</div>;

  const headerGroup = table.getHeaderGroups()[0];

  return (
    <TableVirtuoso
      style={{ height: "calc(100vh - 200px)" }}
      totalCount={rows.length}
      fixedHeaderContent={() => (
        <tr>
          {headerGroup.headers.map((h) => (
            <th
              key={h.id}
              onClick={h.column.getToggleSortingHandler()}
              style={{ cursor: h.column.getCanSort() ? "pointer" : "default", userSelect: "none" }}
            >
              {flexRender(h.column.columnDef.header, h.getContext())}
              {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted()] || null}
            </th>
          ))}
        </tr>
      )}
      itemContent={(index) => {
        const row = rows[index];
        return row.getVisibleCells().map((cell) => (
          <td key={cell.id}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ));
      }}
      className={`table-dense ${className || ""}`}
    />
  );
}
