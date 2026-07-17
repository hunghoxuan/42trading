import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import CrudContainer from "../../../shared/components/CrudContainer";
import ComboButtonMenu from "../../../shared/components/ComboButtonMenu";
import PaginationBar from "../../../shared/components/PaginationBar";
import "./SystemToolsPages.css";

const TABLE_MODE_ITEMS = [
  { value: "table", label: "Table" },
  { value: "grid", label: "Grid" },
  { value: "cards", label: "Cards" },
  { value: "carousel", label: "Carousel" },
];

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "-";
}

function buildFieldDraft(column = null) {
  if (!column) {
    return {
      columnName: "",
      nextColumnName: "",
      typeName: "TEXT",
      length: "",
      precision: "",
      scale: "",
      nullable: true,
      defaultMode: "none",
      defaultLiteral: "",
      defaultExpression: "",
      isNew: true,
    };
  }

  return {
    columnName: String(column.column_name || ""),
    nextColumnName: String(column.column_name || ""),
    typeName: String(
      column.character_maximum_length
        ? column.data_type || column.udt_name || "TEXT"
        : column.udt_name || column.data_type || "TEXT",
    ).toUpperCase(),
    length:
      column.character_maximum_length === null ||
      column.character_maximum_length === undefined
        ? ""
        : String(column.character_maximum_length),
    precision:
      column.numeric_precision === null || column.numeric_precision === undefined
        ? ""
        : String(column.numeric_precision),
    scale:
      column.numeric_scale === null || column.numeric_scale === undefined
        ? ""
        : String(column.numeric_scale),
    nullable: String(column.is_nullable || "").toUpperCase() !== "NO",
    defaultMode:
      column.column_default === null || column.column_default === undefined
        ? "none"
        : "expression",
    defaultLiteral: "",
    defaultExpression:
      column.column_default === null || column.column_default === undefined
        ? ""
        : String(column.column_default),
    isNew: false,
  };
}

