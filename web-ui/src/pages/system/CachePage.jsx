import { useEffect, useState, useMemo } from "react";
import { api } from "../../api";
import { showDateTime } from "../../utils/format";
import MasterDetailLayout from "../../components/MasterDetailLayout";
import { useConfirmDialog } from "../../components/ConfirmDialog";

function timeAgo(ms) {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
}

function expiryText(item) {
  if (!item.data?.updated_at) return null;
  const updated = new Date(item.data.updated_at).getTime();
  if (!item.ttl_ms) return null;
  const expiresAt = updated + item.ttl_ms;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "EXPIRED";
  if (remaining < 60000) return Math.ceil(remaining / 1000) + "s left";
  if (remaining < 3600000) return Math.floor(remaining / 60000) + "m left";
  return Math.floor(remaining / 3600000) + "h left";
}

function CsvTable({ content }) {
  const rows = useMemo(() => {
    if (typeof content !== "string") return [];
    return content
      .split("\n")
      .map((line) => line.split(","))
      .filter(
        (cells) =>
          cells.length > 1 ||
          (cells.length === 1 && cells[0].trim().length > 0),
      );
  }, [content]);

  if (!rows.length) return <div className="minor-text">Empty CSV content</div>;

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div
      className="table-wrap"
      style={{ maxHeight: "600px", overflow: "auto" }}
    >
      <table className="events-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ fontSize: 11 }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonViewer({ data }) {
  return (
    <pre
      style={{
        background: "rgba(0,0,0,0.2)",
        padding: "15px",
        borderRadius: "8px",
        fontSize: "12px",
        overflow: "auto",
        maxHeight: "600px",
        color: "#adbac7",
        border: "1px solid var(--border)",
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function CachePage() {
  const confirm = useConfirmDialog();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");

  // Derive unique symbols from items
  const symbols = useMemo(() => {
    const set = new Set();
    items.forEach((it) => {
      const sym = it.data?.symbol;
      if (sym && sym !== "?") set.add(sym);
    });
    return [...set].sort();
  }, [items]);

  // Client-side filtered items
  const filteredItems = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (it) =>
          it.key.toLowerCase().includes(q) ||
          JSON.stringify(it.data || {})
            .toLowerCase()
            .includes(q) ||
          (it.data?.symbol || "").toLowerCase().includes(q) ||
          (it.data?.tf || "").toLowerCase().includes(q),
      );
    }
    if (symbolFilter) {
      list = list.filter((it) => it.data?.symbol === symbolFilter);
    }
    return list;
  }, [items, search, symbolFilter]);

  async function loadCache() {
    try {
      setLoading(true);
      const res = await api.listCache();
      setItems(res.items || []);
    } catch (e) {
      setError(e?.message || "Failed to load cache list");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCache();
  }, []);

  async function loadDetail(key, source) {
    try {
      setDetailLoading(true);
      setSelectedKey({ key, source });
      const res = await api.getCacheDetail(key, source);
      setDetail(res.data);
    } catch (e) {
      setError(e?.message || "Failed to load cache detail");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(key = "", source = "") {
    if (
      !key &&
      !(await confirm({
        title: "Clear all cache?",
        message:
          "Clear ALL cache? This includes Redis, memory, and database market data buffers.",
        confirmLabel: "Clear",
        tone: "danger",
      }))
    )
      return;
    try {
      setBusy(true);
      await api.deleteCache(key, source);
      if (!key) {
        setMsg("All cache cleared.");
        setSelectedKey(null);
        setDetail(null);
      } else {
        setMsg(`Deleted: ${key}`);
        if (selectedKey?.key === key) {
          setSelectedKey(null);
          setDetail(null);
        }
      }
      await loadCache();
    } catch (e) {
      setError(e?.message || "Delete failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }

  const isCsv = (content) => {
    if (typeof content !== "string") return false;
    if (content.length < 5) return false;
    // Heuristic: check for commas and newlines
    const lines = content.split("\n");
    if (lines.length < 2) return false;
    return lines[0].includes(",") && lines[1].includes(",");
  };

  return (
    <div
      className="stack-layout fadeIn"
      style={{ height: "calc(100vh - 120px)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 className="page-title" style={{ margin: 0 }}>
          CACHE
        </h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="text"
            placeholder="SEARCH KEY / CONTENT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200, fontSize: 12 }}
          />
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            style={{ width: 110, fontSize: 12 }}
          >
            <option value="">ALL SYMBOLS</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {msg && (
            <span className="badge FILLED" style={{ padding: "6px 12px" }}>
              {msg}
            </span>
          )}
          {error && (
            <span className="badge SL" style={{ padding: "6px 12px" }}>
              {error}
            </span>
          )}
          <button
            className="secondary-button"
            onClick={loadCache}
            disabled={loading}
          >
            {loading ? "REFRESHING..." : "REFRESH LIST"}
          </button>
          <button
            className="danger-button"
            onClick={() => handleDelete("", "")}
            disabled={busy}
          >
            CLEAR ALL CACHE
          </button>
        </div>
      </div>

      <MasterDetailLayout
        sidebarWidth={400}
        gap={20}
        style={{ height: "100%", overflow: "hidden", marginTop: 0 }}
      >
        {/* Left Column: List */}
        <div className="panel" style={{ overflowY: "auto", padding: 0 }}>
          <table className="events-table">
            <thead
              style={{
                position: "sticky",
                top: 0,
                background: "var(--panel-bg)",
                zIndex: 1,
              }}
            >
              <tr>
                <th>KEY</th>
                <th style={{ width: 80 }}>SOURCE</th>
                <th style={{ width: 140 }}>UPDATED / EXPIRY</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan="4"
                    style={{ textAlign: "center", padding: 40 }}
                    className="muted"
                  >
                    {loading
                      ? "Loading..."
                      : items.length === 0
                        ? "No cache items"
                        : "No matches"}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <tr
                    key={`${item.source}-${item.key}-${idx}`}
                    className={
                      selectedKey?.key === item.key &&
                      selectedKey?.source === item.source
                        ? "selected-row"
                        : ""
                    }
                    onClick={() => loadDetail(item.key, item.source)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                        }}
                      >
                        {item.key}
                      </div>
                      {item.data && typeof item.data === "object" && (
                        <div
                          className="minor-text"
                          style={{ fontSize: 9, marginTop: 4 }}
                        >
                          {item.data.symbol} {item.data.tf} · {item.data.bars}{" "}
                          bars
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${item.source === "memory" ? "FILLED" : "OTHER"}`}
                        style={{ fontSize: 9 }}
                      >
                        {item.source.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div className="minor-text" style={{ fontSize: 9 }}>
                        {item.data?.updated_at
                          ? timeAgo(new Date(item.data.updated_at).getTime())
                          : "n/a"}
                      </div>
                      {expiryText(item) && (
                        <div
                          className="minor-text"
                          style={{
                            fontSize: 8,
                            color: item.expired ? "#ef4444" : "var(--muted)",
                          }}
                        >
                          {expiryText(item)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="secondary-button icon-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.key, item.source);
                        }}
                      >
                        ✖
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Right Column: Detail */}
        <div className="panel" style={{ overflowY: "auto" }}>
          <div className="panel-label">CACHE CONTENT PREVIEW</div>
          {!selectedKey ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              className="muted"
            >
              Select a cache key to view its content
            </div>
          ) : detailLoading ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              className="loading"
            >
              Loading content...
            </div>
          ) : detail ? (
            <div className="stack-layout">
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: 12, fontFamily: "monospace" }}>
                  {selectedKey.key} ({selectedKey.source})
                </span>
                <span className="minor-text">
                  Type: {typeof detail}{" "}
                  {Array.isArray(detail) ? `[Array(${detail.length})]` : ""}
                </span>
              </div>

              {isCsv(detail) ? (
                <CsvTable content={detail} />
              ) : (
                <JsonViewer data={detail} />
              )}
            </div>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              className="muted"
            >
              No content available for this key
            </div>
          )}
        </div>
      </MasterDetailLayout>
    </div>
  );
}
