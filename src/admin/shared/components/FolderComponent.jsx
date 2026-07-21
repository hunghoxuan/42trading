import { useMemo, useRef, useState } from "react";
import CrudContainer from "./CrudContainer";
import BulkActionsButton from "./BulkActionsButton.jsx";
import SmartContent from "./SmartContent.jsx";
import "./FolderComponent.css";

export function formatFolderBytes(value) {
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

export function formatFolderDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function inferFolderPreviewMode(item = {}, detail = null) {
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
  if (mimeType.includes("html") || /\.(html?|xhtml)$/i.test(fileName)) {
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

function isImageLikeItem(item = {}, detail = null) {
  return inferFolderPreviewMode(item, detail) === "image";
}

function getExtensionLabel(value = "") {
  const name = String(value || "").trim();
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1] ? match[1].slice(0, 4).toUpperCase() : "FILE";
}

export default function FolderComponent({
  items = [],
  selectedItem = null,
  selectedItemIds = null,
  detail = null,
  loadingList = false,
  loadingDetail = false,
  detailOpen = true,
  onDetailOpenChange,
  onSelectItem,
  onSelectedItemIdsChange,
  onDownload,
  onDelete,
  onDownloadItem,
  onDeleteItem,
  onDeleteAll,
  onUploadFile,
  onBulkAction,
  onBulkActionChange,
  deleteAllDisabled = false,
  deleteAllLabel = "Delete All",
  deleteAllIcon = "🗑",
  uploadDisabled = false,
  uploadLabel = "Upload",
  uploadIcon = "↑",
  bulkAction = "",
  bulkActionItems = [],
  bulkActionLoading = false,
  bulkActionButtonText = "RUN",
  bulkActionAriaLabel = "Bulk Action",
  bulkActionSelectId = "folder-component-bulk-action",
  getBulkActionConfirmOptions,
  itemActionsLabel = "Actions",
  selectedItemPreviewUrl = "",
  selectedItemPreviewMode = "",
  listTitle = "Items",
  listHeaderContent = null,
  listHeaderActions = null,
  emptyText = "No items in this folder.",
  className = "",
  sameHeight = false,
  detailCloseButton = true,
  showUpdatedColumn = true,
  getItemId = (item) => item?.path || item?.name,
  getItemName = (item) => item?.name || "-",
  getItemType = (item) => item?.kind || "file",
  getItemSize = (item) => item?.size,
  getItemUpdated = (item) => item?.updated_at,
  getItemPath = (item) => item?.path || "",
  getItemPreviewUrl = (item) => item?.url || "",
  formatBytes = formatFolderBytes,
  formatDate = formatFolderDate,
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const uploadInputRef = useRef(null);

  const normalizedSelectedItemIds =
    selectedItemIds instanceof Set ? selectedItemIds : new Set();
  const selectableItems = Array.isArray(items) ? items : [];
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => normalizedSelectedItemIds.has(getItemId(item)));

  const setItemChecked = (item, checked) => {
    const itemId = getItemId(item);
    onSelectedItemIdsChange?.((previous) => {
      const source = previous instanceof Set ? previous : normalizedSelectedItemIds;
      const next = new Set(source);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const setAllChecked = (checked) => {
    onSelectedItemIdsChange?.((previous) => {
      const source = previous instanceof Set ? previous : normalizedSelectedItemIds;
      const next = new Set(source);
      selectableItems.forEach((item) => {
        const itemId = getItemId(item);
        if (checked) next.add(itemId);
        else next.delete(itemId);
      });
      return next;
    });
  };

  const handleUploadInputChange = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file || !onUploadFile) return;
    await onUploadFile(file);
  };

  const handleSelectItem = (item) => {
    onSelectItem?.(item);
    onDetailOpenChange?.(true);
  };

  const itemColumns = useMemo(() => {
    const columns = [
      ...(onSelectedItemIdsChange
        ? [
            {
              id: "select",
              header: () => (
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => {
                    event.stopPropagation();
                    setAllChecked(event.target.checked);
                  }}
                  aria-label="Select all files"
                />
              ),
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  checked={normalizedSelectedItemIds.has(getItemId(row.original))}
                  onChange={(event) => {
                    event.stopPropagation();
                    setItemChecked(row.original, event.target.checked);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Select ${getItemName(row.original)}`}
                />
              ),
              enableSorting: false,
              size: 34,
            },
          ]
        : []),
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="folder-component-name-cell">
            {isImageLikeItem(row.original) && getItemPreviewUrl(row.original) ? (
              <img
                src={getItemPreviewUrl(row.original)}
                alt={getItemName(row.original)}
                className="folder-component-thumb folder-component-thumb--image"
                loading="lazy"
              />
            ) : (
              <div className="folder-component-thumb folder-component-thumb--placeholder">
                {getExtensionLabel(getItemName(row.original) || getItemPath(row.original))}
              </div>
            )}
            <div className="folder-component-table__primary system-tool-table__primary">
              <div className="folder-component-table__title system-tool-table__title">
                {getItemName(row.original)}
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => getItemType(row.original),
      },
      {
        accessorKey: "size",
        header: "Size",
        cell: ({ row }) => formatBytes(getItemSize(row.original)),
      },
    ];
    if (showUpdatedColumn) {
      columns.push({
        accessorKey: "updated_at",
        header: "Updated",
        cell: ({ row }) => formatDate(getItemUpdated(row.original)),
      });
    }
    if (onDownloadItem || onDeleteItem) {
      columns.push({
        id: "actions",
        header: itemActionsLabel,
        size: 92,
        cell: ({ row }) => (
          <div className="folder-component-row-actions">
            {onDownloadItem ? (
              <button
                type="button"
                className="folder-component-icon-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownloadItem(row.original);
                }}
                aria-label={`Download ${getItemName(row.original)}`}
                title="Download"
              >
                ↓
              </button>
            ) : null}
            {onDeleteItem ? (
              <button
                type="button"
                className="folder-component-icon-button folder-component-icon-button--danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteItem(row.original);
                }}
                aria-label={`Delete ${getItemName(row.original)}`}
                title="Delete"
              >
                ×
              </button>
            ) : null}
          </div>
        ),
      });
    }
    return columns;
  }, [
    allSelected,
    formatBytes,
    formatDate,
    getItemName,
    getItemId,
    getItemPath,
    getItemPreviewUrl,
    getItemSize,
    getItemType,
    getItemUpdated,
    itemActionsLabel,
    normalizedSelectedItemIds,
    onSelectedItemIdsChange,
    onDeleteItem,
    onDownloadItem,
    setAllChecked,
    setItemChecked,
    showUpdatedColumn,
  ]);

  const previewMode =
    selectedItemPreviewMode || inferFolderPreviewMode(selectedItem, detail);
  const resolvedSize = detail?.size || getItemSize(selectedItem);
  const resolvedUpdated = detail?.updated_at || getItemUpdated(selectedItem);
  const resolvedMimeType =
    detail?.mime_type || detail?.mimeType || detail?.content_type || "";

  return (
    <>
      <CrudContainer
        className={[
          "folder-component-crud",
          "system-tool-browser-crud",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        sameHeight={sameHeight}
        detailVisible={Boolean(selectedItem)}
        detailOpen={detailOpen}
        onDetailOpenChange={onDetailOpenChange}
        detailCloseButton={detailCloseButton}
        list={{
          title: listTitle,
          headerActions: (
            <div className="folder-component-header-actions">
              {listHeaderContent}
              {onBulkAction ? (
                <BulkActionsButton
                  items={bulkActionItems}
                  selectedItems={bulkAction}
                  onSelectedItemsChange={onBulkActionChange}
                  onClick={onBulkAction}
                  buttonText={bulkActionButtonText}
                  loading={bulkActionLoading}
                  disabled={loadingList || selectableItems.length === 0}
                  buttonDisabled={!bulkAction}
                  ariaLabel={bulkActionAriaLabel}
                  selectId={bulkActionSelectId}
                  className="folder-component-bulk-actions"
                  getConfirmOptions={getBulkActionConfirmOptions}
                />
              ) : null}
              {onUploadFile ? (
                <>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    className="folder-component-upload-input"
                    onChange={handleUploadInputChange}
                  />
                  <button
                    type="button"
                    className="folder-component-header-icon-button secondary-button"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploadDisabled}
                    aria-label={uploadLabel}
                    title={uploadLabel}
                  >
                    {uploadIcon}
                  </button>
                </>
              ) : null}
              {listHeaderActions}
              {onDeleteAll ? (
                <button
                  type="button"
                  className="folder-component-delete-all-button folder-component-header-icon-button secondary-button"
                  onClick={onDeleteAll}
                  disabled={deleteAllDisabled}
                  aria-label={deleteAllLabel}
                  title={deleteAllLabel}
                >
                  {deleteAllIcon}
                </button>
              ) : null}
            </div>
          ),
          panelClassName: "folder-component-main db-manager-rows-panel system-tool-main",
          tableProps: {
            columns: itemColumns,
            data: items,
            loading: loadingList,
            emptyText,
            className:
              "events-table events-table--compact folder-component-table system-tool-browser-table",
            onRowClick: handleSelectItem,
            getRowId: getItemId,
            selectedRowId: selectedItem ? getItemId(selectedItem) : null,
          },
        }}
        detail={{
          title: "",
          subtitle: "",
          headerActions: selectedItem ? (
            <>
              {onDownload ? (
                <button
                  type="button"
                  className="folder-component-header-icon-button secondary-button"
                  onClick={onDownload}
                  aria-label="Download selected file"
                  title="Download"
                >
                  ↓
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="folder-component-header-icon-button danger-button"
                  onClick={onDelete}
                  aria-label="Delete selected file"
                  title="Delete"
                >
                  ×
                </button>
              ) : null}
            </>
          ) : null,
          panelClassName: "folder-component-detail system-tool-detail",
          children: selectedItem ? (
            <div className="folder-component-panel__body folder-component-panel__body--scroll system-tool-panel__body system-tool-panel__body--scroll">
              <div className="folder-component-detail__content system-tool-detail__content">
                {!loadingDetail && previewMode === "image" && selectedItemPreviewUrl ? (
                  <button
                    type="button"
                    className="folder-component-image-preview system-tool-image-preview"
                    onClick={() => setPreviewOpen(true)}
                    title="Open large preview"
                  >
                    <img
                      src={selectedItemPreviewUrl}
                      alt={getItemName(selectedItem) || "Preview"}
                      className="folder-component-image-preview__img system-tool-image-preview__img"
                    />
                  </button>
                ) : null}
                {loadingDetail ? (
                  <div className="minor-text">Loading content...</div>
                ) : (
                  <>
                    {previewMode === "image" ? (
                      <div className="folder-component-image-preview__meta system-tool-image-preview__meta minor-text">
                        IMAGE • {formatBytes(resolvedSize || 0)}
                      </div>
                    ) : null}
                    {previewMode !== "image" && previewMode !== "binary" ? (
                      <SmartContent
                        mode={previewMode}
                        content={
                          previewMode === "video"
                            ? {
                                src: selectedItemPreviewUrl,
                              }
                            : detail?.content || ""
                        }
                        fileName={getItemName(selectedItem) || ""}
                        mimeType={resolvedMimeType}
                        sizeBytes={resolvedSize || 0}
                        showInfo
                        showCopy={previewMode === "text" || previewMode === "html"}
                      />
                    ) : null}
                  </>
                )}
                <dl className="folder-component-kv system-tool-kv">
                  <dt>Name</dt>
                  <dd>{getItemName(selectedItem)}</dd>
                  <dt>Path</dt>
                  <dd className="folder-component-code system-tool-code">
                    {getItemPath(selectedItem)}
                  </dd>
                  <dt>Size</dt>
                  <dd>{formatBytes(resolvedSize)}</dd>
                  <dt>Updated</dt>
                  <dd>{formatDate(resolvedUpdated)}</dd>
                </dl>
              </div>
            </div>
          ) : null,
        }}
      />

      {previewOpen && selectedItemPreviewUrl ? (
        <button
          type="button"
          className="folder-component-image-modal system-tool-image-modal"
          onClick={() => setPreviewOpen(false)}
          aria-label="Close image preview"
        >
          <div
            className="folder-component-image-modal__content system-tool-image-modal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={selectedItemPreviewUrl}
              alt={getItemName(selectedItem) || "Preview"}
              className="folder-component-image-modal__img system-tool-image-modal__img"
            />
          </div>
        </button>
      ) : null}
    </>
  );
}
