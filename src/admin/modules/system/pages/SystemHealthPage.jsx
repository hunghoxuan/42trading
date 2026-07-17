import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import CrudContainer from "../../../shared/components/CrudContainer";
import SmartContent from "../../../shared/components/SmartContent.jsx";
import { StatusDisplay } from "../../../shared/components/StatusBadge";
import "./SystemToolsPages.css";

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(size) / Math.log(1024)),
  );
  const amount = size / Math.pow(1024, index);
  return `${amount.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function defaultNode(index = 1) {
  return {
    id: `health-node-${index}`,
    label: `Health Node ${index}`,
    url: "http://127.0.0.1:3001/health",
    port: 3001,
    type: "api",
    timeout_ms: 2000,
    output_format: {
      mode: "json_path_equals",
      path: "ok",
      equals: true,
      includes: "",
    },
  };
}

function cloneNode(node = {}) {
  return {
    ...defaultNode(),
    ...node,
    output_format: {
      ...defaultNode().output_format,
      ...(node?.output_format || {}),
    },
  };
}

function parseLiteralValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && String(asNumber) === raw) return asNumber;
  return raw;
}

function buildNodePayload(draft = {}) {
  const node = cloneNode(draft);
  return {
    id: String(node.id || "").trim(),
    label: String(node.label || "").trim(),
    url: String(node.url || "").trim(),
    port: Number(node.port || 0) || 0,
    type: String(node.type || "api").trim().toLowerCase(),
    timeout_ms: Math.max(100, Number(node.timeout_ms || 1500) || 1500),
    output_format: {
      mode: String(node.output_format?.mode || "http_status")
        .trim()
        .toLowerCase(),
      path: String(node.output_format?.path || "").trim(),
      includes: String(node.output_format?.includes || "").trim(),
      equals: parseLiteralValue(node.output_format?.equals ?? ""),
    },
  };
}

function resultTone(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "ok" || normalized === "active") return "active";
  if (normalized === "warning" || normalized === "warn") return "warning";
  return "error";
}

export default function SystemHealthPage() {
  const [nodes, setNodes] = useState([]);
  const [results, setResults] = useState([]);
  const [storage, setStorage] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [draft, setDraft] = useState(defaultNode());
  const [detailOpen, setDetailOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const resultMap = useMemo(
    () => new Map(results.map((item) => [String(item.id || ""), item])),
    [results],
  );

  const filteredNodes = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((node) =>
      [
        node.label,
        node.id,
        node.type,
        node.url,
        JSON.stringify(node.output_format || {}),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [nodes, query]);

  const selectedNode = useMemo(
    () => nodes.find((node) => String(node.id || "") === String(selectedNodeId || "")) || null,
    [nodes, selectedNodeId],
  );

  const selectedResult = useMemo(
    () => resultMap.get(String(selectedNodeId || "")) || null,
    [resultMap, selectedNodeId],
  );

  const columns = useMemo(
    () => [
      {
        accessorKey: "label",
        header: "Node",
        cell: ({ row }) => (
          <div className="system-tool-table__primary">
            <div className="system-tool-table__title">
              {row.original?.label || "-"}
            </div>
            <div className="system-tool-table__subtle">
              {row.original?.url || row.original?.id || "-"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => String(row.original?.type || "-").toUpperCase(),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const result = resultMap.get(String(row.original?.id || ""));
          return (
            <StatusDisplay
              status={resultTone(result?.status || "error")}
              label={String(result?.status || "unknown").toUpperCase()}
            />
          );
        },
      },
      {
        accessorKey: "port",
        header: "Port",
        cell: ({ row }) => (row.original?.port ? `:${row.original.port}` : "-"),
      },
    ],
    [resultMap],
  );

  async function loadData() {
    try {
      setLoading(true);
      const out = await api.systemHealthNodes();
      const nextNodes = Array.isArray(out?.nodes) ? out.nodes.map(cloneNode) : [];
      setNodes(nextNodes);
      setResults(Array.isArray(out?.results) ? out.results : []);
      setStorage(out?.storage || null);
      setSelectedNodeId((current) => {
        if (current && nextNodes.some((node) => node.id === current)) return current;
        return nextNodes[0]?.id || "";
      });
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load health data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedNode) {
      setDraft(cloneNode(selectedNode));
      setDetailOpen(true);
    }
  }, [selectedNode?.id]);

  function updateDraft(patch = {}) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateOutputFormat(patch = {}) {
    setDraft((current) => ({
      ...current,
      output_format: {
        ...(current.output_format || {}),
        ...patch,
      },
    }));
  }

  function handleNewNode() {
    const next = defaultNode(nodes.length + 1);
    let suffix = nodes.length + 1;
    while (nodes.some((node) => node.id === next.id)) {
      suffix += 1;
      next.id = `health-node-${suffix}`;
      next.label = `Health Node ${suffix}`;
    }
    const nextNodes = [...nodes, next];
    setNodes(nextNodes);
    setSelectedNodeId(next.id);
    setDraft(cloneNode(next));
    setDetailOpen(true);
  }

  async function handleSave() {
    const payload = buildNodePayload(draft);
    if (!payload.id || !payload.label) {
      setError("Node id and label are required.");
      return;
    }
    try {
      setSaving(true);
      const currentId = String(selectedNode?.id || "").trim();
      const nextNodes = nodes.some((node) => node.id === payload.id)
        ? nodes.map((node) => (node.id === payload.id ? payload : node))
        : currentId
          ? nodes.map((node) => (node.id === currentId ? payload : node))
          : [...nodes, payload];
      const out = await api.saveSystemHealthNodes(nextNodes);
      const savedNodes = Array.isArray(out?.nodes) ? out.nodes.map(cloneNode) : nextNodes;
      setNodes(savedNodes);
      setSelectedNodeId(payload.id);
      setError("");
      await loadData();
    } catch (err) {
      setError(err?.message || "Failed to save health node.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedNode) return;
    const ok = window.confirm(`Delete health node ${selectedNode.label}?`);
    if (!ok) return;
    try {
      setSaving(true);
      const nextNodes = nodes.filter((node) => node.id !== selectedNode.id);
      await api.saveSystemHealthNodes(nextNodes);
      setNodes(nextNodes);
      setSelectedNodeId(nextNodes[0]?.id || "");
      setError("");
      await loadData();
    } catch (err) {
      setError(err?.message || "Failed to delete health node.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="system-tool-page">
      <PageHeader title="System Health" />
      <AdminPageToolbar
        className="db-manager-toolbar"
        filters={
          <AdminToolbarGroup className="db-manager-toolbar__group db-manager-toolbar__group--compact">
            <input
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search node, type, url..."
            />
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <button
              type="button"
              className="secondary-button"
              onClick={handleNewNode}
            >
              New Node
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={loadData}
            >
              Refresh
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleSave}
              disabled={saving}
            >
              Save
            </button>
          </AdminToolbarGroup>
        }
      />

      {error ? (
        <div className="panel card-flat" style={{ padding: 12 }}>
          <span className="msg-error">{error}</span>
        </div>
      ) : null}

      <CrudContainer
        className="db-manager-crud system-tool-browser-crud"
        sameHeight={false}
        detailVisible={Boolean(selectedNodeId)}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        detailCloseButton
        list={{
          title: "Health Nodes",
          panelClassName: "db-manager-rows-panel system-tool-main",
          tableProps: {
            columns,
            data: filteredNodes,
            loading,
            emptyText: "No health nodes configured.",
            className: "events-table events-table--compact system-tool-browser-table",
            onRowClick: (item) => setSelectedNodeId(item.id),
            getRowId: (item) => item?.id || "",
            selectedRowId: selectedNodeId || null,
          },
        }}
        detail={{
          title: draft?.label || "Health Node",
          subtitle: draft?.type ? `${String(draft.type).toUpperCase()} node` : "",
          headerActions: selectedNode ? (
            <button
              type="button"
              className="danger-button"
              onClick={handleDelete}
              disabled={saving}
            >
              Delete Node
            </button>
          ) : null,
          panelClassName: "system-tool-detail",
          children: selectedNodeId ? (
            <div className="system-tool-panel__body system-tool-panel__body--scroll">
              <div className="system-tool-detail__content">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Label</span>
                    <input
                      className="text-input"
                      value={draft.label || ""}
                      onChange={(event) => updateDraft({ label: event.target.value })}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">ID</span>
                    <input
                      className="text-input"
                      value={draft.id || ""}
                      onChange={(event) => updateDraft({ id: event.target.value })}
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Type</span>
                    <select
                      className="text-input"
                      value={draft.type || "api"}
                      onChange={(event) => updateDraft({ type: event.target.value })}
                    >
                      <option value="api">API</option>
                      <option value="postgres">Postgres</option>
                      <option value="redis">Redis</option>
                      <option value="sqlite">SQLite</option>
                    </select>
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Port</span>
                    <input
                      className="text-input"
                      value={draft.port ?? ""}
                      onChange={(event) => updateDraft({ port: event.target.value })}
                    />
                  </label>
                </div>

                <label className="stack-layout" style={{ gap: 6 }}>
                  <span className="minor-text">URL / Path</span>
                  <input
                    className="text-input"
                    value={draft.url || ""}
                    onChange={(event) => updateDraft({ url: event.target.value })}
                  />
                </label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Timeout (ms)</span>
                    <input
                      className="text-input"
                      value={draft.timeout_ms ?? ""}
                      onChange={(event) =>
                        updateDraft({ timeout_ms: event.target.value })
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Output Mode</span>
                    <select
                      className="text-input"
                      value={draft.output_format?.mode || "http_status"}
                      onChange={(event) =>
                        updateOutputFormat({ mode: event.target.value })
                      }
                    >
                      <option value="http_status">HTTP Status</option>
                      <option value="json_path_equals">JSON Path Equals</option>
                      <option value="json_path_truthy">JSON Path Truthy</option>
                      <option value="text_includes">Text Includes</option>
                      <option value="tcp_connect">TCP Connect</option>
                      <option value="file_exists">File Exists</option>
                    </select>
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">JSON Path</span>
                    <input
                      className="text-input"
                      value={draft.output_format?.path || ""}
                      onChange={(event) =>
                        updateOutputFormat({ path: event.target.value })
                      }
                    />
                  </label>
                  <label className="stack-layout" style={{ gap: 6 }}>
                    <span className="minor-text">Equals / Includes</span>
                    <input
                      className="text-input"
                      value={
                        draft.output_format?.mode === "text_includes"
                          ? draft.output_format?.includes || ""
                          : String(draft.output_format?.equals ?? "")
                      }
                      onChange={(event) =>
                        draft.output_format?.mode === "text_includes"
                          ? updateOutputFormat({ includes: event.target.value })
                          : updateOutputFormat({ equals: event.target.value })
                      }
                    />
                  </label>
                </div>

                <dl className="system-tool-kv">
                  <dt>Live Status</dt>
                  <dd>
                    <StatusDisplay
                      status={resultTone(selectedResult?.status || "error")}
                      label={String(selectedResult?.status || "unknown").toUpperCase()}
                    />
                  </dd>
                  <dt>Latency</dt>
                  <dd>
                    {selectedResult?.latency_ms != null
                      ? `${selectedResult.latency_ms} ms`
                      : "-"}
                  </dd>
                  <dt>Details</dt>
                  <dd>{selectedResult?.details || "-"}</dd>
                  <dt>Checked</dt>
                  <dd>{selectedResult?.checked_at || "-"}</dd>
                </dl>

                {storage ? (
                  <dl className="system-tool-kv">
                    <dt>Snapshots</dt>
                    <dd>
                      {Number(storage.snapshots_count || 0).toLocaleString()} ·{" "}
                      {formatBytes(storage.snapshots_size_bytes)}
                    </dd>
                    <dt>Disk Used</dt>
                    <dd>{formatBytes(storage.disk_used_bytes)}</dd>
                    <dt>Disk Free</dt>
                    <dd>{formatBytes(storage.disk_avail_bytes)}</dd>
                  </dl>
                ) : null}

                <SmartContent
                  content={selectedResult?.response || {}}
                  mode="readonly"
                  showCopy
                />
              </div>
            </div>
          ) : null,
        }}
      />
    </section>
  );
}
