import { useEffect, useMemo, useState } from "react";
import { api, getRuntimeActiveUserId } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
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

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function TreeNode({
  node,
  activePath,
  expandedPaths,
  onToggle,
  onSelect,
}) {
  const children = Array.isArray(node?.children) ? node.children : [];
  const isExpanded = expandedPaths.has(String(node?.path || ""));
  const isActive = String(node?.path || "") === String(activePath || "");

  return (
    <div className="system-tool-tree__node">
      <div className="system-tool-tree__row">
        <button
          type="button"
          className="system-tool-tree__toggle"
          onClick={() => onToggle(String(node?.path || ""))}
          disabled={!children.length}
        >
          {children.length ? (isExpanded ? "▾" : "▸") : "•"}
        </button>
        <button
          type="button"
          className={[
            "system-tool-tree__item",
            isActive ? "is-active" : "",
          ].join(" ")}
          onClick={() => onSelect(String(node?.path || ""))}
        >
          <div className="system-tool-tree__title">{node?.name || "/"}</div>
          <div className="system-tool-tree__meta">
            <span>{node?.meta || "folder"}</span>
            <span>{node?.right || ""}</span>
          </div>
        </button>
      </div>
      {children.length && isExpanded ? (
        <div className="system-tool-tree__children">
          {children.map((child) => (
            <TreeNode
              key={child.path || child.name}
              node={child}
              activePath={activePath}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SystemBrowserPage({
  mode = "files",
  title = "Files",
  authUser = null,
}) {
  const canChooseUser = mode === "files";
  const defaultUserId = useMemo(
    () => getRuntimeActiveUserId() || String(authUser?.user_id || ""),
    [authUser?.user_id],
  );
  const [userId, setUserId] = useState(defaultUserId);
  const [tree, setTree] = useState(null);
  const [treeMeta, setTreeMeta] = useState("");
  const [selectedDir, setSelectedDir] = useState("");
  const [expandedPaths, setExpandedPaths] = useState(new Set([""]));
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadTree() {
    try {
      setLoadingTree(true);
      const out = await api.systemBrowserTree(mode, canChooseUser ? userId : "");
      setTree(out?.tree || null);
      setTreeMeta(String(out?.meta || ""));
      setSelectedDir(String(out?.initialPath || ""));
      setExpandedPaths(new Set(["", String(out?.initialPath || "")]));
      if (canChooseUser && out?.user_id && !userId) {
        setUserId(String(out.user_id));
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load directories.");
    } finally {
      setLoadingTree(false);
    }
  }

  async function loadList() {
    try {
      setLoadingList(true);
      const out = await api.systemBrowserList({
        scope: mode,
        userId: canChooseUser ? userId : "",
        dir: selectedDir,
        q: query,
        page,
        pageSize,
      });
      const rows = Array.isArray(out?.items) ? out.items : [];
      setItems(rows);
      setTotal(Number(out?.total || 0));
      if (selectedItem) {
        const nextSelected = rows.find((row) => row.path === selectedItem.path) || null;
        setSelectedItem(nextSelected);
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load files.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDetail(item) {
    if (!item?.path) {
      setDetail(null);
      return;
    }
    try {
      setLoadingDetail(true);
      const out = await api.systemBrowserContent({
        scope: mode,
        userId: canChooseUser ? userId : "",
        file: item.path,
      });
      setDetail(out);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to load file content.");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    loadTree();
  }, [mode, userId]);

  useEffect(() => {
    setPage(1);
  }, [selectedDir, query, pageSize]);

  useEffect(() => {
    loadList();
  }, [mode, selectedDir, query, page, pageSize, userId]);

  useEffect(() => {
    loadDetail(selectedItem);
  }, [selectedItem?.path, userId, mode]);

  function toggleExpanded(pathValue) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(pathValue)) next.delete(pathValue);
      else next.add(pathValue);
      return next;
    });
  }

  async function handleDelete() {
    if (!selectedItem?.path) return;
    const ok = window.confirm(`Delete ${selectedItem.name}?`);
    if (!ok) return;
    try {
      await api.systemBrowserDelete({
        scope: mode,
        userId: canChooseUser ? userId : "",
        file: selectedItem.path,
      });
      setSelectedItem(null);
      setDetail(null);
      await loadList();
      await loadTree();
    } catch (err) {
      setError(err?.message || "Failed to delete file.");
    }
  }

  async function handleDownload() {
    if (!selectedItem?.path) return;
    try {
      const blob = await api.systemBrowserDownload({
        scope: mode,
        userId: canChooseUser ? userId : "",
        file: selectedItem.path,
      });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = selectedItem.name || "download";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err?.message || "Failed to download file.");
    }
  }

  return (
    <section className="system-tool-page">
      <PageHeader title={title} />
      <AdminPageToolbar
        className="system-tool-toolbar"
        filters={
          <AdminToolbarGroup className="system-tool-toolbar__group">
            {canChooseUser ? (
              <input
                className="text-input"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="User ID"
              />
            ) : null}
            <input
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${mode}...`}
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
          <AdminToolbarGroup className="system-tool-toolbar__group">
            <button type="button" className="secondary-button" onClick={loadTree}>
              Refresh
            </button>
            <span className="minor-text">{treeMeta || ""}</span>
          </AdminToolbarGroup>
        }
      />

      {error ? (
        <div className="panel card-flat" style={{ padding: 12 }}>
          <span className="msg-error">{error}</span>
        </div>
      ) : null}

      <div className="system-tool-layout">
        <ResponsivePanel title="Folders" showToggle={false} className="system-tool-sidebar">
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            {loadingTree ? (
              <div className="minor-text">Loading directories...</div>
            ) : tree ? (
              <div className="system-tool-tree">
                <TreeNode
                  node={tree}
                  activePath={selectedDir}
                  expandedPaths={expandedPaths}
                  onToggle={toggleExpanded}
                  onSelect={(pathValue) => {
                    setSelectedDir(pathValue);
                    setSelectedItem(null);
                    setDetail(null);
                  }}
                />
              </div>
            ) : (
              <div className="empty-state">No folders found.</div>
            )}
          </div>
        </ResponsivePanel>

        <ResponsivePanel title="Items" showToggle={false} className="system-tool-main">
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            <div className="system-tool-list">
              {loadingList ? (
                <div className="minor-text">Loading items...</div>
              ) : items.length ? (
                items.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={[
                      "system-tool-list__item",
                      selectedItem?.path === item.path ? "is-active" : "",
                    ].join(" ")}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="system-tool-list__title">{item.name}</div>
                    <div className="system-tool-list__meta">
                      <span>{item.kind || "file"}</span>
                      <span>{formatBytes(item.size)}</span>
                    </div>
                    <div className="system-tool-list__meta">
                      <span>{item.path}</span>
                      <span>{formatDate(item.updated_at)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">No items in this folder.</div>
              )}
            </div>
            <div
              className="pager-area"
              style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Prev
              </button>
              <span className="minor-text">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </ResponsivePanel>

        <ResponsivePanel title="Detail" showToggle={false} className="system-tool-detail">
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            {selectedItem ? (
              <div className="system-tool-detail__content">
                <div className="system-tool-toolbar__group">
                  <button type="button" className="secondary-button" onClick={handleDownload}>
                    Download
                  </button>
                  <button type="button" className="danger-button" onClick={handleDelete}>
                    Delete
                  </button>
                </div>
                <dl className="system-tool-kv">
                  <dt>Name</dt>
                  <dd>{selectedItem.name}</dd>
                  <dt>Path</dt>
                  <dd className="system-tool-code">{selectedItem.path}</dd>
                  <dt>Size</dt>
                  <dd>{formatBytes(detail?.size || selectedItem.size)}</dd>
                  <dt>Updated</dt>
                  <dd>{formatDate(detail?.updated_at || selectedItem.updated_at)}</dd>
                </dl>
                {loadingDetail ? (
                  <div className="minor-text">Loading content...</div>
                ) : detail?.kind === "text" ? (
                  <pre>{detail?.content || ""}</pre>
                ) : (
                  <div className="empty-state">
                    Binary preview is not rendered inline. Use download to inspect this file.
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">Select a file to inspect it.</div>
            )}
          </div>
        </ResponsivePanel>
      </div>
    </section>
  );
}
