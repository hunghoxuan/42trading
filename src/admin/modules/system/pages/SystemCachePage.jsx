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

function toneForSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "memory") return "ok";
  if (normalized === "redis") return "warn";
  if (normalized === "db") return "neutral";
  return "neutral";
}

function formatTtl(value) {
  const ttl = Number(value || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return "-";
  return `${ttl} ms`;
}

export default function SystemCachePage() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailOpen, setDetailOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  const filteredItems = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.key, item.source, JSON.stringify(item.data || {})]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  const cacheColumns = useMemo(
    () => [
      {
        accessorKey: "key",
        header: "Key",
        cell: ({ row }) => (
          <div className="system-tool-table__primary">
            <div className="system-tool-table__title">
              {row.original?.key || "-"}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ row }) => (
          <span
            className={[
              "system-tool-pill",
              `system-tool-pill--${toneForSource(row.original?.source)}`,
            ].join(" ")}
          >
            {row.original?.source || "unknown"}
          </span>
        ),
      },
      {
        accessorKey: "expired",
        header: "State",
        cell: ({ row }) => (
          <StatusDisplay
            status={row.original?.expired ? "expired" : "active"}
            label={row.original?.expired ? "Expired" : "Active"}
          />
        ),
      },
      {
        accessorKey: "ttl_ms",
        header: "TTL",
        cell: ({ row }) => formatTtl(row.original?.ttl_ms),
      },
    ],
    [],
  );

  async function loadItems() {
    try {
      setLoading(true);
      const out = await api.listCache();
      const nextItems = Array.isArray(out?.items) ? out.items : [];
      setItems(nextItems);
      if (selectedItem?.key) {
        const nextSelected =
          nextItems.find(
            (item) =>
              item.key === selectedItem.key &&
              item.source === selectedItem.source,
          ) || null;
        setSelectedItem(nextSelected);
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load cache items.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(item) {
    if (!item?.key) {
      setDetail(null);
      return;
    }
    try {
      setLoadingDetail(true);
      const out = await api.getCacheDetail(item.key, item.source || "memory");
      setDetail(out?.detail || out?.item || out?.data || out);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load cache detail.");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    loadDetail(selectedItem);
  }, [selectedItem?.key, selectedItem?.source]);

  useEffect(() => {
    if (selectedItem?.key) setDetailOpen(true);
  }, [selectedItem?.key]);

  async function handleDeleteSelected() {
    if (!selectedItem?.key) return;
    const ok = window.confirm(`Delete cache key ${selectedItem.key}?`);
    if (!ok) return;
    try {
      await api.deleteCache(selectedItem.key, selectedItem.source || "memory");
      setSelectedItem(null);
      setDetail(null);
      await loadItems();
    } catch (err) {
      setError(err?.message || "Failed to delete cache key.");
    }
  }

  async function handleDeleteAll() {
    const ok = window.confirm("Clear all cache entries?");
    if (!ok) return;
    try {
      await api.deleteCache();
      setSelectedItem(null);
      setDetail(null);
      await loadItems();
    } catch (err) {
      setError(err?.message || "Failed to clear cache.");
    }
  }

  return (
    <section className="system-tool-page">
      <PageHeader title="System Cache" />
      <AdminPageToolbar
        className="db-manager-toolbar"
        filters={
          <AdminToolbarGroup className="db-manager-toolbar__group db-manager-toolbar__group--compact">
            <input
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cache key or payload..."
            />
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <button
              type="button"
              className="secondary-button"
              onClick={loadItems}
            >
              Refresh
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={handleDeleteAll}
            >
              Clear All
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
        detailVisible={Boolean(selectedItem)}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        detailCloseButton
        list={{
          title: "Cache Items",
          panelClassName: "db-manager-rows-panel system-tool-main",
          tableProps: {
            columns: cacheColumns,
            data: filteredItems,
            loading,
            emptyText: "No cache entries found.",
            className: "events-table events-table--compact system-tool-browser-table",
            onRowClick: (item) => setSelectedItem(item),
            getRowId: (item) => `${item?.source || "memory"}:${item?.key || ""}`,
            selectedRowId: selectedItem
              ? `${selectedItem.source || "memory"}:${selectedItem.key || ""}`
              : null,
          },
        }}
        detail={{
          title: selectedItem?.key || "Detail",
          subtitle: selectedItem?.source
            ? `${selectedItem.source} cache entry`
            : "",
          headerActions: selectedItem ? (
            <button
              type="button"
              className="danger-button"
              onClick={handleDeleteSelected}
            >
              Delete Selected
            </button>
          ) : null,
          panelClassName: "system-tool-detail",
          children: selectedItem ? (
            <div className="system-tool-panel__body system-tool-panel__body--scroll">
              <div className="system-tool-detail__content">
                <dl className="system-tool-kv">
                  <dt>Key</dt>
                  <dd className="system-tool-code">{selectedItem.key}</dd>
                  <dt>Source</dt>
                  <dd>{selectedItem.source || "-"}</dd>
                  <dt>State</dt>
                  <dd>{selectedItem.expired ? "Expired" : "Active"}</dd>
                  <dt>TTL</dt>
                  <dd>{formatTtl(selectedItem.ttl_ms)}</dd>
                </dl>
                {loadingDetail ? (
                  <div className="minor-text">Loading detail...</div>
                ) : (
                  <SmartContent
                    content={detail || selectedItem.data || {}}
                    mode="readonly"
                    showCopy
                  />
                )}
              </div>
            </div>
          ) : null,
        }}
      />
    </section>
  );
}
