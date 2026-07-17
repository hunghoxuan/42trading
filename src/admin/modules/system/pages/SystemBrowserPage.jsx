import { useEffect, useMemo, useState } from "react";
import { api, getRuntimeActiveUserId } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import CrudContainer from "../../../shared/components/CrudContainer";
import PaginationBar from "../../../shared/components/PaginationBar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import SmartContent from "../../../shared/components/SmartContent.jsx";
import TreeView from "../../../shared/components/TreeView";
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

function inferPreviewMode(item = {}, detail = null) {
  const fileName = String(item?.name || item?.path || "").trim().toLowerCase();
  const mimeType = String(
    detail?.mime_type || detail?.mimeType || detail?.content_type || "",
  )
    .trim()
    .toLowerCase();
  if (
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(fileName)
  ) {
    return "image";
  }
  if (
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v|ogg)$/i.test(fileName)
  ) {
    return "video";
  }
  if (
    mimeType.includes("html") ||
    /\.(html?|xhtml)$/i.test(fileName)
  ) {
    return "html";
  }
  if (
    detail?.kind === "text" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    /\.(txt|json|md|markdown|csv|log|yaml|yml|xml|js|jsx|ts|tsx|css|scss)$/i.test(fileName)
  ) {
    return "text";
  }
  return "binary";
}

