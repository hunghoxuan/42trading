import { useState, useCallback, useEffect, useRef } from "react";
import { api, getRuntimeApiKey } from "../../../app/api";
import FolderComponent from "../../../shared/components/FolderComponent.jsx";
import TimeframeSelector from "../../system/components/TimeframeSelector";
import "./TradeDraftTab.css";

const TIMEFRAMES = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1D", label: "1d" },
];

function withApiKey(urlRaw) {
  const url = String(urlRaw || "").trim();
  if (!url) return "";
  const key = String(getRuntimeApiKey() || "").trim();
  try {
    const u = new URL(url, window.location.origin);
    const isSameOrigin = u.origin === window.location.origin;
    if (key && isSameOrigin && !u.searchParams.get("key")) {
      u.searchParams.set("key", key);
    }
    return u.toString();
  } catch {
    if (!key) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(key)}`;
  }
}

export default function TradeDraftTab({
  tradeSid,
  symbol,
  snapshotFiles = [],
  apiScope = "",
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [selectedTfs, setSelectedTfs] = useState(["15m", "1h", "4h"]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const snapshotFilesRef = useRef(snapshotFiles);
  snapshotFilesRef.current = snapshotFiles;

  const loadFiles = useCallback(async () => {
    if (!tradeSid) return;
    setLoading(true);
    setError("");
    try {
      const snapRes = await api.tradeSnapshots(tradeSid, {
        scope: apiScope,
      }).catch(() => ({
        files: [],
      }));
      const sidFiles = snapRes.files || snapRes.items || [];
      const propSnapshotFiles = (Array.isArray(snapshotFilesRef.current)
        ? snapshotFilesRef.current
        : []
      )
        .map((item) => String(item || "").trim())
        .filter(Boolean);

      const serverFiles = [
        ...sidFiles.map((item) => ({
          name: item.name || item.file_name || "snapshot",
          path: item.path || item.file_name || item.name || "snapshot",
          kind: "image",
          url: withApiKey(
            item.url ||
              `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(item.file_name || item.name || "")}/content`,
          ),
          size: item.size_bytes || item.size || 0,
          size_bytes: item.size_bytes || item.size || 0,
          source: "snapshot",
          created_at: item.created_at || null,
          updated_at: item.updated_at || item.created_at || null,
        })),
        ...propSnapshotFiles.map((name) => ({
          name,
          path: name,
          kind: "image",
          url: withApiKey(
            `/api/trades/${encodeURIComponent(tradeSid)}/snapshots/${encodeURIComponent(name)}/content`,
          ),
          size: 0,
          size_bytes: 0,
          source: "snapshot-prop",
          created_at: null,
          updated_at: null,
        })),
      ];

      serverFiles.sort((a, b) => {
        const timeDiff =
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime();
        if (timeDiff !== 0) return timeDiff;
        return String(a.name).localeCompare(String(b.name));
      });

      const seen = new Set();
      const all = [];
      for (const file of serverFiles) {
        if (!file.name || seen.has(file.name)) continue;
        seen.add(file.name);
        all.push(file);
      }
      setFiles(all);
      setSelectedFile((prev) =>
        prev ? all.find((file) => file.name === prev.name) || null : null,
      );
    } catch (e) {
      setError(e?.message || "Failed to load snapshots");
    } finally {
      setLoading(false);
    }
  }, [tradeSid, apiScope]);

  useEffect(() => {
    if (tradeSid) loadFiles();
  }, [tradeSid, loadFiles]);

  const takeSnapshots = async () => {
    if (!tradeSid) {
      setError("No trade SID available. Save the trade first.");
      return;
    }
    if (!symbol) {
      setError("No symbol available.");
      return;
    }
    setCapturing(true);
    setError("");
    try {
      await api.chartSnapshotCreateBatch({
        symbol,
        timeframes: selectedTfs,
        format: "png",
        theme: "dark",
        width: 1200,
        height: 800,
        trade_sid: tradeSid,
      });
      await loadFiles();
    } catch (e) {
      setError(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  const deleteFile = async (fileName) => {
    if (!tradeSid || !fileName) return;
    setDeleting(fileName);
    try {
      await api.deleteTradeDraftFile(tradeSid, fileName);
      setFiles((prev) => prev.filter((file) => file.name !== fileName));
      setSelectedFile((prev) => (prev?.name === fileName ? null : prev));
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const deleteAll = async () => {
    if (!tradeSid || !files.length) return;
    if (!confirm(`Delete all ${files.length} snapshots?`)) return;
    setDeleting("__all__");
    const errors = [];
    for (const file of files) {
      try {
        await api.deleteTradeDraftFile(tradeSid, file.name);
      } catch (e) {
        errors.push(`${file.name}: ${e?.message || "delete failed"}`);
      }
    }
    if (errors.length) setError(errors.join("; "));
    setDeleting(null);
    setSelectedFile(null);
    await loadFiles();
  };

  useEffect(() => {
    if (selectedFile?.name) setDetailOpen(true);
  }, [selectedFile?.name]);

  const handleDownloadSelected = () => {
    downloadFile(selectedFile);
  };

  const downloadFile = (file) => {
    if (!file?.url) return;
    const anchor = document.createElement("a");
    anchor.href = file.url;
    anchor.download = file.name || "snapshot";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDeleteSelected = () => {
    if (!selectedFile?.name) return;
    deleteFile(selectedFile.name);
  };

  return (
    <div style={{ padding: "8px 0" }}>
      <FolderComponent
        className="trade-files-folder"
        items={files}
        selectedItem={selectedFile}
        detail={selectedFile ? { size: selectedFile.size || selectedFile.size_bytes || 0 } : null}
        loadingList={loading}
        loadingDetail={false}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        onSelectItem={setSelectedFile}
        onDownload={selectedFile?.url ? handleDownloadSelected : null}
        onDelete={selectedFile?.name ? handleDeleteSelected : null}
        onDownloadItem={(file) => downloadFile(file)}
        onDeleteItem={(file) => deleteFile(file?.name)}
        onDeleteAll={files.length > 0 ? deleteAll : null}
        deleteAllDisabled={deleting === "__all__"}
        deleteAllLabel={deleting === "__all__" ? "Deleting..." : "Delete All"}
        selectedItemPreviewUrl={selectedFile?.url || ""}
        listTitle="Trade Files"
        listHeaderContent={
          <div className="trade-files-folder__snapshot-actions">
            <TimeframeSelector
              value={selectedTfs}
              onChange={setSelectedTfs}
              options={TIMEFRAMES}
              multiple
              ariaLabel="Snapshot timeframes"
              size="sm"
            />
            <button
              className="secondary-button trade-files-folder__icon-button"
              onClick={loadFiles}
              disabled={loading}
              aria-label="Refresh trade files"
              title="Refresh"
            >
              {loading ? "…" : "↻"}
            </button>
            <button
              className="primary-button trade-files-folder__icon-button"
              onClick={takeSnapshots}
              disabled={capturing || !symbol || !tradeSid}
              aria-label="Take snapshots"
              title="Take Snapshots"
            >
              {capturing ? "…" : "📸"}
            </button>
          </div>
        }
        emptyText={loading || capturing ? "Loading..." : "No snapshots yet."}
        showUpdatedColumn={false}
        getItemId={(item) => item?.name || item?.url}
        getItemName={(item) => item?.name || "-"}
        getItemType={(item) => item?.source || "snapshot"}
        getItemSize={(item) => item?.size || item?.size_bytes || 0}
        getItemUpdated={(item) => item?.updated_at || item?.created_at}
        getItemPath={(item) => item?.path || item?.name || ""}
        getItemPreviewUrl={(item) => item?.url || ""}
      />

      {error ? (
        <div
          className="minor-text"
          style={{ color: "#ef4444", fontSize: 10, marginBottom: 8 }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
