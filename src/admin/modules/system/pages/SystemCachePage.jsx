import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import "./SystemToolsPages.css";

function toneForSource(source = "") {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "memory") return "ok";
  if (normalized === "redis") return "warn";
  if (normalized === "db") return "neutral";
  return "neutral";
}

export default function SystemCachePage() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detail, setDetail] = useState(null);
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

  async function loadItems() {
    try {
      setLoading(true);
      const out = await api.listCache();
      setItems(Array.isArray(out?.items) ? out.items : []);
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
      setDetail(out?.detail || out?.item || out);
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
        className="system-tool-toolbar"
        filters={
          <AdminToolbarGroup className="system-tool-toolbar__group">
            <input
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cache key or payload..."
            />
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="system-tool-toolbar__group">
            <button type="button" className="secondary-button" onClick={loadItems}>
              Refresh
            </button>
            <button type="button" className="danger-button" onClick={handleDeleteAll}>
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

      <div className="system-tool-layout system-tool-layout--compact-detail">
        <ResponsivePanel title="Cache Items" showToggle={false}>
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            <div className="system-tool-list">
              {loading ? (
                <div className="minor-text">Loading cache...</div>
              ) : filteredItems.length ? (
                filteredItems.map((item) => (
                  <button
                    key={`${item.source}:${item.key}`}
                    type="button"
                    className={[
                      "system-tool-list__item",
                      selectedItem?.key === item.key &&
                      selectedItem?.source === item.source
                        ? "is-active"
                        : "",
                    ].join(" ")}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="system-tool-list__title">{item.key}</div>
                    <div className="system-tool-list__meta">
                      <span
                        className={[
                          "system-tool-pill",
                          `system-tool-pill--${toneForSource(item.source)}`,
                        ].join(" ")}
                      >
                        {item.source || "unknown"}
                      </span>
                      <span>{item.expired ? "expired" : "active"}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">No cache entries found.</div>
              )}
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel title="Detail" showToggle={false}>
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            {selectedItem ? (
              <div className="system-tool-detail__content">
                <div className="system-tool-toolbar__group">
                  <button
                    type="button"
                    className="danger-button"
                    onClick={handleDeleteSelected}
                  >
                    Delete Selected
                  </button>
                </div>
                <dl className="system-tool-kv">
                  <dt>Key</dt>
                  <dd className="system-tool-code">{selectedItem.key}</dd>
                  <dt>Source</dt>
                  <dd>{selectedItem.source || "-"}</dd>
                  <dt>TTL</dt>
                  <dd>{selectedItem.ttl_ms ? `${selectedItem.ttl_ms} ms` : "-"}</dd>
                </dl>
                {loadingDetail ? (
                  <div className="minor-text">Loading detail...</div>
                ) : (
                  <pre>{JSON.stringify(detail || selectedItem.data || {}, null, 2)}</pre>
                )}
              </div>
            ) : (
              <div className="empty-state">Select a cache key to inspect it.</div>
            )}
          </div>
        </ResponsivePanel>
      </div>
    </section>
  );
}