function collectTreePaths(node, bucket = []) {
  if (!node || typeof node !== "object") return bucket;
  const pathValue = String(node?.path || "").trim();
  if (pathValue) bucket.push(pathValue);
  const children = Array.isArray(node?.children) ? node.children : [];
  children.forEach((child) => collectTreePaths(child, bucket));
  return bucket;
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
  const [expandedPaths, setExpandedPaths] = useState([""]);
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [detail, setDetail] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
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
      const nextTree = out?.tree || null;
      setTree(nextTree);
      setTreeMeta(String(out?.meta || ""));
      setSelectedDir(String(out?.initialPath || ""));
      setExpandedPaths(collectTreePaths(nextTree, [""]));
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

  useEffect(() => {
    if (selectedItem?.path) setDetailOpen(true);
  }, [selectedItem?.path]);

  useEffect(() => {
    setPreviewOpen(false);
  }, [selectedItem?.path]);

  const itemColumns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="system-tool-table__primary">
            <div className="system-tool-table__title">{row.original?.name || "-"}</div>
          </div>
        ),
      },
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => row.original?.kind || "file",
      },
      {
        accessorKey: "size",
        header: "Size",
        cell: ({ row }) => formatBytes(row.original?.size),
      },
      {
        accessorKey: "updated_at",
        header: "Updated",
        cell: ({ row }) => formatDate(row.original?.updated_at),
      },
    ],
    [],
  );

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

  const selectedItemPreviewUrl = useMemo(() => {
    if (!selectedItem?.path) return "";
    const params = new URLSearchParams({
      scope: String(mode || "files"),
      file: String(selectedItem.path || ""),
    });
    if (canChooseUser && userId) params.set("userId", String(userId));
    return `/api/system/browser/download?${params.toString()}`;
  }, [canChooseUser, mode, selectedItem?.path, userId]);

  const selectedItemPreviewMode = useMemo(
    () => inferPreviewMode(selectedItem, detail),
    [detail, selectedItem],
  );

  return (
    <section className="system-tool-page">
      <PageHeader title={title} />

      <AdminPageToolbar
        className="db-manager-toolbar"
        filters={
          <AdminToolbarGroup className="db-manager-toolbar__group db-manager-toolbar__group--compact">
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
          </AdminToolbarGroup>
        }
        actions={
          <AdminToolbarGroup className="db-manager-toolbar__group">
            <button type="button" className="secondary-button icon-button" onClick={loadTree}>
              ↻
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

      <div className="db-manager-workspace">
        <ResponsivePanel title="Folders" showToggle={false} className="system-tool-sidebar">
          <div className="system-tool-panel__body system-tool-panel__body--scroll">
            {loadingTree ? (
              <div className="minor-text">Loading directories...</div>
            ) : tree ? (
              <TreeView
                className="system-tool-tree"
                items={[tree]}
                selectedId={selectedDir}
                expandedIds={expandedPaths}
                onExpandedIdsChange={setExpandedPaths}
                ariaLabel={`${title} tree`}
                getItemId={(node) => String(node?.path || "")}
                getItemChildren={(node) =>
                  Array.isArray(node?.children) ? node.children : []
                }
                getItemLabel={(node) => node?.name || "/"}
                getItemHeaderMeta={() => ""}
                getItemMeta={() => null}
                onSelectionChange={(node, pathValue) => {
                  const nextPath = String(pathValue || node?.path || "");
                  setSelectedDir(nextPath);
                  setSelectedItem(null);
                  setDetail(null);
                }}
              />
            ) : (
              <div className="empty-state">No folders found.</div>
            )}
          </div>
        </ResponsivePanel>

        <CrudContainer
          className="db-manager-crud system-tool-browser-crud"
          sameHeight={false}
          detailVisible={Boolean(selectedItem)}
          detailOpen={detailOpen}
          onDetailOpenChange={setDetailOpen}
          detailCloseButton
          list={{
            title: "Items",
            headerActions: (
              <PaginationBar
                page={page}
                pages={totalPages}
                total={total}
                showPageSize={false}
                onPageChange={setPage}
                label={`Page ${page} / ${totalPages}`}
              />
            ),
            panelClassName: "db-manager-rows-panel system-tool-main",
            tableProps: {
              columns: itemColumns,
              data: items,
              loading: loadingList,
              emptyText: "No items in this folder.",
              className: "events-table events-table--compact system-tool-browser-table",
              onRowClick: (item) => setSelectedItem(item),
              getRowId: (item) => item?.path || item?.name,
              selectedRowId: selectedItem?.path || null,
            },
          }}
          detail={{
            title: "",
            subtitle: "",
            headerActions: selectedItem ? (
              <>
                <button type="button" className="secondary-button" onClick={handleDownload}>
                  Download
                </button>
                <button type="button" className="danger-button" onClick={handleDelete}>
                  Delete
                </button>
              </>
            ) : null,
            panelClassName: "system-tool-detail",
            children: selectedItem ? (
              <div className="system-tool-panel__body system-tool-panel__body--scroll">
                <div className="system-tool-detail__content">
                  {!loadingDetail &&
                  selectedItemPreviewMode === "image" &&
                  selectedItemPreviewUrl ? (
                    <button
                      type="button"
                      className="system-tool-image-preview"
                      onClick={() => setPreviewOpen(true)}
                      title="Open large preview"
                    >
                      <img
                        src={selectedItemPreviewUrl}
                        alt={selectedItem?.name || "Preview"}
                        className="system-tool-image-preview__img"
                      />
                    </button>
                  ) : null}
                  {loadingDetail ? (
                    <div className="minor-text">Loading content...</div>
                  ) : (
                    <>
                      {selectedItemPreviewMode === "image" ? (
                        <div className="system-tool-image-preview__meta minor-text">
                          IMAGE • {formatBytes(detail?.size || selectedItem?.size || 0)}
                        </div>
                      ) : null}
                      {selectedItemPreviewMode !== "image" &&
                      selectedItemPreviewMode !== "binary" ? (
                        <SmartContent
                          mode={selectedItemPreviewMode}
                          content={
                            selectedItemPreviewMode === "video"
                              ? {
                                  src: selectedItemPreviewUrl,
                                }
                              : detail?.content || ""
                          }
                          fileName={selectedItem?.name || ""}
                          mimeType={
                            detail?.mime_type || detail?.mimeType || detail?.content_type || ""
                          }
                          sizeBytes={detail?.size || selectedItem?.size || 0}
                          showInfo
                          showCopy={
                            selectedItemPreviewMode === "text" ||
                            selectedItemPreviewMode === "html"
                          }
                        />
                      ) : null}
                    </>
                  )}
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
                </div>
              </div>
            ) : null,
          }}
        />

        {previewOpen && selectedItemPreviewUrl ? (
          <button
            type="button"
            className="system-tool-image-modal"
            onClick={() => setPreviewOpen(false)}
            aria-label="Close image preview"
          >
            <div
              className="system-tool-image-modal__content"
              onClick={(event) => event.stopPropagation()}
            >
              <img
                src={selectedItemPreviewUrl}
                alt={selectedItem?.name || "Preview"}
                className="system-tool-image-modal__img"
              />
            </div>
          </button>
        ) : null}
      </div>
    </section>
  );
}
