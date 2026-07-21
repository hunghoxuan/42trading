import { useEffect, useMemo, useState } from "react";
import { api, getRuntimeActiveUserId } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import FolderComponent from "../../../shared/components/FolderComponent.jsx";
import LogsComponent from "../../../shared/components/LogsComponent.jsx";
import PaginationBar from "../../../shared/components/PaginationBar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import TreeView from "../../../shared/components/TreeView";
import "./SystemToolsPages.css";

const FOLDER_BULK_ACTIONS = [
  { value: "", label: "Bulk Action..." },
  { value: "download_all", label: "Download All" },
  { value: "delete_all", label: "Delete All" },
];

function collectTreePaths(node, bucket = []) {
  if (!node || typeof node !== "object") return bucket;
  const pathValue = String(node?.path || "").trim();
  if (pathValue) bucket.push(pathValue);
  const children = Array.isArray(node?.children) ? node.children : [];
  children.forEach((child) => collectTreePaths(child, bucket));
  return bucket;
}

function isFileNode(node) {
  return String(node?.type || "").toLowerCase() === "file";
}

function getParentPath(relativePath = "") {
  const parts = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function getFileExtension(name = "") {
  const match = String(name || "").match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "file";
}

function getSystemTreeIcon(node) {
  if (isFileNode(node)) return getFileExtension(node?.name || node?.path);
  return "";
}

function parseJsonSafely(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeSystemLogLine(line = "", index = 0, item = {}) {
  const raw = String(line || "");
  const standardMatch = raw.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/);
  if (!standardMatch) {
    return {
      id: `${item.path || item.name || "log"}:${index}`,
      source: item.name || item.path || "LOG",
      entryType: "LOG",
      status: "",
      title: item.name || "Log",
      summary: raw.slice(0, 220) || "-",
      time: item.updated_at || "",
      size: item.size || 0,
      payload: { file: item.path || item.name || "", line: index + 1, message: raw },
    };
  }

  const [, timestamp, level, source, message] = standardMatch;
  return {
    id: `${item.path || item.name || "log"}:${index}`,
    source: item.name || source || "LOG",
    entryType: source || "LOG",
    status: level || "",
    title: source || item.name || "Log",
    summary: message || "-",
    time: timestamp || item.updated_at || "",
    size: item.size || 0,
    payload: {
      file: item.path || item.name || "",
      line: index + 1,
      timestamp,
      level,
      source,
      message,
      raw,
    },
  };
}

function buildSystemLogRows(item, detail) {
  if (!item?.path || !detail) return [];
  const content = detail?.content;
  const parsedJson = parseJsonSafely(content);
  const sourceName = item.name || detail.name || item.path || "Log";

  if (Array.isArray(parsedJson)) {
    return parsedJson.map((entry, index) => ({
      id: `${item.path}:${index}`,
      source: sourceName,
      entryType: entry?.entry_type || entry?.entryType || entry?.event || "JSON",
      status: entry?.status || entry?.level || entry?.result || "",
      title: entry?.name || entry?.event || sourceName,
      summary: entry?.message || entry?.summary || sourceName,
      time: entry?.updated_at || entry?.created_at || entry?.timestamp || detail.updated_at || "",
      size: detail.size || item.size || 0,
      payload: entry,
    }));
  }

  if (parsedJson && typeof parsedJson === "object") {
    return [
      {
        id: item.path,
        source: sourceName,
        entryType:
          parsedJson.entry_type ||
          parsedJson.entryType ||
          parsedJson.event ||
          getFileExtension(sourceName),
        status: parsedJson.status || parsedJson.level || parsedJson.result || "",
        title: parsedJson.name || parsedJson.event || sourceName,
        summary: parsedJson.message || parsedJson.summary || sourceName,
        time:
          parsedJson.updated_at ||
          parsedJson.created_at ||
          parsedJson.timestamp ||
          detail.updated_at ||
          "",
        size: detail.size || item.size || 0,
        payload: parsedJson,
      },
    ];
  }

  const text =
    typeof content === "string" ? content : JSON.stringify(content ?? "", null, 2);
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-500)
    .reverse()
    .map((line, index) => normalizeSystemLogLine(line, index, {
      ...item,
      updated_at: detail.updated_at || item.updated_at || "",
      size: detail.size || item.size || 0,
    }));
}

