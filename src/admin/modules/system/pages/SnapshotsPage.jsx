import { useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import { showDateTime } from "../../../shared/utils/format";
import PaginationBar from "../../../shared/components/PaginationBar";
import DataTable from "../../../shared/components/DataTable";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import AdminPageToolbar, {
  AdminToolbarGroup,
} from "../../../shared/components/AdminPageToolbar";
import PageHeader from "../../../shared/components/PageHeader";
import PageActionsRow from "../../../shared/components/PageActionsRow";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function isImageFile(item) {
  const mime = String(item?.mime_type || "").toLowerCase();
  const name = String(item?.file_name || "").toLowerCase();
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isTextFile(item, contentType = "") {
  const mime = String(contentType || item?.mime_type || "").toLowerCase();
  const name = String(item?.file_name || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    /\.(txt|json|csv|md|yaml|yml|log)$/i.test(name)
  );
}

function fileKey(source, item) {
  return source === "claude"
    ? String(item?.claude_file_id || item?.id || "")
    : String(item?.file_name || "");
}

const PAGE_SIZE_OPTIONS = [24, 48, 96, 200];
const TYPE_OPTIONS = [
  { value: "", label: "ALL TYPES" },
  { value: "image", label: "IMAGES" },
  { value: "text", label: "TEXT" },
  { value: "pdf", label: "PDF" },
  { value: "other", label: "OTHER" },
];

function fileType(item) {
  const mime = String(item?.mime_type || "").toLowerCase();
  const name = String(item?.file_name || "").toLowerCase();
  if (isImageFile(item)) return "image";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (isTextFile(item)) return "text";
  return "other";
}

export default function SnapshotsPage() {
  const confirm = useConfirmDialog();
  const [source, setSource] = useState("vps");
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState({
    q: "",
    type: "",
    page: 1,
    pageSize: 48,
  });
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState({ type: "", text: "" });
  const [sorting, setSorting] = useState(null);

  const closeModal = () => {
    if (modal?.objectUrl && modal.source === "claude")
      URL.revokeObjectURL(modal.objectUrl);
    setModal(null);
  };

  const loadFiles = async (nextSource = source) => {
    closeModal();
    setLoading(true);
    setStatus({ type: "", text: "" });
    try {
      if (nextSource === "claude") {
        const out = await api.claudeFiles({ limit: 200 });
        const localMap =
          out?.local_map && typeof out.local_map === "object"
            ? out.local_map
            : {};
        const byClaudeId = new Map(
          Object.entries(localMap)
            .map(([localFile, meta]) => [
              String(meta?.file_id || ""),
              { localFile, meta },
            ])
            .filter(([fileId]) => fileId),
        );
        const rows = Array.isArray(out?.data) ? out.data : [];
        setItems(
          rows.map((it) => {
            const id = String(it?.id || "");
            const linked = byClaudeId.get(id) || null;
            return {
              id,
              file_name: String(it?.filename || id),
              claude_file_id: id,
              local_file: linked?.localFile || "",
              created_at: it?.created_at || linked?.meta?.uploaded_at || "",
              size_bytes: Number(
                it?.size_bytes || linked?.meta?.size_bytes || 0,
              ),
              mime_type: String(it?.mime_type || linked?.meta?.mime_type || ""),
              downloadable: it?.downloadable !== false,
              url: linked?.localFile
                ? `/api/chart/snapshots/${encodeURIComponent(linked.localFile)}`
                : "",
            };
          }),
        );
      } else {
        const out = await api.chartSnapshots(200);
        setItems(Array.isArray(out?.items) ? out.items : []);
      }
      setSelectedFiles(new Set());
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Failed to load files."),
      });
    } finally {
      setLoading(false);
    }
  };

  const chooseSource = (nextSource) => {
    setSource(nextSource);
    setFilter((prev) => ({ ...prev, page: 1 }));
    loadFiles(nextSource);
  };

  const filteredItems = useMemo(() => {
    const q = String(filter.q || "")
      .trim()
      .toLowerCase();
    const type = String(filter.type || "");
    return items.filter((item) => {
      if (type && fileType(item) !== type) return false;
      if (!q) return true;
      const haystack = [
        item.file_name,
        item.claude_file_id,
        item.local_file,
        item.mime_type,
        item.id,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [filter.q, filter.type, items]);

  const total = filteredItems.length;
  const pages = Math.max(1, Math.ceil(total / Number(filter.pageSize || 48)));
  const currentPage = Math.min(Number(filter.page || 1), pages);
  const pageItems = useMemo(() => {
    const pageSize = Number(filter.pageSize || 48);
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [currentPage, filter.pageSize, filteredItems]);

  const toggleFile = (key) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteFiles = async (payload) => {
    setDeleting(true);
    setStatus({ type: "", text: "" });
    try {
      const out =
        source === "claude"
          ? await api.claudeDeleteFiles(payload || {})
          : await api.chartSnapshotsDelete(payload || {});
      await loadFiles(source);
      setStatus({
        type: "success",
        text: `Deleted ${Number(out?.deleted_count || 0)} file(s).`,
      });
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Delete failed."),
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = async () => {
    const files = [...selectedFiles];
    if (!files.length) {
      setStatus({ type: "warning", text: "No file selected." });
      return;
    }
    await deleteFiles(source === "claude" ? { file_ids: files } : { files });
  };

  const deleteOne = async (item) => {
    const key = fileKey(source, item);
    if (!key) return;
    if (
      !(await confirm({
        title: "Delete file?",
        message: `Delete ${item.file_name || key}?`,
        confirmLabel: "Delete",
        tone: "danger",
      }))
    )
      return;
    await deleteFiles(
      source === "claude" ? { file_ids: [key] } : { files: [key] },
    );
  };

  const deleteAll = async () => {
    if (!items.length) {
      setStatus({ type: "warning", text: "No files to delete." });
      return;
    }
    if (
      !(await confirm({
        title: "Delete visible files?",
        message: `Delete all ${source === "claude" ? "Claude" : "VPS"} files shown here?`,
        confirmLabel: "Delete All",
        tone: "danger",
      }))
    )
      return;
    if (source === "claude") {
      const ids = items.map((it) => fileKey(source, it)).filter(Boolean);
      await deleteFiles({ file_ids: ids });
      return;
    }
    await deleteFiles({ all: true });
  };

  const uploadSelectedToClaude = async () => {
    const files = [...selectedFiles];
    if (!files.length) {
      setStatus({ type: "warning", text: "No VPS file selected." });
      return;
    }
    setUploading(true);
    setStatus({ type: "", text: "" });
    try {
      const out = await api.claudeUploadSnapshots({ files });
      setStatus({
        type: out?.failed_count ? "warning" : "success",
        text: `Uploaded ${Number(out?.uploaded_count || 0)} file(s) to Claude${out?.failed_count ? `, ${Number(out.failed_count)} failed.` : "."}`,
      });
      await loadFiles(source);
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Claude upload failed."),
      });
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (item) => {
    if (!item) return;
    try {
      setStatus({ type: "", text: "" });
      if (source === "claude") {
        const id = fileKey(source, item);
        const out = await api.claudeFileContent(id, true);
        const objectUrl = URL.createObjectURL(out.blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = out.fileName || item.file_name || `${id}.bin`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        return;
      }
      const a = document.createElement("a");
      a.href = item.url;
      a.download = item.file_name || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Download failed."),
      });
    }
  };

  const viewFile = async (item) => {
    closeModal();
    setViewing(true);
    setStatus({ type: "", text: "" });
    try {
      if (source === "claude") {
        const id = fileKey(source, item);
        const out = await api.claudeFileContent(id, false);
        const objectUrl = URL.createObjectURL(out.blob);
        const contentType = out.contentType || item.mime_type || "";
        const text = isTextFile(item, contentType) ? await out.blob.text() : "";
        setModal({ item, source, objectUrl, contentType, text });
        return;
      }
      setModal({
        item,
        source,
        objectUrl: item.url,
        contentType: item.mime_type || "",
        text: "",
      });
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "View failed."),
      });
    } finally {
      setViewing(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        id: "select",
        header: () => "",
        cell: ({ row }) => {
          const key = fileKey(source, row.original);
          return (
            <input
              type="checkbox"
              checked={selectedFiles.has(key)}
              onChange={() => toggleFile(key)}
            />
          );
        },
        enableSorting: false,
        size: 40,
      },
      {
        id: "preview",
        header: "Type",
        cell: ({ row }) => {
          const it = row.original;
          if (it.url && isImageFile(it)) {
            return (
              <img
                src={it.url}
                alt={it.file_name}
                style={{
                  width: 40,
                  height: 40,
                  objectFit: "cover",
                  borderRadius: 4,
                }}
              />
            );
          }
          return (
            <strong>
              {String(it.mime_type || "file")
                .split("/")
                .pop()
                .toUpperCase()}
            </strong>
          );
        },
        enableSorting: false,
        size: 70,
      },
      {
        accessorKey: "file_name",
        header: "Name",
        cell: ({ getValue }) => (
          <span className="cell-major">{getValue()}</span>
        ),
      },
      {
        id: "sourceInfo",
        header: source === "claude" ? "Claude ID" : "Local Path",
        cell: ({ row }) => {
          const it = row.original;
          return (
            <div className="cell-wrap">
              {source === "claude" && it.claude_file_id ? (
                <span className="cell-minor">{it.claude_file_id}</span>
              ) : null}
              {it.local_file ? (
                <span className="cell-minor">VPS: {it.local_file}</span>
              ) : null}
            </div>
          );
        },
        enableSorting: false,
      },
      {
        id: "typeSize",
        header: "Type / Size",
        cell: ({ row }) => {
          const it = row.original;
          return (
            <span className="cell-minor">
              {String(it.mime_type || "unknown")} &middot;{" "}
              {formatBytes(it.size_bytes)}
            </span>
          );
        },
        enableSorting: false,
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="cell-minor">{showDateTime(getValue())}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const it = row.original;
          return (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="secondary-button"
                type="button"
                onClick={() => viewFile(it)}
                disabled={viewing}
              >
                View
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => downloadFile(it)}
              >
                Download
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => deleteOne(it)}
                disabled={deleting}
              >
                Delete
              </button>
            </div>
          );
        },
        enableSorting: false,
      },
    ],
    [source, selectedFiles, toggleFile, viewing, deleting],
  );

  useEffect(() => {
    loadFiles(source);
    return () => closeModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="stack-layout fadeIn">
      <PageHeader
        title="Files"
        actions={
          <span
            className="minor-text"
            style={{ textAlign: "right", whiteSpace: "nowrap" }}
          >
            {source === "claude" ? "Claude Files API" : "VPS local files"}
          </span>
        }
      />

      <ResponsivePanel
        title="Controls"
        border="always"
        collapseDirection="top-down"
        showToggle
      >
        <AdminPageToolbar
          pagination={
            <AdminToolbarGroup className="toolbar-group toolbar-pagination toolbar-group--smart-mobile toolbar-group--pagination-mobile">
              <div className="pager-area">
                <strong>{total}</strong>
                <PaginationBar
                  page={currentPage}
                  pages={pages}
                  label={`${currentPage}/${pages}`}
                  pageSize={filter.pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageChange={(page) => setFilter((f) => ({ ...f, page }))}
                  onPageSizeChange={(pageSize) =>
                    setFilter((f) => ({ ...f, pageSize, page: 1 }))
                  }
                />
              </div>
            </AdminToolbarGroup>
          }
          filters={
            <AdminToolbarGroup className="toolbar-group toolbar-search-filter toolbar-group--smart-mobile toolbar-group--filters-mobile">
              <input
                className="toolbar-item toolbar-item--search"
                value={filter.q}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, q: e.target.value, page: 1 }))
                }
                placeholder="Search files..."
                style={{ width: 220 }}
              />
              <InputComboSelect
                className="toolbar-item toolbar-item--half"
                value={source}
                onChange={(e) => chooseSource(e.target.value)}
              >
                <option value="vps">VPS</option>
                <option value="claude">Claude</option>
              </InputComboSelect>
              <InputComboSelect
                className="toolbar-item toolbar-item--half"
                value={filter.type}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, type: e.target.value, page: 1 }))
                }
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value || "all"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </InputComboSelect>
            </AdminToolbarGroup>
          }
          actions={
            <PageActionsRow className="toolbar-group toolbar-create toolbar-group--smart-mobile toolbar-group--actions-mobile">
              <button
                className="secondary-button toolbar-item toolbar-item--half"
                type="button"
                onClick={() => loadFiles(source)}
                disabled={loading}
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              {source === "vps" ? (
                <button
                  className="secondary-button toolbar-item toolbar-item--full"
                  type="button"
                  onClick={uploadSelectedToClaude}
                  disabled={uploading || deleting}
                >
                  {uploading ? "Uploading..." : "Upload to Claude"}
                </button>
              ) : null}
              <button
                className="danger-button toolbar-item toolbar-item--half"
                type="button"
                onClick={deleteSelected}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Selected"}
              </button>
              <button
                className="danger-button toolbar-item toolbar-item--half"
                type="button"
                onClick={deleteAll}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete All"}
              </button>
            </PageActionsRow>
          }
        />
      </ResponsivePanel>

      <section className="panel">
        {status.text ? (
          <div
            className={`form-message ${status.type === "error" ? "msg-error" : status.type === "warning" ? "msg-warning" : "msg-success"}`}
          >
            {status.text}
          </div>
        ) : null}

        <DataTable
          columns={columns}
          data={pageItems}
          sorting={sorting}
          onSortingChange={setSorting}
          loading={loading}
          emptyText={`No ${source === "claude" ? "Claude files" : "VPS files"} yet.`}
        />
      </section>

      {modal ? (
        <div className="snapshot-modal-backdrop-v4" onClick={closeModal}>
          <div
            className="snapshot-modal-panel-v4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="snapshot-modal-head-v4">
              <div>
                <span className="panel-label" style={{ margin: 0 }}>
                  {modal.item?.file_name || "File"}
                </span>
                <div className="minor-text">
                  {modal.contentType || modal.item?.mime_type || "file"} ·{" "}
                  {formatBytes(modal.item?.size_bytes)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => downloadFile(modal.item)}
                >
                  Download
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={closeModal}
                >
                  Close
                </button>
              </div>
            </div>
            {isImageFile(modal.item) ? (
              <img
                src={modal.objectUrl}
                alt={modal.item?.file_name || "file"}
                className="snapshot-modal-image-v2"
              />
            ) : modal.text ? (
              <pre className="snapshot-modal-pre-v2">{modal.text}</pre>
            ) : String(modal.contentType || modal.item?.mime_type || "")
                .toLowerCase()
                .includes("pdf") ? (
              <iframe
                title={modal.item?.file_name || "file"}
                src={modal.objectUrl}
                className="snapshot-modal-frame-v2"
              />
            ) : (
              <pre className="snapshot-modal-pre-v2">
                {JSON.stringify(modal.item || {}, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