export default function DbManagerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState(
    () => searchParams.get("db") || "",
  );
  const [search, setSearch] = useState("");
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [schemaRows, setSchemaRows] = useState([]);
  const [tableIndexes, setTableIndexes] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [draftValues, setDraftValues] = useState({});
  const [schemaEditorOpen, setSchemaEditorOpen] = useState(false);
  const [selectedFieldName, setSelectedFieldName] = useState("");
  const [selectedIndexName, setSelectedIndexName] = useState("");
  const [fieldDraft, setFieldDraft] = useState(null);
  const [indexDraft, setIndexDraft] = useState({
    indexName: "",
    columns: [],
    unique: false,
  });
  const [page, setPage] = useState(1);
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
  const [loadingSchemaMeta, setLoadingSchemaMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 50;
  const [detailOpen, setDetailOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  const [tableMode, setTableMode] = useState("table");
  const [viewMode, setViewMode] = useState("data");
  const routeConnectionId = String(searchParams.get("db") || "").trim();
  const routeSchema = String(searchParams.get("schema") || "").trim();
  const routeTableName = String(searchParams.get("table") || "").trim();
  const selectedConnection = useMemo(
    () =>
      connections.find(
        (connection) => String(connection.id || "").trim() === String(connectionId || "").trim(),
      ) || null,
    [connections, connectionId],
  );
  const schemaWritable = useMemo(
    () => !String(selectedConnection?.name || "").toLowerCase().startsWith("sqlite:"),
    [selectedConnection],
  );

  const primaryKey = useMemo(
    () => schemaRows.find((row) => row.is_primary_key)?.column_name || schemaRows[0]?.column_name || "id",
    [schemaRows],
  );

  const isNewRow = useMemo(
    () => selectedRow && selectedRow.__isNew === true,
    [selectedRow],
  );
  const selectedField = useMemo(
    () =>
      schemaRows.find(
        (row) => String(row.column_name || "") === String(selectedFieldName || ""),
      ) || null,
    [schemaRows, selectedFieldName],
  );
  const selectedIndex = useMemo(
    () =>
      tableIndexes.find(
        (row) => String(row.index_name || "") === String(selectedIndexName || ""),
      ) || null,
    [tableIndexes, selectedIndexName],
  );
  const schemaMode = viewMode === "schema";

  function updateRouteSelection(next = {}) {
    const params = new URLSearchParams(searchParams);
    const nextConnectionId = String(
      next.connectionId ?? connectionId ?? "",
    ).trim();
    const nextSchema = String(
      next.schema ?? selectedTable?.table_schema ?? "",
    ).trim();
    const nextTable = String(
      next.table ?? selectedTable?.table_name ?? "",
    ).trim();
    if (nextConnectionId) params.set("db", nextConnectionId);
    else params.delete("db");
    if (nextSchema) params.set("schema", nextSchema);
    else params.delete("schema");
    if (nextTable) params.set("table", nextTable);
    else params.delete("table");
    setSearchParams(params, { replace: true });
  }

  function beginSchemaEditor(column = null) {
    setSchemaEditorOpen(true);
    setSelectedIndexName("");
    const nextColumn = column || selectedField || schemaRows[0] || null;
    if (nextColumn) {
      setSelectedFieldName(String(nextColumn.column_name || ""));
      setFieldDraft(buildFieldDraft(nextColumn));
      setDetailOpen(true);
      return;
    }
    setSelectedFieldName("");
    setFieldDraft(buildFieldDraft(null));
    setDetailOpen(true);
  }

  function beginNewField() {
    setSchemaEditorOpen(true);
    setSelectedFieldName("");
    setSelectedIndexName("");
    setFieldDraft(buildFieldDraft(null));
    setDetailOpen(true);
  }

  function beginNewIndex() {
    setSchemaEditorOpen(true);
    setSelectedFieldName("");
    setSelectedIndexName("__new__");
    setFieldDraft(null);
    setIndexDraft({
      indexName: "",
      columns: [],
      unique: false,
    });
    setDetailOpen(true);
  }

  function selectSchemaField(column) {
    setSchemaEditorOpen(true);
    setSelectedRow(null);
    setDraftValues({});
    setSelectedIndexName("");
    setSelectedFieldName(String(column?.column_name || ""));
    setFieldDraft(buildFieldDraft(column));
    setDetailOpen(true);
  }

  function selectSchemaIndex(indexRow) {
    setSchemaEditorOpen(true);
    setSelectedRow(null);
    setDraftValues({});
    setSelectedFieldName("");
    setFieldDraft(null);
    setSelectedIndexName(String(indexRow?.index_name || ""));
    setIndexDraft({
      indexName: String(indexRow?.index_name || ""),
      columns: Array.isArray(indexRow?.columns) ? indexRow.columns : [],
      unique: Boolean(indexRow?.is_unique),
    });
    setDetailOpen(true);
  }

  function toggleViewMode() {
    setViewMode((current) => {
      const nextMode = current === "schema" ? "data" : "schema";
      if (nextMode === "schema") {
        setSchemaEditorOpen(true);
        setSelectedRow(null);
        setDraftValues({});
        if (schemaRows[0]) {
          setSelectedFieldName(String(schemaRows[0].column_name || ""));
          setSelectedIndexName("");
          setFieldDraft(buildFieldDraft(schemaRows[0]));
        } else {
          setSelectedFieldName("");
          setSelectedIndexName("");
          setFieldDraft(buildFieldDraft(null));
        }
      } else {
        setSchemaEditorOpen(false);
        setSelectedFieldName("");
        setSelectedIndexName("");
        setFieldDraft(null);
      }
      setDetailOpen(true);
      return nextMode;
    });
  }

  async function loadConnections() {
    try {
      setLoadingConnections(true);
      const out = await api.dbManagerConnections();
      const nextConnections = Array.isArray(out?.connections) ? out.connections : [];
      setConnections(nextConnections);
      if (!connectionId && nextConnections.length) {
        const preferredConnection =
          nextConnections.find((item) => String(item.id || "").trim() === routeConnectionId) ||
          nextConnections.find((item) => String(item.id || "").trim() === "active") ||
          nextConnections[0];
        const nextConnectionId = preferredConnection?.id || "";
        setConnectionId(nextConnectionId);
        updateRouteSelection({
          connectionId: nextConnectionId,
          schema: routeSchema,
          table: routeTableName,
        });
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
      const out = await api.dbManagerTables(connectionId, search);
      const nextTables = Array.isArray(out?.rows) ? out.rows : [];
      setTables(nextTables);
      const routeMatch =
        routeSchema && routeTableName
          ? nextTables.find(
              (item) =>
                item.table_schema === routeSchema &&
                item.table_name === routeTableName,
            )
          : null;
      const keep = selectedTable
        ? nextTables.find(
            (item) =>
              item.table_schema === selectedTable.table_schema &&
              item.table_name === selectedTable.table_name,
          )
        : null;
      const nextSelectedTable = routeMatch || keep || null;
      setSelectedTable(nextSelectedTable);
      if (!nextSelectedTable && (routeSchema || routeTableName)) {
        updateRouteSelection({ connectionId, schema: "", table: "" });
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
        q: search,
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

  async function loadSchemaMeta() {
    if (!connectionId || !selectedTable?.table_name) return;
    try {
      setLoadingSchemaMeta(true);
      const out = await api.dbManagerSchema(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
      );
      const nextSchemaRows = Array.isArray(out?.rows) ? out.rows : [];
      const nextIndexes = Array.isArray(out?.indexes) ? out.indexes : [];
      setSchemaRows(nextSchemaRows);
      setTableIndexes(nextIndexes);
      if (schemaEditorOpen) {
        if (selectedIndexName && selectedIndexName !== "__new__") {
          const keepIndex = nextIndexes.find(
            (row) => String(row.index_name || "") === String(selectedIndexName || ""),
          );
          if (!keepIndex) setSelectedIndexName("");
        } else if (selectedFieldName) {
          const keep = nextSchemaRows.find(
            (row) => String(row.column_name || "") === String(selectedFieldName || ""),
          );
          if (keep) {
            setFieldDraft(buildFieldDraft(keep));
          } else {
            beginSchemaEditor(nextSchemaRows[0] || null);
          }
        } else if (!fieldDraft?.isNew) {
          beginSchemaEditor(nextSchemaRows[0] || null);
        }
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load schema.");
    } finally {
      setLoadingSchemaMeta(false);
    }
  }

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (!routeConnectionId || routeConnectionId === connectionId) return;
    const exists = connections.some(
      (connection) => String(connection.id || "").trim() === routeConnectionId,
    );
    if (exists) {
      setConnectionId(routeConnectionId);
      setSelectedTable(null);
      setSelectedRow(null);
      setDraftValues({});
    }
  }, [routeConnectionId, connectionId, connections]);

  useEffect(() => {
    loadTables();
  }, [connectionId, search]);

  useEffect(() => {
    setPage(1);
  }, [selectedTable?.table_name, search]);

  useEffect(() => {
    loadRows();
  }, [connectionId, selectedTable?.table_name, page, search, sortCol, sortDir]);

  useEffect(() => {
    loadSchemaMeta();
  }, [connectionId, selectedTable?.table_schema, selectedTable?.table_name]);

  useEffect(() => {
    if (!connectionId) return;
    updateRouteSelection({
      connectionId,
      schema: selectedTable?.table_schema || "",
      table: selectedTable?.table_name || "",
    });
  }, [connectionId, selectedTable?.table_schema, selectedTable?.table_name]);

  function selectRow(row) {
    setSelectedRow(row);
    setDraftValues(row || {});
    setDetailOpen(true);
  }

  function selectTable(table) {
    setSelectedTable(table);
    setSelectedRow(null);
    setDraftValues({});
    if (schemaMode) {
      setSchemaEditorOpen(true);
      setSelectedFieldName("");
      setSelectedIndexName("");
      setFieldDraft(buildFieldDraft(null));
    } else {
      setSchemaEditorOpen(false);
      setSelectedFieldName("");
      setSelectedIndexName("");
      setFieldDraft(null);
    }
    setDetailOpen(true);
    updateRouteSelection({
      connectionId,
      schema: table?.table_schema || "",
      table: table?.table_name || "",
    });
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
    setViewMode("data");
    setSchemaEditorOpen(false);
    setSelectedFieldName("");
    setSelectedIndexName("");
    setFieldDraft(null);
    setSelectedRow({ __isNew: true, ...values });
    setDraftValues(values);
    setDetailOpen(true);
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

  async function saveField() {
    if (!connectionId || !selectedTable?.table_name || !fieldDraft) return;
    try {
      setSaving(true);
      const payload = fieldDraft.isNew
        ? {
            action: "add_column",
            columnName: fieldDraft.columnName,
            typeName: fieldDraft.typeName,
            length: fieldDraft.length,
            precision: fieldDraft.precision,
            scale: fieldDraft.scale,
            nullable: fieldDraft.nullable,
            defaultMode: fieldDraft.defaultMode,
            defaultLiteral: fieldDraft.defaultLiteral,
            defaultExpression: fieldDraft.defaultExpression,
          }
        : {
            action: "edit_column",
            columnName: fieldDraft.columnName,
            nextColumnName: fieldDraft.nextColumnName,
            typeName: fieldDraft.typeName,
            length: fieldDraft.length,
            precision: fieldDraft.precision,
            scale: fieldDraft.scale,
            nullable: fieldDraft.nullable,
            defaultMode: fieldDraft.defaultMode,
            defaultLiteral: fieldDraft.defaultLiteral,
            defaultExpression: fieldDraft.defaultExpression,
          };
      await api.dbManagerTableAction(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
        payload,
      );
      await loadSchemaMeta();
      await loadRows();
      setSchemaEditorOpen(true);
      setSelectedIndexName("");
      setSelectedFieldName(fieldDraft.nextColumnName || fieldDraft.columnName || "");
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to save field.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteField() {
    if (!connectionId || !selectedTable?.table_name || !selectedField) return;
    const ok = window.confirm(`Delete field ${selectedField.column_name}?`);
    if (!ok) return;
    try {
      setSaving(true);
      await api.dbManagerTableAction(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
        {
          action: "delete_columns",
          columnNames: [selectedField.column_name],
        },
      );
      setSelectedFieldName("");
      setSelectedIndexName("");
      setFieldDraft(null);
      await loadSchemaMeta();
      await loadRows();
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to delete field.");
    } finally {
      setSaving(false);
    }
  }

  async function createIndex() {
    if (!connectionId || !selectedTable?.table_name) return;
    try {
      setSaving(true);
      const nextIndexName = String(indexDraft.indexName || "").trim();
      await api.dbManagerIndexAction(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
        {
          action: "create_index",
          indexName: indexDraft.indexName,
          columns: indexDraft.columns,
          unique: indexDraft.unique,
        },
      );
      setIndexDraft({ indexName: "", columns: [], unique: false });
      await loadSchemaMeta();
      setSelectedFieldName("");
      setFieldDraft(null);
      setSelectedIndexName(nextIndexName || "");
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to create index.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteIndex(indexName) {
    if (!connectionId || !selectedTable?.table_name || !indexName) return;
    const ok = window.confirm(`Delete index ${indexName}?`);
    if (!ok) return;
    try {
      setSaving(true);
      await api.dbManagerIndexAction(
        connectionId,
        selectedTable.table_schema || "public",
        selectedTable.table_name,
        {
          action: "delete_index",
          indexName,
        },
      );
      if (String(selectedIndexName || "") === String(indexName || "")) {
        setSelectedIndexName("");
      }
      await loadSchemaMeta();
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to delete index.");
    } finally {
      setSaving(false);
    }
  }

  const rowsColumns = useMemo(
    () =>
      schemaRows.map((column) => ({
        accessorKey: column.column_name,
        header: column.column_name,
        cell: ({ row }) => formatCellValue(row.original?.[column.column_name]),
      })),
    [schemaRows],
  );

  const rowsMobileCard = useMemo(
    () => ({
      getTitle: (row) =>
        formatCellValue(
          row?.[primaryKey] ?? row?.[schemaRows[0]?.column_name || ""] ?? "Row",
        ),
      getSubtitle: () =>
        selectedTable
          ? `${selectedTable.table_schema}.${selectedTable.table_name}`
          : "",
      getRows: (row) => {
        const details = schemaRows
          .filter((column) => column.column_name !== primaryKey)
          .slice(0, 4)
          .map((column) => ({
            value: `${column.column_name}: ${formatCellValue(row?.[column.column_name]) || "-"}`,
          }));
        const rowsOut = [];
        for (let index = 0; index < details.length; index += 2) {
          rowsOut.push(details.slice(index, index + 2));
        }
        return rowsOut;
      },
    }),
    [primaryKey, schemaRows, selectedTable],
  );

  const schemaListContent = selectedTable ? (
    <div className="db-manager-schema-browser">
      <div className="db-manager-schema-browser__section">
        <div className="db-manager-schema-browser__header">
          <span className="panel-label">Fields</span>
        </div>
        <div className="db-manager-schema-list__items">
          {schemaRows.length ? (
            schemaRows.map((column) => (
              <button
                key={column.column_name}
                type="button"
                className={[
                  "db-manager-schema-item",
                  !selectedIndexName && selectedFieldName === column.column_name
                    ? "is-active"
                    : "",
                ].join(" ")}
                onClick={() => selectSchemaField(column)}
              >
                <strong>{column.column_name}</strong>
                <span>{column.data_type || column.udt_name || "TEXT"}</span>
              </button>
            ))
          ) : (
            <div className="empty-state">No fields found.</div>
          )}
        </div>
      </div>
      <div className="db-manager-schema-browser__section">
        <div className="db-manager-schema-browser__header">
          <span className="panel-label">Indexes</span>
        </div>
        <div className="db-manager-schema-list__items">
          {tableIndexes.length ? (
            tableIndexes.map((indexRow) => (
              <button
                key={indexRow.index_name}
                type="button"
                className={[
                  "db-manager-schema-item",
                  selectedIndexName === indexRow.index_name ? "is-active" : "",
                ].join(" ")}
                onClick={() => selectSchemaIndex(indexRow)}
              >
                <strong>{indexRow.index_name}</strong>
                <span>
                  {(indexRow.columns || []).join(", ")}
                  {indexRow.is_unique ? " · unique" : ""}
                  {indexRow.is_primary ? " · primary" : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="empty-state">No indexes found.</div>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="empty-state">Select a table to browse its schema.</div>
  );

  return (
    <section className="db-manager-page">
      <PageHeader title="DB Manager" />
      <AdminPageToolbar
        className="db-manager-toolbar"
        filters={
          <AdminToolbarGroup className="db-manager-toolbar__group db-manager-toolbar__group--compact">
            <button
              type="button"
              className="secondary-button icon-button"
              onClick={() => setShowSql((current) => !current)}
              aria-label={showSql ? "Hide SQL" : "Show SQL"}
              title={showSql ? "Hide SQL" : "Show SQL"}
            >
              {showSql ? "</>" : "SQL"}
            </button>
            <select
              className="text-input"
              value={connectionId}
              onChange={(event) => {
                const nextConnectionId = event.target.value;
                setConnectionId(nextConnectionId);
                setSelectedTable(null);
                setSelectedRow(null);
                setDraftValues({});
                updateRouteSelection({
                  connectionId: nextConnectionId,
                  schema: "",
                  table: "",
                });
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
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                selectedTable
                  ? "Search tables and rows..."
                  : "Search tables..."
              }
            />
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <button
              type="button"
              className="primary-button"
              onClick={openNewRow}
              disabled={!selectedTable || schemaMode}
            >
              New Row
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={toggleViewMode}
              disabled={!selectedTable}
              aria-label={schemaMode ? "Switch to data mode" : "Switch to schema mode"}
              title={schemaMode ? "Switch to data mode" : "Switch to schema mode"}
            >
              {schemaMode ? "Data" : "Schema"}
            </button>
            <button
              type="button"
              className="secondary-button icon-button"
              onClick={loadTables}
              aria-label="Refresh"
              title="Refresh"
            >
              ↻
            </button>
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

      <div className="db-manager-workspace">
        <ResponsivePanel
          title="Tables"
          showToggle={false}
          width="180px"
          className="db-manager-nav-panel"
        >
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
                    onClick={() => selectTable(table)}
                    title={`${table.table_schema}.${table.table_name}`}
                  >
                    <div className="db-manager-table-item__title">
                      {table.table_schema}.{table.table_name}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="empty-state">No tables found.</div>
            )}
          </div>
        </ResponsivePanel>

        <CrudContainer
          className="db-manager-crud"
          sameHeight={false}
          detailVisible={Boolean(selectedTable)}
          detailOpen={detailOpen}
          onDetailOpenChange={setDetailOpen}
          detailCloseButton
          list={{
            title: selectedTable
              ? schemaMode
                ? `${selectedTable.table_name} Schema`
                : `${formatCount(total)} ${selectedTable.table_name}`
              : schemaMode
                ? "Schema"
                : "Rows",
            headerActions: selectedTable ? (
              schemaMode ? (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={beginNewField}
                    disabled={!schemaWritable}
                  >
                    Add Field
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={beginNewIndex}
                    disabled={!schemaWritable}
                  >
                    Add Index
                  </button>
                </>
              ) : (
                <>
                  <PaginationBar
                    page={page}
                    pages={pages}
                    total={total}
                    showPageSize={false}
                    onPageChange={setPage}
                    label={`Page ${page} / ${pages}`}
                  />
                  <ComboButtonMenu
                    selectId="db-manager-mode"
                    value={tableMode}
                    buttonText={`Mode: ${TABLE_MODE_ITEMS.find((item) => item.value === tableMode)?.label || "Table"}`}
                    onChange={setTableMode}
                    items={TABLE_MODE_ITEMS}
                    ariaLabel="Select DB Manager list mode"
                    align="end"
                    sideOffset={6}
                    triggerClassName="data-table-mode-switcher"
                  />
                </>
              )
            ) : null,
            panelClassName: "db-manager-rows-panel",
            children: schemaMode ? schemaListContent : null,
            tableProps: schemaMode
              ? null
              : selectedTable
              ? {
                  columns: rowsColumns,
                  data: rows,
                  sorting:
                    sortCol
                      ? {
                          key: sortCol,
                          dir: String(sortDir || "DESC").toLowerCase(),
                        }
                      : null,
                  onSortingChange: (next) => {
                    if (!next?.key) return;
                    setSortCol(next.key);
                    setSortDir(String(next.dir || "asc").toUpperCase());
                  },
                  loading: loadingRows,
                  emptyText: "No rows found.",
                  className: "events-table events-table--compact db-manager-table",
                  onRowClick: selectRow,
                  mode: tableMode,
                  onModeChange: setTableMode,
                  getRowId: (row, index) =>
                    `${formatCellValue(row?.[primaryKey]) || "row"}-${index}`,
                  selectedRowId:
                    selectedRow && !isNewRow
                      ? `${formatCellValue(selectedRow?.[primaryKey]) || "row"}-${rows.findIndex(
                          (row) =>
                            formatCellValue(row?.[primaryKey]) ===
                            formatCellValue(selectedRow?.[primaryKey]),
                        )}`
                      : null,
                  mobileCard: rowsMobileCard,
                }
              : {
                  columns: [{ accessorKey: "empty", header: "Rows" }],
                  data: [],
                  emptyText: "Select a table to browse its rows.",
                  className: "events-table events-table--compact db-manager-table",
                },
          }}
          detail={{
            title: "",
            subtitle: "",
            headerActions: schemaMode
              ? selectedIndexName === "__new__"
                ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={createIndex}
                      disabled={!schemaWritable}
                    >
                      Add Index
                    </button>
                  )
                : selectedIndex && !selectedIndex.is_primary
                  ? (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => deleteIndex(selectedIndex.index_name)}
                        disabled={!schemaWritable}
                      >
                        Delete Index
                      </button>
                    )
                  : fieldDraft
                    ? (
                        <>
                          <button
                            type="button"
                            className="primary-button"
                            onClick={saveField}
                            disabled={!schemaWritable || !fieldDraft}
                          >
                            {fieldDraft?.isNew ? "Add Field" : "Save Field"}
                          </button>
                          {!fieldDraft?.isNew ? (
                            <button
                              type="button"
                              className="danger-button"
                              onClick={deleteField}
                              disabled={!schemaWritable || !selectedField}
                            >
                              Delete Field
                            </button>
                          ) : null}
                        </>
                      )
                    : null
              : selectedRow
                ? (
                    <>
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
                    </>
                  )
                : null,
            children: (
              <div className="system-tool-panel__body system-tool-panel__body--scroll">
                <div className="db-manager-detail-body">
                  {schemaMode ? (
                    <div className="db-manager-schema-editor">
                      <div className="db-manager-schema-editor__notice minor-text">
                        {schemaWritable
                          ? "Field and index changes are applied directly to the selected database."
                          : "Schema editing is view-only for SQLite connections."}
                      </div>
                      {selectedIndexName === "__new__" ? (
                        <div className="db-manager-indexes">
                          <div className="db-manager-indexes__create">
                            <input
                              type="text"
                              className="text-input"
                              placeholder="index_name"
                              value={indexDraft.indexName}
                              onChange={(event) =>
                                setIndexDraft((current) => ({
                                  ...current,
                                  indexName: event.target.value,
                                }))
                              }
                            />
                            <select
                              multiple
                              className="text-input db-manager-indexes__columns"
                              value={indexDraft.columns}
                              onChange={(event) =>
                                setIndexDraft((current) => ({
                                  ...current,
                                  columns: Array.from(event.target.selectedOptions).map(
                                    (option) => option.value,
                                  ),
                                }))
                              }
                            >
                              {schemaRows.map((column) => (
                                <option key={column.column_name} value={column.column_name}>
                                  {column.column_name}
                                </option>
                              ))}
                            </select>
                            <label className="db-manager-checkbox">
                              <input
                                type="checkbox"
                                checked={indexDraft.unique}
                                onChange={(event) =>
                                  setIndexDraft((current) => ({
                                    ...current,
                                    unique: event.target.checked,
                                  }))
                                }
                              />
                              Unique
                            </label>
                          </div>
                        </div>
                      ) : selectedIndex ? (
                        <div className="db-manager-index-detail">
                          <dl className="system-tool-kv">
                            <dt>Name</dt>
                            <dd>{selectedIndex.index_name}</dd>
                            <dt>Columns</dt>
                            <dd>{(selectedIndex.columns || []).join(", ") || "-"}</dd>
                            <dt>Unique</dt>
                            <dd>{selectedIndex.is_unique ? "Yes" : "No"}</dd>
                            <dt>Primary</dt>
                            <dd>{selectedIndex.is_primary ? "Yes" : "No"}</dd>
                          </dl>
                        </div>
                      ) : fieldDraft ? (
                        <div className="db-manager-schema-form">
                          <div className="db-manager-form__grid">
                            <div className="db-manager-form__field">
                              <label>Field Name</label>
                              <input
                                type="text"
                                className="text-input"
                                value={fieldDraft?.isNew ? fieldDraft?.columnName || "" : fieldDraft?.nextColumnName || ""}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    [current?.isNew ? "columnName" : "nextColumnName"]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="db-manager-form__field">
                              <label>Type</label>
                              <input
                                type="text"
                                className="text-input"
                                value={fieldDraft?.typeName || ""}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    typeName: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="db-manager-form__field">
                              <label>Length</label>
                              <input
                                type="text"
                                className="text-input"
                                value={fieldDraft?.length || ""}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    length: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="db-manager-form__field">
                              <label>Precision</label>
                              <input
                                type="text"
                                className="text-input"
                                value={fieldDraft?.precision || ""}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    precision: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="db-manager-form__field">
                              <label>Scale</label>
                              <input
                                type="text"
                                className="text-input"
                                value={fieldDraft?.scale || ""}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    scale: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="db-manager-form__field">
                              <label>Nullable</label>
                              <select
                                className="text-input"
                                value={fieldDraft?.nullable ? "yes" : "no"}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    nullable: event.target.value === "yes",
                                  }))
                                }
                              >
                                <option value="yes">YES</option>
                                <option value="no">NO</option>
                              </select>
                            </div>
                            <div className="db-manager-form__field">
                              <label>Default Mode</label>
                              <select
                                className="text-input"
                                value={fieldDraft?.defaultMode || "none"}
                                onChange={(event) =>
                                  setFieldDraft((current) => ({
                                    ...(current || buildFieldDraft(null)),
                                    defaultMode: event.target.value,
                                  }))
                                }
                              >
                                <option value="none">None</option>
                                <option value="expression">Expression</option>
                                <option value="literal">Literal</option>
                              </select>
                            </div>
                            {fieldDraft?.defaultMode === "expression" ? (
                              <div className="db-manager-form__field">
                                <label>Default Expression</label>
                                <input
                                  type="text"
                                  className="text-input"
                                  value={fieldDraft?.defaultExpression || ""}
                                  onChange={(event) =>
                                    setFieldDraft((current) => ({
                                      ...(current || buildFieldDraft(null)),
                                      defaultExpression: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}
                            {fieldDraft?.defaultMode === "literal" ? (
                              <div className="db-manager-form__field">
                                <label>Default Literal</label>
                                <input
                                  type="text"
                                  className="text-input"
                                  value={fieldDraft?.defaultLiteral || ""}
                                  onChange={(event) =>
                                    setFieldDraft((current) => ({
                                      ...(current || buildFieldDraft(null)),
                                      defaultLiteral: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="empty-state">
                          Select a field or index to inspect its schema detail.
                        </div>
                      )}
                    </div>
                  ) : selectedRow ? (
                    <div className="db-manager-form">
                      <div className="db-manager-form__grid">
                        {schemaRows.map((column) => (
                          <div key={column.column_name} className="db-manager-form__field">
                            <label>{column.column_name}</label>
                            <input
                              type="text"
                              className="text-input"
                              value={formatCellValue(draftValues[column.column_name])}
                              onChange={(event) =>
                                setDraftValues((current) => ({
                                  ...current,
                                  [column.column_name]: event.target.value,
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="db-manager-query-result">
                      {loadingSchemaMeta ? (
                        <div className="minor-text">Loading schema...</div>
                      ) : (
                        <pre>{JSON.stringify(schemaRows, null, 2)}</pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ),
          }}
        />
      </div>
    </section>
  );
}
