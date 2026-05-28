import { useMemo, useState } from "react";

export function useSortableTable(rows = [], options = {}) {
  const [sortKey, setSortKey] = useState(options.initialKey || "");
  const [sortDir, setSortDir] = useState(options.initialDir || "desc");
  const accessors = options.accessors || {};

  const toggleSort = (key) => {
    setSortKey((cur) => {
      if (cur === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return cur;
      }
      setSortDir(options.defaultDir || "asc");
      return key;
    });
  };

  const sortMarker = (key) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const getValue = accessors[sortKey] || ((row) => row?.[sortKey]);
    return [...rows].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
      return sortDir === "asc" ? result : -result;
    });
  }, [rows, sortKey, sortDir, accessors]);

  return { sortedRows, sortKey, sortDir, toggleSort, sortMarker };
}
