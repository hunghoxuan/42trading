import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api";

import { showDateTime } from "../../utils/format";
import PaginationBar from "../../components/PaginationBar";
import SearchFilterBar from "../../components/SearchFilterBar";
import DataTable from "../../components/DataTable";
import MobileCollapseSection from "../../components/MobileCollapseSection";

// Columns hidden in COMPACT preset (verbose/metadata/raw/internal)
const COMPACT_HIDE = [
  "metadata",
  "raw_json",
  "password_hash",
  "password_salt",
  "api_key_hash",
  "api_key_last4",
  "api_key_rotated_at",
  "lease_token",
  "lease_expires_at",
  "rejection_reason",
  "source_ids_cache",
];

function statusUi(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  if (s === "ACTIVE" || s === "TRUE" || s === "SUCCESS" || s === "OK")
    return { cls: "TP", label: s };
  if (s === "INACTIVE" || s === "FALSE" || s === "DISABLE" || s === "DISABLED")
    return { cls: "INACTIVE", label: s };
  if (s === "PLACED" || s === "OPEN") return { cls: "PLACED", label: s };
  if (s === "LOCKED") return { cls: "LOCKED", label: s };
  if (s === "START") return { cls: "START", label: s };
  if (s === "TP" || s === "WON" || s === "WIN") return { cls: "TP", label: s };
  if (
    s === "SL" ||
    s === "FAILED" ||
    s === "ERROR" ||
    s === "REJECTED" ||
    s === "LOSS"
  )
    return { cls: "SL", label: s };
  return { cls: "OTHER", label: s || "-" };
}

function isNumericType(type = "") {
  return (
    type.includes("int") ||
    type.includes("double") ||
    type.includes("float") ||
    type.includes("numeric") ||
    type.includes("decimal") ||
    type.includes("real")
  );
}

function normalizeFieldValue(col, rawValue) {
  if (typeof rawValue !== "string") return rawValue;
  const type = String(col.data_type || "").toLowerCase();
  const trimmed = rawValue.trim();

  if (trimmed === "") {
    return col.is_nullable === "YES" ? null : rawValue;
  }

  if (type.includes("json")) {
    return JSON.parse(rawValue);
  }

  if (isNumericType(type)) {
    return Number(rawValue);
  }

  if (type === "boolean") {
    return trimmed.toLowerCase() === "true";
  }

  return rawValue;
}

