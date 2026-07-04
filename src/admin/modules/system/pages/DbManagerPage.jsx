import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import "./SystemToolsPages.css";

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "-";
}

export default function DbManagerPage() {
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [schemaRows, setSchemaRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [draftValues, setDraftValues] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortCol, setSortCol] = useState("");
  const [sortDir, setSortDir] = useState("DESC");
  const [showSql, setShowSql] = useState(false);
  const [sql, setSql] = useState("");
  const [queryResult, setQueryResult] = useState(null);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const primaryKey = useMemo(
    () => schemaRows.find((row) => row.is_primary_key)?.column_name || schemaRows[0]?.column_name || "id",
    [schemaRows],
  );

  const isNewRow = useMemo(
    () => selectedRow && selectedRow.__isNew === true,
    [selectedRow],
  );

  async function loadConnections() {
    try {
      setLoadingConnections(true);
      const out = await api.dbManagerConnections();
      const nextConnections = Array.isArray(out?.connections) ? out.connections : [];
      setConnections(nextConnections);
      if (!connectionId && nextConnections.length) {
        setConnectionId(nextConnections[0].id);
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load DB connections.");
    } finally {
      setLoadingConnections(false);
    }
  }

  async function loadTables() {
    if (!connectionId) return;
    try {
      setLoadingTables(true);
      const out = await api.dbManagerTables(connectionId, tableSearch);
      const nextTables = Array.isArray(out?.rows) ? out.rows : [];
      setTables(nextTables);
      if (selectedTable) {
        const keep = nextTables.find(
          (item) =>
            item.table_schema === selectedTable.table_schema &&
            item.table_name === selectedTable.table_name,
        );
        setSelectedTable(keep || null);
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load tables.");
    } finally {
      setLoadingTables(false);
    }
  }

  async function loadRows() {
    if (!connectionId || !selectedTable?.table_name) return;
    try {
      setLoadingRows(true);
      const out = await api.dbManagerRows(connectionId, {
        schema: selectedTable.table_schema || "public",
        table: selectedTable.table_name,
        page,
        pageSize,
        q: rowSearch,
        sortCol,
        sortDir,
      });
      setSchemaRows(Array.isArray(out?.schema) ? out.schema : []);
      setRows(Array.isArray(out?.rows) ? out.rows : []);
      setTotal(Number(out?.total || 0));
      setPages(Number(out?.pages || 1));
      setSortCol(String(out?.sortCol || sortCol || ""));
      setSortDir(String(out?.sortDir || sortDir || "DESC"));
      if (selectedRow && !selectedRow.__isNew) {
        const nextSelected = (out?.rows || []).find(
          (row) => formatCellValue(row[primaryKey]) === formatCellValue(selectedRow[primaryKey]),
        );
        setSelectedRow(nextSelected || null);
        setDraftValues(nextSelected || {});
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load rows.");
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    loadTables();
  }, [connectionId, tableSearch]);

  useEffect(() => {
    setPage(1);
  }, [selectedTable?.table_name, rowSearch, pageSize]);

  useEffect(() => {
    loadRows();
  }, [connectionId, selectedTable?.table_name, page, pageSize, rowSearch, sortCol, sortDir]);

  function selectRow(row) {
    setSelectedRow(row);
    setDraftValues(row || {});
  }

  function handleSort(columnName) {
    if (sortCol === columnName) {
      setSortDir((current) => (current === "ASC" ? "DESC" : "ASC"));
      return;
    }
    setSortCol(columnName);
    setSortDir("ASC");
  }

  function openNewRow() {
    const values = {};
    schemaRows.forEach((column) => {
      values[column.column_name] = "";
    });
    setSelectedRow({ __isNew: true, ...values });
    setDraftValues(values);
  }

  function cloneRow() {
    if (!selectedRow) return;
    const nextValues = { ...draftValues, [primaryKey]: "" };
    setSelectedRow({ __isNew: true, ...nextValues });
    setDraftValues(nextValues);
  }

  async function saveRow() {
    if (!connectionId || !selectedTable?.table_name) return;
    try {
      setSaving(true);
      if (isNewRow) {
        await api.dbManagerInsertRow(
          connectionId,
          selectedTable.table_schema || "public",
          selectedTable.table_name,
          draftValues,
        );
      } else {
        await api.dbManagerUpdateRow(
          connectionId,
          selectedTable.table_schema || "public",
          selectedTable.table_name,
          {
            pkCol: primaryKey,
            pkVal: selectedRow?.[primaryKey],
            values: draftValues,
          },
        );
      }
      setError("");
      await loadRows();
    } catch (err) {
      setError(err?.message || "Failed to save row.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow() {
    if (!connectionId || !selectedTable?.table_name || !selectedRow || isNewRow) return;
    const ok = window.confirm("Delete the selected row?");
    if (!ok) return;
    try {
      setSaving(true);
      await api.dbManagerDeleteRow(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
        {
          pkCol: primaryKey,
          pkVal: selectedRow?.[primaryKey],
        },
      );
      setSelectedRow(null);
      setDraftValues({});
      setError("");
      await loadRows();
    } catch (err) {
      setError(err?.message || "Failed to delete row.");
    } finally {
      setSaving(false);
    }
  }

  async function runQuery() {
    if (!connectionId || !sql.trim()) return;
    try {
      const out = await api.dbManagerQuery(connectionId, sql);
      setQueryResult(out);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to run SQL.");
    }
  }

  return (
    <section className="db-manager-page">
      <PageHeader title="DB Manager" />
      <AdminPageToolbar
        className="db-manager-toolbar"
        filters={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <select
              className="text-input"
              value={connectionId}
              onChange={(event) => {
                setConnectionId(event.target.value);
                setSelectedTable(null);
                setSelectedRow(null);
                setDraftValues({});
              }}
            >
              <option value="">
                {loadingConnections ? "Loading connections..." : "Select connection"}
              </option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="Search tables..."
            />
            <input
              className="text-input"
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
              placeholder="Search rows..."
              disabled={!selectedTable}
            />
            <select
              className="text-input"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value) || 50)}
            >
              {[25, 50, 100, 200].map((value) => (
                <option key={value} value={value}>
                  {value} / page
                </option>
              ))}
            </select>
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <button type="button" className="secondary-button" onClick={loadTables}>
              Refresh
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowSql((current) => !current)}
            >
              {showSql ? "Hide SQL" : "Show SQL"}
            </button>
            <span className="minor-text">
              {selectedTable ? `${formatCount(total)} rows` : "Choose a table"}
            </span>
          </AdminToolbarGroup>
        }
      />

      {error ? (
        <div className="panel card-flat" style={{ padding: 12 }}>
          <span className="msg-error">{error}</span>
        </div>
      ) : null}

      {showSql ? (
        <ResponsivePanel title="SQL Console" showToggle={false}>
          <div className="db-manager-query-box">
            <textarea
              className="text-input"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder="SELECT * FROM public.users LIMIT 50;"
            />
            <div className="db-manager-toolbar__group">
              <button type="button" className="primary-button" onClick={runQuery}>
                Run Query
              </button>
            </div>
            {queryResult ? (
              <div className="db-manager-query-result">
                <div className="minor-text">
                  {queryResult.command || "QUERY"} · {formatCount(queryResult.rowCount)} rows
                </div>
                <pre>{JSON.stringify(queryResult.rows || [], null, 2)}</pre>
              </div>
            ) : null}
          </div>
        </ResponsivePanel>
      ) : null}

      <div
        className={[
          "db-manager-grid",
          selectedTable ? "" : "db-manager-grid--detail-closed",
        ].join(" ")}
      >
        <ResponsivePanel title="Tables" showToggle={false}>
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            <div className="db-manager-sidebar-list">
              {loadingTables ? (
                <div className="minor-text">Loading tables...</div>
              ) : tables.length ? (
                tables.map((table) => {
                  const key = `${table.table_schema}.${table.table_name}`;
                  const active =
                    selectedTable?.table_schema === table.table_schema &&
                    selectedTable?.table_name === table.table_name;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={[
                        "db-manager-table-item",
                        active ? "is-active" : "",
                      ].join(" ")}
                      onClick={() => {
                        setSelectedTable(table);
                        setSelectedRow(null);
                        setDraftValues({});
                      }}
                    >
                      <div className="db-manager-table-item__title">
                        {table.table_schema}.{table.table_name}
                      </div>
                      <div className="db-manager-table-item__meta">
                        <span>{table.table_type || "TABLE"}</span>
                        <span>{formatCount(table.row_estimate)}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="empty-state">No tables found.</div>
              )}
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel title="Rows" showToggle={false}>
          <div className="system-tool-panel__body">
            {selectedTable ? (
              <>
                <div className="db-manager-toolbar__group" style={{ marginBottom: 12 }}>
                  <button type="button" className="primary-button" onClick={openNewRow}>
                    New Row
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                  >
                    Prev
                  </button>
                  <span className="minor-text">
                    Page {page} / {pages}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPage((current) => Math.min(pages, current + 1))}
                    disabled={page >= pages}
                  >
                    Next
                  </button>
                </div>
                <div className="db-manager-data-wrap">
                  <table className="table-dense">
                    <thead>
                      <tr>
                        {schemaRows.map((column) => (
                          <th
                            key={column.column_name}
                            onClick={() => handleSort(column.column_name)}
                          >
                            {column.column_name}
                            {sortCol === column.column_name
                              ? sortDir === "ASC"
                                ? " ▲"
                                : " ▼"
                              : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loadingRows ? (
                        <tr>
                          <td colSpan={Math.max(1, schemaRows.length)} className="loading">
                            Loading rows...
                          </td>
                        </tr>
                      ) : rows.length ? (
                        rows.map((row, index) => (
                          <tr
                            key={`${formatCellValue(row[primaryKey])}-${index}`}
                            onClick={() => selectRow(row)}
                            style={{ cursor: "pointer" }}
                          >
                            {schemaRows.map((column) => (
                              <td key={column.column_name} className="db-manager-cell">
                                {formatCellValue(row[column.column_name])}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={Math.max(1, schemaRows.length)} className="empty-state">
                            No rows found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state">Select a table to browse its rows.</div>
            )}
          </div>
        </ResponsivePanel>

        {selectedTable ? (
          <ResponsivePanel
            title={selectedRow ? (isNewRow ? "New Row" : "Row Detail") : "Schema"}
            showToggle={false}
          >
            <div className="system-tool-panel__body system-tool-panel__body--scroll">
              {selectedRow ? (
                <div className="db-manager-form">
                  <div className="db-manager-form__grid">
                    {schemaRows.map((column) => (
                      <div key={column.column_name} className="db-manager-form__field">
                        <label>{column.column_name}</label>
                        <textarea
                          className="text-input"
                          value={formatCellValue(draftValues[column.column_name])}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              [column.column_name]: event.target.value,
                            }))
                          }
                          rows={column.data_type === "json" ? 6 : 3}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="db-manager-form__actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveRow}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button type="button" className="secondary-button" onClick={cloneRow}>
                      Clone
                    </button>
                    {!isNewRow ? (
                      <button type="button" className="danger-button" onClick={deleteRow}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="db-manager-query-result">
                  <pre>{JSON.stringify(schemaRows, null, 2)}</pre>
                </div>
              )}
            </div>
          </ResponsivePanel>
        ) : null}
      </div>
    </section>
  );
}