export default function SystemBrowserPage({
  mode = "files",
  title = "Files",
  authUser = null,
  showFiles = false,
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
  const [selectedTreeId, setSelectedTreeId] = useState("");
  const [expandedPaths, setExpandedPaths] = useState([""]);
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [detailOpen, setDetailOpen] = useState(true);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [bulkAction, setBulkAction] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadTree() {
    try {
      setLoadingTree(true);
      const out = await api.systemBrowserTree(
        mode,
        canChooseUser ? userId : "",
        showFiles,
      );
      const nextTree = out?.tree || null;
      setTree(nextTree);
      setTreeMeta(String(out?.meta || ""));
      setSelectedDir(String(out?.initialPath || ""));
      setSelectedTreeId(String(out?.initialPath || ""));
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
      setSelectedItemIds((previous) => {
        const next = new Set();
        const source = previous instanceof Set ? previous : new Set();
        rows.forEach((row) => {
          if (source.has(row.path)) next.add(row.path);
        });
        return next;
      });
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
  }, [mode, showFiles, userId]);

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
    setSelectedItemIds(new Set());
  }, [mode, userId, selectedDir, query, page, pageSize]);

  async function downloadBrowserFile(item) {
    if (!item?.path) return;
    const blob = await api.systemBrowserDownload({
      scope: mode,
      userId: canChooseUser ? userId : "",
      file: item.path,
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = item.name || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  async function deleteBrowserFile(item, options = {}) {
    if (!item?.path) return;
    const requireConfirm = options.confirm !== false;
    if (requireConfirm) {
      const ok = window.confirm(`Delete ${item.name || item.path}?`);
      if (!ok) return;
    }
    await api.systemBrowserDelete({
      scope: mode,
      userId: canChooseUser ? userId : "",
      file: item.path,
    });
    if (selectedItem?.path === item.path) {
      setSelectedItem(null);
      setDetail(null);
    }
    setSelectedItemIds((previous) => {
      const next = new Set(previous instanceof Set ? previous : []);
      next.delete(item.path);
      return next;
    });
  }

  async function handleDelete() {
    if (!selectedItem?.path) return;
    const ok = window.confirm(`Delete ${selectedItem.name}?`);
    if (!ok) return;
    try {
      await deleteBrowserFile(selectedItem, { confirm: false });
      await loadList();
      await loadTree();
    } catch (err) {
      setError(err?.message || "Failed to delete file.");
    }
  }

  async function handleDownload() {
    if (!selectedItem?.path) return;
    try {
      await downloadBrowserFile(selectedItem);
    } catch (err) {
      setError(err?.message || "Failed to download file.");
    }
  }

  async function handleUpload(file) {
    if (!file) return;
    try {
      setUploading(true);
      await api.systemBrowserUpload({
        scope: mode,
        userId: canChooseUser ? userId : "",
        dir: selectedDir,
        file,
      });
      await loadList();
      await loadTree();
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to upload file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleBulkAction(action) {
    const normalizedAction = String(action || "").trim().toLowerCase();
    if (!normalizedAction) return;
    const targetItems =
      selectedItemIds.size > 0
        ? items.filter((item) => selectedItemIds.has(item.path))
        : items;
    if (!targetItems.length) return;
    try {
      setBulkBusy(true);
      if (normalizedAction === "download_all") {
        for (const item of targetItems) {
          // Sequential downloads keep the browser behavior predictable.
          // eslint-disable-next-line no-await-in-loop
          await downloadBrowserFile(item);
        }
      } else if (normalizedAction === "delete_all") {
        for (const item of targetItems) {
          // eslint-disable-next-line no-await-in-loop
          await deleteBrowserFile(item, { confirm: false });
        }
        await loadList();
        await loadTree();
      }
      setError("");
    } catch (err) {
      setError(err?.message || "Failed bulk action.");
    } finally {
      setBulkBusy(false);
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

  const selectedLogRows = useMemo(
    () => (mode === "logs" ? buildSystemLogRows(selectedItem, detail) : []),
    [detail, mode, selectedItem],
  );

  const showSelectedLogFile = mode === "logs" && Boolean(selectedItem?.path);

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
                selectedId={selectedTreeId || selectedDir}
                expandedIds={expandedPaths}
                onExpandedIdsChange={setExpandedPaths}
                ariaLabel={`${title} tree`}
                getItemId={(node) => String(node?.path || "")}
                getItemChildren={(node) =>
                  Array.isArray(node?.children) ? node.children : []
                }
                getItemLabel={(node) => node?.name || "/"}
                getItemIcon={getSystemTreeIcon}
                getItemHeaderMeta={() => ""}
                getItemMeta={() => null}
                onSelectionChange={(node, pathValue) => {
                  const nextPath = String(pathValue || node?.path || "");
                  setSelectedTreeId(nextPath);
                  if (isFileNode(node)) {
                    setSelectedDir(getParentPath(nextPath));
                    setSelectedItem({
                      ...node,
                      name: node?.name || nextPath.split("/").pop() || nextPath,
                      path: nextPath,
                      kind: node?.kind || getFileExtension(node?.name || nextPath),
                    });
                    setDetailOpen(true);
                    return;
                  }
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

        {showSelectedLogFile ? (
          <LogsComponent
            className="db-manager-crud system-tool-browser-crud"
            rows={selectedLogRows}
            loading={loadingDetail}
            title={selectedItem?.name || "Log File"}
            subtitle={selectedItem?.path || ""}
            emptyText={loadingDetail ? "Loading log file..." : "No log entries found."}
            onRefresh={() => loadDetail(selectedItem)}
            headerActions={
              <button
                type="button"
                className="secondary-button logs-component__icon-button"
                onClick={handleDownload}
                disabled={!selectedItem?.path}
                aria-label="Download log file"
                title="Download"
              >
                ↓
              </button>
            }
          />
        ) : (
          <FolderComponent
            className="db-manager-crud system-tool-browser-crud"
            items={items}
            selectedItem={selectedItem}
            detail={detail}
            loadingList={loadingList}
            loadingDetail={loadingDetail}
            detailOpen={detailOpen}
            onDetailOpenChange={setDetailOpen}
            onSelectItem={(item) => {
              setSelectedTreeId(item?.path || selectedDir);
              setSelectedItem(item);
            }}
            selectedItemIds={selectedItemIds}
            onSelectedItemIdsChange={setSelectedItemIds}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onDownloadItem={downloadBrowserFile}
            onDeleteItem={async (item) => {
              try {
                await deleteBrowserFile(item);
                await loadList();
                await loadTree();
                setError("");
              } catch (err) {
                setError(err?.message || "Failed to delete file.");
              }
            }}
            onUploadFile={mode === "files" ? handleUpload : null}
            uploadDisabled={uploading || mode !== "files"}
            uploadLabel={uploading ? "Uploading..." : "Upload"}
            onBulkAction={handleBulkAction}
            onBulkActionChange={setBulkAction}
            bulkAction={bulkAction}
            bulkActionItems={FOLDER_BULK_ACTIONS}
            bulkActionLoading={bulkBusy}
            bulkActionButtonText="RUN"
            getBulkActionConfirmOptions={(action) => {
              const targetCount =
                selectedItemIds.size > 0 ? selectedItemIds.size : items.length;
              if (action === "delete_all") {
                return {
                  title: "Delete files?",
                  message: `Delete ${targetCount} file(s)? This cannot be undone.`,
                  confirmLabel: "Delete",
                  tone: "danger",
                };
              }
              return null;
            }}
            selectedItemPreviewUrl={selectedItemPreviewUrl}
            onDeleteAll={null}
            listHeaderActions={
              <PaginationBar
                page={page}
                pages={totalPages}
                total={total}
                showPageSize={false}
                onPageChange={setPage}
                label={`Page ${page} / ${totalPages}`}
              />
            }
          />
        )}
      </div>
    </section>
  );
}