function DynamicForm({
  schema,
  onSubmit,
  onCancel,
  busy,
  initialData,
  mode = "create",
}) {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (initialData) {
      setFormData({ ...initialData });
    } else {
      const initial = {};
      schema.forEach((col) => {
        if (col.column_default && !col.column_default.includes("nextval")) {
          let def = col.column_default.replace(/'/g, "").split("::")[0];
          initial[col.column_name] = def;
        }
      });
      setFormData(initial);
    }
  }, [schema, initialData]);

  const handleChange = (name, val) => {
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const final = { ...formData };
    schema.forEach((col) => {
      if (typeof final[col.column_name] === "string") {
        try {
          final[col.column_name] = normalizeFieldValue(
            col,
            final[col.column_name],
          );
        } catch (e) {}
      }
    });
    onSubmit(final);
  };

  return (
    <form onSubmit={handleSubmit} className="stack-layout" style={{ gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {schema.map((col) => {
          const isRequired = col.is_nullable === "NO" && !col.column_default;
          const type = col.data_type.toLowerCase();
          const isFullWidth =
            type.includes("json") || col.column_name === "note";

          return (
            <label
              key={col.column_name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                gridColumn: isFullWidth ? "span 2" : "auto",
              }}
            >
              <span
                className="minor-text"
                style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)" }}
              >
                {col.column_name.toUpperCase()}{" "}
                {isRequired && <span style={{ color: "#ef4444" }}>*</span>}
                <span style={{ marginLeft: 8, opacity: 0.5, fontWeight: 400 }}>
                  {col.data_type}
                </span>
              </span>

              {type.includes("json") ? (
                <textarea
                  className="snapshot-mono"
                  value={
                    typeof formData[col.column_name] === "object"
                      ? JSON.stringify(formData[col.column_name], null, 2)
                      : formData[col.column_name] || ""
                  }
                  onChange={(e) =>
                    handleChange(col.column_name, e.target.value)
                  }
                  rows={4}
                  style={{ fontSize: "11px" }}
                />
              ) : (
                <input
                  type={
                    type === "boolean"
                      ? "text"
                      : isNumericType(type)
                        ? "number"
                        : "text"
                  }
                  step="any"
                  value={formData[col.column_name] || ""}
                  onChange={(e) =>
                    handleChange(col.column_name, e.target.value)
                  }
                  placeholder={col.column_default || ""}
                  required={isRequired}
                />
              )}
            </label>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 10,
          borderTop: "1px solid var(--border)",
          paddingTop: 16,
        }}
      >
        <button
          type="submit"
          className="primary-button"
          style={{ minWidth: 120 }}
          disabled={busy}
        >
          {busy
            ? "SAVING..."
            : mode === "edit"
              ? "💾 EDIT RECORD"
              : "💾 CREATE RECORD"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={busy}
        >
          ✖ CANCEL
        </button>
      </div>
    </form>
  );
}

export default function DatabasePage() {
  const { tableName } = useParams();
  const navigate = useNavigate();
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(tableName || "trades");
  const [rows, setRows] = useState([]);
  const [schema, setSchema] = useState([]);
  const [showSchema, setShowSchema] = useState(false);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [createRowJson, setCreateRowJson] = useState(
    '{\n  "action": "BUY",\n  "symbol": "XAUUSD",\n  "volume": 0.01\n}',
  );
  const [editMode, setEditMode] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [sorting, setSorting] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const inFlightRef = useRef(false);

  const sortCol = sorting?.key || "";
  const sortDir = (sorting?.dir || "desc").toUpperCase();

  const [filter, setFilter] = useState({
    q: "",
    page: 1,
    pageSize: 50,
  });

  const query = useMemo(
    () => ({ table: selectedTable, ...filter, sortCol, sortDir }),
    [selectedTable, filter, sortCol, sortDir],
  );

  async function loadTables() {
    try {
      const data = await api.dbTables();
      setTables(data.tables || []);
    } catch (e) {
      console.error("Failed to load tables:", e);
    }
  }

  async function loadRows() {
    if (!selectedTable) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setLoading(true);
      const [data, schemaData] = await Promise.all([
        api.dbRows(query),
        api.dbSchema(query.table).catch(() => ({ schema: [] })),
      ]);
      setSchema(schemaData.schema || []);
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setError("");
    } catch (e) {
      setError(e?.message || "Failed to load database data");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (tableName && tableName !== selectedTable) {
      setSelectedTable(tableName);
      setFilter((prev) => ({ ...prev, page: 1 }));
      setSelectedRow(null);
      setCreateMode(false);
    }
  }, [tableName]);

  useEffect(() => {
    loadTables();
  }, []);
  useEffect(() => {
    loadRows();
  }, [query]);

  const handleSearchChange = (e) => {
    setFilter((prev) => ({ ...prev, q: e.target.value, page: 1 }));
  };

  const handleTableChange = (e) => {
    setSelectedTable(e.target.value);
    setFilter((prev) => ({ ...prev, page: 1 }));
    setSelectedRow(null);
    setCreateMode(false);
  };

  const handlePageChange = (p) => {
    setFilter((prev) => ({ ...prev, page: p }));
  };

  async function onCreateRow(formData) {
    try {
      setCreateBusy(true);
      await api.dbCreateRow({ table: selectedTable, row: formData });
      setCreateMsg("Record successfully committed to institutional ledger.");
      setCreateMode(false);
      await loadRows();
    } catch (e) {
      setError(e?.message || "Failed to create row");
    } finally {
      setCreateBusy(false);
      window.setTimeout(() => setCreateMsg(""), 3000);
    }
  }

  async function onEditRow(formData) {
    try {
      setEditBusy(true);
      await api.dbUpdateRow({ table: selectedTable, row: formData });
      setCreateMsg("Record updated.");
      setEditMode(false);
      setSelectedRow(formData);
      await loadRows();
    } catch (e) {
      setError(e?.message || "Failed to update row");
    } finally {
      setEditBusy(false);
      window.setTimeout(() => setCreateMsg(""), 3000);
    }
  }

  function toggleColVisibility(colName) {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  }

  const tableHeaders = useMemo(() => {
    if (schema && schema.length > 0) {
      return schema.map((c) => c.column_name).filter((c) => !hiddenCols.has(c));
    }
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows, schema, hiddenCols]);

  const allSchemaCols = useMemo(() => {
    if (schema && schema.length > 0) return schema.map((c) => c.column_name);
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows, schema]);

  const columns = useMemo(() => {
    return tableHeaders.map((h) => ({
      accessorKey: h,
      header: () => h.replace(/_/g, " ").toUpperCase(),
      cell: ({ getValue }) => {
        const val = getValue();
        const isDate =
          h.includes("_at") || h === "tick_time" || h === "event_time";
        const isStatus = h === "status" || h === "ack_status";

        if (isStatus) {
          const ui = statusUi(val);
          return <span className={`badge ${ui.cls}`}>{ui.label}</span>;
        }

        return (
          <div className="cell-wrap">
            <div className="minor-text">
              {isDate
                ? showDateTime(val)
                : String(val ?? "-").slice(0, 50)}
            </div>
          </div>
        );
      },
    }));
  }, [tableHeaders]);

  return (
    <div className="stack-layout fadeIn">
      <h2 className="page-title">DB</h2>
      <div className="toolbar-panel">
        <div className="toolbar-group toolbar-pagination">
          <PaginationBar
            page={filter.page}
            pages={pages}
            label={`${filter.page}/${pages}`}
            onPageChange={handlePageChange}
          />
          <div className="minor-text" style={{ marginLeft: "10px" }}>
            TOTAL: {total}
          </div>

          <PaginationBar
            page={1}
            pages={1}
            pageSize={filter.pageSize}
            pageSizeOptions={[50, 100, 200]}
            showControls={false}
            onPageSizeChange={(pageSize) =>
              setFilter((f) => ({
                ...f,
                pageSize,
                page: 1,
              }))
            }
            style={{ display: "contents" }}
          />
        </div>

        <MobileCollapseSection title="Filters" className="toolbar-search-filter">
          <SearchFilterBar
            search={{
              placeholder: "SEARCH RECORDS...",
              value: filter.q,
              onChange: (value) => handleSearchChange({ target: { value } }),
              style: { width: "180px" },
            }}
            filters={[
              {
                key: "table",
                value: selectedTable,
                onChange: (value) => handleTableChange({ target: { value } }),
                style: { minWidth: "140px" },
                options: tables.map((table) => ({
                  value: table,
                  label: table.toUpperCase(),
                })),
              },
            ]}
          />
          <div className="toolbar-group toolbar-bulk-action">
            <select disabled={loading}>
              <option value="">BULK ACTION...</option>
              <option value="export">DOWNLOAD CSV</option>
              <option value="delete">DELETE ALL</option>
            </select>
            <button
              type="button"
              className="primary-button"
              onClick={() => alert("Action triggered")}
              disabled={loading}
            >
              APPLY
            </button>
          </div>
        </MobileCollapseSection>

        <button
          type="button"
          className="secondary-button"
          onClick={() => setShowSchema(!showSchema)}
        >
          {showSchema ? "HIDE SCHEMA" : "SHOW SCHEMA"}
        </button>
      </div>

      <div className="logs-layout-split">
        <div className="logs-list-pane">
          {error && <div className="error">{error}</div>}
          {createMsg ? (
            <div className="loading" style={{ padding: 10 }}>
              {createMsg}
            </div>
          ) : null}
          {showSchema && schema.length > 0 && (
            <div className="panel" style={{ margin: "10px", padding: "10px" }}>
              <div className="panel-label">TABLE SCHEMA: {selectedTable}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  className="secondary-button"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  onClick={() => {
                    const compact = new Set(
                      allSchemaCols.filter(
                        (c) =>
                          !COMPACT_HIDE.includes(c) && !c.startsWith("broker_"),
                      ),
                    );
                    setHiddenCols(
                      new Set(allSchemaCols.filter((c) => !compact.has(c))),
                    );
                  }}
                >
                  COMPACT
                </button>
                <button
                  className="secondary-button"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  onClick={() => setHiddenCols(new Set())}
                >
                  ALL
                </button>
                <button
                  className="secondary-button"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  onClick={() => setHiddenCols(new Set(allSchemaCols))}
                >
                  NONE
                </button>
              </div>
              <table
                className="events-table"
                style={{ width: "100%", fontSize: "12px" }}
              >
                <thead>
                  <tr>
                    <th>COLUMN_NAME</th>
                    <th>DATA_TYPE</th>
                    <th>NULLABLE</th>
                    <th>DEFAULT</th>
                    <th style={{ width: 50, textAlign: "center" }}>SHOW</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.map((c) => (
                    <tr key={c.column_name}>
                      <td>{c.column_name}</td>
                      <td>
                        <span className="badge START">
                          {c.data_type}{" "}
                          {c.character_maximum_length
                            ? `(${c.character_maximum_length})`
                            : ""}
                        </span>
                      </td>
                      <td>{c.is_nullable}</td>
                      <td>{c.column_default || "-"}</td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(c.column_name)}
                          onChange={() => toggleColVisibility(c.column_name)}
                          style={{ width: 14, height: 14, cursor: "pointer" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DataTable
            columns={columns}
            data={rows}
            sorting={sorting}
            onSortingChange={setSorting}
            loading={loading}
            emptyText="No records found"
            rowClassName={(row) => (selectedRow === row ? "active" : "")}
            onRowClick={(row) => {
              setCreateMode(false);
              setEditMode(false);
              setSelectedRow(row);
              navigate(`/system/db/${selectedTable}`);
            }}
          />
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (createMode) {
                  setCreateMode(false);
                } else {
                  setCreateMode(true);
                  setEditMode(false);
                  setSelectedRow(null);
                }
              }}
            >
              {createMode ? "CANCEL" : "CREATE ROW"}
            </button>
          </div>
        </div>

        <div className="logs-detail-pane" style={{ padding: "0" }}>
          {createMode ? (
            <div
              className="panel"
              style={{ margin: 12, border: "none", background: "transparent" }}
            >
              <div className="panel-label">
                CREATE NEW {selectedTable.toUpperCase()} RECORD
              </div>
              <DynamicForm
                schema={schema}
                busy={createBusy}
                onSubmit={onCreateRow}
                onCancel={() => setCreateMode(false)}
              />
            </div>
          ) : selectedRow && !editMode ? (
            <div
              className="trade-detail-content scrollable fadeIn"
              style={{ padding: 20 }}
            >
              <div
                className="detail-header"
                style={{
                  marginBottom: "20px",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>
                    TELEMETRY INSPECTION
                  </h2>
                  <div
                    className="minor-text"
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {selectedTable} ID:{" "}
                    {selectedRow.id ||
                      selectedRow.sid ||
                      selectedRow.sid ||
                      selectedRow.user_id ||
                      "-"}
                  </div>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setEditMode(true)}
                  style={{ minWidth: 80 }}
                >
                  ✏️ EDIT
                </button>
              </div>
              <div
                className="detail-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: "12px",
                }}
              >
                {Object.entries(selectedRow).map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "140px 1fr",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <div
                      className="minor-text"
                      style={{
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        fontWeight: 800,
                        fontSize: 9,
                      }}
                    >
                      {k.replace(/_/g, " ")}
                    </div>
                    <div
                      className="cell-major"
                      style={{
                        wordBreak: "break-all",
                        whiteSpace: "pre-wrap",
                        fontSize: 12,
                      }}
                    >
                      {typeof v === "object" ? (
                        <pre
                          className="snapshot-mono"
                          style={{
                            margin: 0,
                            padding: 8,
                            background: "var(--bg)",
                            borderRadius: 6,
                            fontSize: 11,
                          }}
                        >
                          {JSON.stringify(v, null, 2)}
                        </pre>
                      ) : (
                        String(v ?? "-")
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : editMode && selectedRow ? (
            <div
              className="panel"
              style={{ margin: 12, border: "none", background: "transparent" }}
            >
              <div className="panel-label">
                EDIT {selectedTable.toUpperCase()} RECORD
              </div>
              <DynamicForm
                schema={schema}
                busy={editBusy}
                initialData={selectedRow}
                mode="edit"
                onSubmit={onEditRow}
                onCancel={() => setEditMode(false)}
              />
            </div>
          ) : (
            <div
              className="empty-state minor-text"
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              SELECT A RECORD TO INSPECT INSTITUTIONAL TELEMETRY
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
