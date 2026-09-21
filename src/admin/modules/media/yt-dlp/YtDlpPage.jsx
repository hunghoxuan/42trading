import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import CrudContainer from "../../../shared/components/CrudContainer";
import DataTable from "../../../shared/components/DataTable";
import InputComboSelect from "../../../shared/components/InputComboSelect";
import PageHeader from "../../../shared/components/PageHeader";
import PaginationBar from "../../../shared/components/PaginationBar";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import SearchFilterBar from "../../../shared/components/SearchFilterBar";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import useIsMobile from "../../../shared/hooks/useIsMobile";
import "./YtDlpPage.css";

const INITIAL_FORM = {
  source_url: "",
  media_kind: "video",
  video_quality: "1080",
  audio_format: "mp3",
  playlist: false,
  subtitles: false,
  embed_metadata: true,
};

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function statusTone(status) {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  if (["running", "queued", "uploading", "scheduled"].includes(status)) return "pending";
  return "idle";
}

function localDateTimeValue(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function saveBlob({ blob, fileName }, fallbackName) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName || fallbackName || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function Icon({ children, viewBox = "0 0 24 24", className = "" }) {
  return (
    <svg
      aria-hidden="true"
      className={["yt-dlp-icon", className].filter(Boolean).join(" ")}
      viewBox={viewBox}
      focusable="false"
    >
      {children}
    </svg>
  );
}

function PlayIcon() {
  return <Icon><path d="m8 5 11 7-11 7V5Z" /></Icon>;
}

function DownloadIcon() {
  return (
    <Icon className="yt-dlp-icon--stroke">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" />
    </Icon>
  );
}

function YoutubeIcon() {
  return (
    <Icon className="yt-dlp-icon--youtube">
      <path d="M21.58 7.19a2.82 2.82 0 0 0-1.98-2C17.85 4.72 12 4.72 12 4.72s-5.85 0-7.6.47a2.82 2.82 0 0 0-1.98 2A29.4 29.4 0 0 0 2 12a29.4 29.4 0 0 0 .42 4.81 2.82 2.82 0 0 0 1.98 2c1.75.47 7.6.47 7.6.47s5.85 0 7.6-.47a2.82 2.82 0 0 0 1.98-2A29.4 29.4 0 0 0 22 12a29.4 29.4 0 0 0-.42-4.81Z" />
      <path className="yt-dlp-icon__cutout" d="m10 15.25 5.2-3.25L10 8.75v6.5Z" />
    </Icon>
  );
}

function TikTokIcon() {
  return (
    <Icon className="yt-dlp-icon--tiktok">
      <path d="M12.53.02h3.91c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03a9.7 9.7 0 0 1-4.12-.99c-.54-.27-1.04-.62-1.53-.98-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94a7.23 7.23 0 0 1-5.91 3.21 7.3 7.3 0 0 1-4.08-1.03 7.4 7.4 0 0 1-3.65-5.71c-.02-.5-.03-1-.01-1.49a7.43 7.43 0 0 1 2.58-4.96 7.2 7.2 0 0 1 6.15-1.72c.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37a3.44 3.44 0 0 0-1.36 1.75c-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87a3.55 3.55 0 0 0 2.77-1.61c.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z" />
    </Icon>
  );
}

function FacebookIcon() {
  return (
    <Icon className="yt-dlp-icon--facebook">
      <path d="M14.2 22v-9h3l.45-3.5H14.2V7.27c0-1.01.28-1.7 1.73-1.7h1.85V2.44a24.7 24.7 0 0 0-2.7-.14c-2.67 0-4.5 1.63-4.5 4.62V9.5H7.56V13h3.02v9h3.62Z" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon className="yt-dlp-icon--stroke">
      <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" />
    </Icon>
  );
}

function CancelIcon() {
  return (
    <Icon className="yt-dlp-icon--stroke">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </Icon>
  );
}

function RefreshIcon() {
  return (
    <Icon className="yt-dlp-icon--stroke">
      <path d="M20 6v5h-5M4 18v-5h5m10.2-3A8 8 0 0 0 6 6.3L4 9m.8 6A8 8 0 0 0 18 17.7l2-2.7" />
    </Icon>
  );
}

function PlatformIcon({ platform }) {
  if (platform === "youtube") return <YoutubeIcon />;
  if (platform === "tiktok") return <TikTokIcon />;
  return <FacebookIcon />;
}

export default function YtDlpPage() {
  const confirm = useConfirmDialog();
  const isMobile = useIsMobile();
  const [form, setForm] = useState(INITIAL_FORM);
  const [runtime, setRuntime] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [platforms, setPlatforms] = useState({});
  const [publishes, setPublishes] = useState([]);
  const [publishDraft, setPublishDraft] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [historySorting, setHistorySorting] = useState({ key: "created_at", dir: "desc" });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);

  const hasActiveWork = useMemo(
    () => jobs.some((job) => ["queued", "running"].includes(job.status))
      || publishes.some((item) => item.status === "uploading"),
    [jobs, publishes],
  );

  // Older API instances expose the connected YouTube provider without the
  // per-channel `channels` array. Keep the destination usable during a
  // rolling restart, and always give a single configured connection a real
  // option in the selector.
  const youtubeChannelOptions = useMemo(() => {
    const channels = Array.isArray(platforms.youtube?.channels)
      ? platforms.youtube.channels
      : [];
    if (channels.length) return channels;
    if (!platforms.youtube?.label && !platforms.youtube?.configured) return [];
    return [{
      id: "default",
      label: platforms.youtube?.label || "Connected YouTube channel",
      configured: Boolean(platforms.youtube?.configured),
    }];
  }, [platforms.youtube]);

  const filteredJobs = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    const values = jobs.filter((job) => {
      if (historyStatus && job.status !== historyStatus) return false;
      if (historyType && job.media_kind !== historyType) return false;
      if (!query) return true;
      return [
        job.source_title,
        job.source_url,
        job.extractor,
        job.media_kind,
        job.requested_format,
        job.status,
        ...(job.output_files || []).map((file) => file.name),
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });

    const direction = historySorting?.dir === "asc" ? 1 : -1;
    const key = historySorting?.key;
    return [...values].sort((left, right) => {
      const getValue = (job) => {
        if (key === "media") return job.source_title || job.source_url || "";
        if (key === "format") return `${job.media_kind || ""} ${job.requested_format || ""}`;
        if (key === "progress") return Number(job.progress || 0);
        return job[key] ?? "";
      };
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction;
    });
  }, [historySearch, historySorting, historyStatus, historyType, jobs]);

  const historyPages = Math.max(1, Math.ceil(filteredJobs.length / historyPageSize));
  const visibleJobs = useMemo(() => {
    const offset = (historyPage - 1) * historyPageSize;
    return filteredJobs.slice(offset, offset + historyPageSize);
  }, [filteredJobs, historyPage, historyPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historySorting, historyStatus, historyType, historyPageSize]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPages));
  }, [historyPages]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [statusResult, jobsResult, publishingResult, publishesResult] = await Promise.all([
        api.ytDlpStatus(),
        api.ytDlpJobs(),
        api.ytDlpPublishingStatus(),
        api.ytDlpPublishes(),
      ]);
      setRuntime(statusResult.runtime || null);
      setJobs(Array.isArray(jobsResult.items) ? jobsResult.items : []);
      setPlatforms(publishingResult.platforms || {});
      setPublishes(Array.isArray(publishesResult.items) ? publishesResult.items : []);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Failed to load yt-dlp.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => load({ quiet: true }), hasActiveWork ? 1500 : 8000);
    return () => window.clearInterval(timer);
  }, [hasActiveWork, load]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await api.ytDlpCreateJob(form);
      setJobs((current) => [result.item, ...current.filter((job) => job.sid !== result.item.sid)]);
      setForm((current) => ({ ...current, source_url: "" }));
    } catch (submitError) {
      setError(submitError.message || "Could not start the download.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(sid) {
    try {
      await api.ytDlpCancelJob(sid);
      await load({ quiet: true });
    } catch (cancelError) {
      setError(cancelError.message || "Could not cancel the download.");
    }
  }

  async function download(job, index) {
    try {
      const suggestedName = job.output_files[index]?.name || "download";
      let fileHandle = null;
      if (typeof window.showSaveFilePicker === "function") {
        fileHandle = await window.showSaveFilePicker({ suggestedName });
      }
      const result = await api.ytDlpDownloadFile(job.sid, index);
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(result.blob);
        await writable.close();
      } else {
        saveBlob(result, suggestedName);
      }
    } catch (downloadError) {
      if (downloadError?.name === "AbortError") return;
      setError(downloadError.message || "Could not download the file.");
    }
  }

  async function remove(job) {
    const accepted = await confirm({
      title: "Delete download?",
      message: `Delete “${job.source_title || job.sid}” and all files saved in its module folder?`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await api.ytDlpDeleteJob(job.sid);
      setJobs((current) => current.filter((item) => item.sid !== job.sid));
      setPreview((current) => current?.sid === job.sid ? null : current);
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete the download.");
    }
  }

  function openPublish(job, fileIndex, platform) {
    const defaultYoutubeChannel = youtubeChannelOptions.find((channel) => channel.configured)?.id || "";
    setPublishDraft({
      job_sid: job.sid,
      file_index: fileIndex,
      platform,
      title: job.source_title || job.output_files[fileIndex]?.name || "Video",
      description: "",
      // Unlisted keeps the upload off the channel's public feed while making
      // its link accessible. Private videos are intentionally inaccessible
      // to viewers who were not explicitly invited in YouTube Studio.
      privacy: "unlisted",
      youtube_channel_id: platform === "youtube" ? defaultYoutubeChannel : "",
      mode: "manual",
      scheduled_at: localDateTimeValue(),
    });
  }

  async function submitPublish(event) {
    event.preventDefault();
    setPublishing(true);
    setError("");
    try {
      await api.ytDlpCreatePublish({
        ...publishDraft,
        scheduled_at:
          publishDraft.mode === "schedule"
            ? new Date(publishDraft.scheduled_at).toISOString()
            : null,
      });
      setPublishDraft(null);
      await load({ quiet: true });
    } catch (publishError) {
      setError(publishError.message || "Could not queue the upload.");
    } finally {
      setPublishing(false);
    }
  }

  async function cancelPublish(sid) {
    try {
      await api.ytDlpCancelPublish(sid);
      await load({ quiet: true });
    } catch (cancelError) {
      setError(cancelError.message || "Could not cancel the scheduled upload.");
    }
  }

  function openPreview(job, fileIndex) {
    const file = job.output_files[fileIndex];
    setPreview({
      sid: job.sid,
      job,
      fileIndex,
      name: file.name,
      mediaKind: job.media_kind,
      url: api.ytDlpPreviewUrl(job.sid, fileIndex),
    });
  }

  const historyColumns = [
    {
      id: "media",
      accessorFn: (job) => job.source_title || job.source_url || "",
      header: "Media",
      size: 330,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="yt-dlp-media-cell">
            <div className="yt-dlp-title">{job.source_title || job.source_url}</div>
            <div className="minor-text">{job.extractor || job.source_url}</div>
            {job.error_message && <div className="msg-error yt-dlp-job-error">{job.error_message}</div>}
          </div>
        );
      },
    },
    {
      id: "format",
      accessorFn: (job) => `${job.media_kind || ""} ${job.requested_format || ""}`,
      header: "Format",
      cell: ({ row }) => `${row.original.media_kind} · ${row.original.requested_format}`,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => (
        <span className="yt-dlp-status"><span className={`status-dot ${statusTone(getValue())}`} /> {getValue()}</span>
      ),
    },
    {
      accessorKey: "progress",
      header: "Progress",
      size: 180,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="yt-dlp-progress-cell">
            <div>{Math.round(job.progress || 0)}% · {formatBytes(job.downloaded_bytes)}</div>
            <progress max="100" value={job.progress || 0} />
            {(job.speed_text || job.eta_text) && <div className="minor-text">{job.speed_text || "—"} · ETA {job.eta_text || "—"}</div>}
          </div>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: "Created",
      size: 150,
      cell: ({ getValue }) => new Date(getValue()).toLocaleString(),
    },
    {
      id: "actions",
      header: "Files",
      enableSorting: false,
      size: 210,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="yt-dlp-row-actions">
            {["queued", "running"].includes(job.status) && (
              <button type="button" className="secondary-button icon-button danger-text" onClick={() => cancel(job.sid)} aria-label="Cancel download" title="Cancel download">
                <CancelIcon />
              </button>
            )}
            {(job.output_files || []).map((file, index) => (
              <span className="yt-dlp-file-actions" key={`${job.sid}-${index}`}>
                <button type="button" className="secondary-button icon-button" onClick={() => openPreview(job, index)} aria-label={`Preview ${file.name}`} title={`Preview ${file.name}`}>
                  <PlayIcon />
                </button>
                <button type="button" className="secondary-button icon-button" onClick={() => download(job, index)} aria-label={`Save ${file.name}`} title={`Choose where to save ${file.name} (${formatBytes(file.size)})`}>
                  <DownloadIcon />
                </button>
                {job.media_kind === "video" && (
                  <>
                    <button type="button" className="secondary-button icon-button yt-dlp-platform-youtube" onClick={() => openPublish(job, index, "youtube")} aria-label="Upload to YouTube channel" title="Upload to YouTube channel">
                      <YoutubeIcon />
                    </button>
                    {/[.](mp4|webm|mov)$/i.test(file.name) && (
                      <button type="button" className="secondary-button icon-button" onClick={() => openPublish(job, index, "tiktok")} aria-label="Upload to TikTok account" title="Upload to TikTok account">
                        <TikTokIcon />
                      </button>
                    )}
                    {/[.](mp4|mov|mkv)$/i.test(file.name) && (
                      <button type="button" className="secondary-button icon-button yt-dlp-platform-facebook" onClick={() => openPublish(job, index, "facebook")} aria-label="Upload a Reel to Facebook Page" title="Upload a Reel to Facebook Page">
                        <FacebookIcon />
                      </button>
                    )}
                  </>
                )}
              </span>
            ))}
            {!["queued", "running"].includes(job.status) && (
              <button type="button" className="secondary-button icon-button danger-text yt-dlp-delete-button" onClick={() => remove(job)} aria-label="Delete download" title="Delete history and module files">
                <TrashIcon />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="yt-dlp-page">
      <PageHeader
        className="trades-page-header"
        title="YT DLP"
        actions={
          <div className="yt-dlp-header-actions">
            <span className="minor-text yt-dlp-runtime-version">
              <span className={`status-dot ${runtime?.installed ? "success" : "error"}`} />
              {runtime?.installed ? `yt-dlp ${runtime.version}` : "yt-dlp unavailable"}
            </span>
            <span className={`minor-text ${runtime?.ffmpeg ? "money-pos" : "money-neg"}`}>
              FFmpeg {runtime?.ffmpeg ? "ready" : "not found"}
            </span>
            <button type="button" className="secondary-button icon-button" onClick={() => load()} disabled={loading} aria-label="Refresh yt-dlp" title="Refresh">
              <RefreshIcon />
            </button>
          </div>
        }
      />

      {error && <div className="msg-error yt-dlp-message">{error}</div>}

      <CrudContainer
        className="yt-dlp-crud-layout"
        toolbar={{
          displayMode: "top",
          className: "yt-dlp-search-toolbar",
          filters: (
            <SearchFilterBar
              search={{
                placeholder: "SEARCH DOWNLOADS...",
                value: historySearch,
                onChange: setHistorySearch,
                style: { minWidth: "min(420px, 100%)", flex: "1 1 420px" },
              }}
              filters={[
                {
                  key: "type",
                  value: historyType,
                  onChange: setHistoryType,
                  options: [
                    { value: "", label: "ALL TYPES" },
                    { value: "video", label: "VIDEO" },
                    { value: "audio", label: "AUDIO" },
                  ],
                },
                {
                  key: "status",
                  value: historyStatus,
                  onChange: setHistoryStatus,
                  options: [
                    { value: "", label: "ALL STATUS" },
                    ...Array.from(new Set(jobs.map((job) => job.status))).sort().map((status) => ({
                      value: status,
                      label: status.toUpperCase(),
                    })),
                  ],
                },
              ]}
            />
          ),
          actions: (
            <PaginationBar
              page={historyPage}
              pages={historyPages}
              total={filteredJobs.length}
              pageSize={historyPageSize}
              pageSizeOptions={[10, 25, 50, 100]}
              onPageChange={setHistoryPage}
              onPageSizeChange={setHistoryPageSize}
            />
          ),
        }}
        detailMode={isMobile ? "modal" : "section"}
        detailOpen={Boolean(preview || publishDraft)}
        onDetailOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setPublishDraft(null);
          }
        }}
        detailCloseButton
        list={{
          title: `${filteredJobs.length} Downloads`,
          panelClassName: "component-frozen-wrap yt-dlp-history-panel",
          headerActions: (
            <form id="yt-dlp-download-form" className="yt-dlp-form yt-dlp-form--grid-header" onSubmit={submit}>
              <input
                type="url"
                required
                className="yt-dlp-url-input"
                aria-label="Media URL"
                placeholder="MEDIA URL — YOUTUBE, TIKTOK, FACEBOOK OR INSTAGRAM"
                value={form.source_url}
                onChange={(event) => setForm({ ...form, source_url: event.target.value })}
              />
              <InputComboSelect className="yt-dlp-form-select" aria-label="Media type" value={form.media_kind} onChange={(event) => setForm({ ...form, media_kind: event.target.value })}>
                <option value="video">VIDEO</option>
                <option value="audio">AUDIO ONLY</option>
                <option value="image">IMAGES / PHOTO POST</option>
              </InputComboSelect>
              {form.media_kind === "video" ? (
                <InputComboSelect className="yt-dlp-form-select" aria-label="Maximum quality" value={form.video_quality} onChange={(event) => setForm({ ...form, video_quality: event.target.value })}>
                  <option value="best">BEST QUALITY</option>
                  {[2160, 1440, 1080, 720, 480, 360].map((quality) => (
                    <option key={quality} value={quality}>{quality}p</option>
                  ))}
                </InputComboSelect>
              ) : form.media_kind === "audio" ? (
                <InputComboSelect className="yt-dlp-form-select" aria-label="Audio format" value={form.audio_format} onChange={(event) => setForm({ ...form, audio_format: event.target.value })}>
                  {["mp3", "m4a", "opus", "flac", "wav"].map((format) => (
                    <option key={format} value={format}>{format.toUpperCase()}</option>
                  ))}
                </InputComboSelect>
              ) : null}
              <div className="yt-dlp-options">
                <label><input type="checkbox" checked={form.playlist} onChange={(event) => setForm({ ...form, playlist: event.target.checked })} /> Playlist</label>
                <label><input type="checkbox" checked={form.subtitles} onChange={(event) => setForm({ ...form, subtitles: event.target.checked })} /> Subtitles</label>
                <label><input type="checkbox" checked={form.embed_metadata} onChange={(event) => setForm({ ...form, embed_metadata: event.target.checked })} /> Metadata</label>
              </div>
              <button type="submit" className="primary-button icon-button" disabled={submitting || !runtime?.installed} aria-label={submitting ? "Starting download" : "Download"} title={submitting ? "Starting…" : "Download"}>
                <DownloadIcon />
              </button>
            </form>
          ),
          children: (
            <DataTable
                columns={historyColumns}
                data={visibleJobs}
                sorting={historySorting}
                onSortingChange={setHistorySorting}
                loading={loading && !jobs.length}
                emptyText={jobs.length ? "No downloads match the search and filters." : "No downloads yet."}
                className="events-table events-table--compact yt-dlp-data-table"
                getRowId={(job) => job.sid}
                selectedRowId={preview?.sid || null}
                mobileCard={{
                  getTitle: (job) => job.source_title || job.source_url,
                  getSubtitle: (job) => job.extractor || job.source_url,
                  getBadges: (job) => [
                    { label: job.status, tone: statusTone(job.status) },
                    { label: `${job.media_kind} · ${job.requested_format}` },
                  ],
                  getRows: (job) => [[
                    { value: `${Math.round(job.progress || 0)}% · ${formatBytes(job.downloaded_bytes)}` },
                    { value: new Date(job.created_at).toLocaleString() },
                  ]],
                  getActions: (job) => (job.output_files || []).map((file, index) => ({
                    label: <PlayIcon />,
                    onClick: () => openPreview(job, index),
                    className: "secondary-button icon-button",
                  })),
                }}
            />
          ),
        }}
        detail={{
          title: publishDraft
            ? publishDraft.platform === "youtube"
              ? "YouTube channel"
              : publishDraft.platform === "tiktok"
                ? "TikTok account"
                : "Facebook Page Reel"
            : "Preview",
          subtitle: publishDraft
            ? platforms[publishDraft.platform]?.label || "Upload settings"
            : preview?.name || "",
          panelClassName: "yt-dlp-preview-panel",
          children: publishDraft ? (
            <form className="yt-dlp-publish yt-dlp-publish--detail" onSubmit={submitPublish}>
              <div className="minor-text">
                {platforms[publishDraft.platform]?.configured
                  ? `Connected as ${platforms[publishDraft.platform].label}`
                  : (
                      <>
                        Not configured. Open{" "}
                        <a href={`/settings/providers/${publishDraft.platform.toUpperCase()}`}>
                          Settings → Providers
                        </a>.
                      </>
                    )}
              </div>
              <div className="yt-dlp-publish__mode">
                <button type="button" className={`secondary-button ${publishDraft.mode === "manual" ? "active" : ""}`} onClick={() => setPublishDraft({ ...publishDraft, mode: "manual" })}>
                  <span aria-hidden="true">⚡</span> Upload now
                </button>
                <button type="button" className={`secondary-button ${publishDraft.mode === "schedule" ? "active" : ""}`} onClick={() => setPublishDraft({ ...publishDraft, mode: "schedule" })}>
                  <span aria-hidden="true">◷</span> Schedule cron
                </button>
              </div>
              <label className="yt-dlp-field">
                <span>Title</span>
                <input required maxLength={publishDraft.platform === "youtube" ? 100 : publishDraft.platform === "facebook" ? 255 : 2200} value={publishDraft.title} onChange={(event) => setPublishDraft({ ...publishDraft, title: event.target.value })} />
              </label>
              {["youtube", "facebook"].includes(publishDraft.platform) && (
                <label className="yt-dlp-field">
                  <span>Description</span>
                  <textarea rows="4" maxLength="5000" value={publishDraft.description} onChange={(event) => setPublishDraft({ ...publishDraft, description: event.target.value })} />
                </label>
              )}
              {publishDraft.platform === "youtube" && (
                <>
                  <label className="yt-dlp-field">
                    <span>Publish to channel</span>
                    <select required value={publishDraft.youtube_channel_id} onChange={(event) => setPublishDraft({ ...publishDraft, youtube_channel_id: event.target.value })}>
                      <option value="" disabled>Select a connected YouTube channel</option>
                      {youtubeChannelOptions.map((channel) => (
                        <option key={channel.id} value={channel.id} disabled={!channel.configured}>
                          {channel.label}{channel.id === "default" ? " (default)" : ""}{channel.configured ? "" : " — not configured"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="yt-dlp-field">
                    <span>Visibility</span>
                    <select value={publishDraft.privacy} onChange={(event) => setPublishDraft({ ...publishDraft, privacy: event.target.value })}>
                      <option value="private">Private — only invited viewers</option>
                      <option value="unlisted">Unlisted — anyone with the link</option>
                      <option value="public">Public — visible on the channel</option>
                    </select>
                    <small className="minor-text">The connected Google OAuth account determines this personal or Brand channel. Connect each additional channel in Providers to make it selectable here.</small>
                  </label>
                </>
              )}
              {publishDraft.platform === "tiktok" && (
                <div className="minor-text">Uploads to the TikTok inbox as a draft. Review and post it from the TikTok app.</div>
              )}
              {publishDraft.platform === "facebook" && (
                <div className="minor-text">Publishes a public Page Reel. Meta expects a vertical 9:16 video, at least 540 × 960, between 4 and 60 seconds.</div>
              )}
              {publishDraft.mode === "schedule" && (
                <label className="yt-dlp-field">
                  <span>Run at</span>
                  <input type="datetime-local" required value={publishDraft.scheduled_at} onChange={(event) => setPublishDraft({ ...publishDraft, scheduled_at: event.target.value })} />
                </label>
              )}
              <button type="submit" className="primary-button" disabled={publishing || !platforms[publishDraft.platform]?.configured}>
                <span aria-hidden="true">{publishDraft.mode === "schedule" ? "◷" : "↑"}</span>{" "}
                {publishing ? "Queuing…" : publishDraft.mode === "schedule" ? "Schedule upload" : "Upload now"}
              </button>
            </form>
          ) : preview ? (
            <div className="yt-dlp-preview-detail">
              {preview.mediaKind === "audio" ? (
                <audio key={preview.url} src={preview.url} controls autoPlay crossOrigin="use-credentials" />
              ) : (
                <video key={preview.url} src={preview.url} controls autoPlay crossOrigin="use-credentials" />
              )}
              <dl className="yt-dlp-preview-meta">
                <div><dt>Type</dt><dd>{preview.mediaKind}</dd></div>
                <div><dt>Format</dt><dd>{preview.job.requested_format}</dd></div>
                <div><dt>Size</dt><dd>{formatBytes(preview.job.output_files[preview.fileIndex]?.size)}</dd></div>
                <div><dt>Source</dt><dd>{preview.job.extractor || "—"}</dd></div>
              </dl>
              <div className="yt-dlp-preview-actions">
                <button type="button" className="secondary-button icon-button" onClick={() => download(preview.job, preview.fileIndex)} aria-label="Save file" title="Choose where to save">
                  <DownloadIcon />
                </button>
                {preview.mediaKind === "video" && (
                  <>
                    <button type="button" className="secondary-button icon-button yt-dlp-platform-youtube" onClick={() => openPublish(preview.job, preview.fileIndex, "youtube")} aria-label="Upload to YouTube channel" title="Upload to YouTube channel"><YoutubeIcon /></button>
                    {/[.](mp4|webm|mov)$/i.test(preview.name) && (
                      <button type="button" className="secondary-button icon-button" onClick={() => openPublish(preview.job, preview.fileIndex, "tiktok")} aria-label="Upload to TikTok account" title="Upload to TikTok account"><TikTokIcon /></button>
                    )}
                    {/[.](mp4|mov|mkv)$/i.test(preview.name) && (
                      <button type="button" className="secondary-button icon-button yt-dlp-platform-facebook" onClick={() => openPublish(preview.job, preview.fileIndex, "facebook")} aria-label="Upload a Reel to Facebook Page" title="Upload a Reel to Facebook Page"><FacebookIcon /></button>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : null,
        }}
      />

      <ResponsivePanel title="Publishing queue" showToggle={false} className="yt-dlp-publishing-panel">
        {!publishes.length ? (
          <div className="minor-text">No manual or scheduled uploads yet.</div>
        ) : (
          <div className="yt-dlp-table-wrap">
            <table className="table-dense yt-dlp-table yt-dlp-publish-table">
              <thead><tr><th>Platform</th><th>Title</th><th>Status</th><th>Scheduled</th><th>Result</th><th /></tr></thead>
              <tbody>
                {publishes.map((item) => (
                  <tr key={item.sid}>
                    <td><span className={`yt-dlp-platform-label yt-dlp-platform-${item.platform}`}><PlatformIcon platform={item.platform} /> {item.platform === "youtube" ? "YouTube" : item.platform === "tiktok" ? "TikTok" : "Facebook"}</span><div className="minor-text">{item.account_label}</div></td>
                    <td>{item.title}{item.platform === "youtube" && <div className="minor-text">{item.privacy}</div>}</td>
                    <td><span className={`status-dot ${statusTone(item.status)}`} /> {item.status}{item.status === "uploading" ? ` ${Math.round(item.progress || 0)}%` : ""}</td>
                    <td>{new Date(item.scheduled_at).toLocaleString()}</td>
                    <td>{item.remote_url ? <a href={item.remote_url} target="_blank" rel="noreferrer">Open ↗</a> : item.remote_id || "—"}{item.error_message && <div className="msg-error">{item.error_message}</div>}</td>
                    <td>{item.status === "scheduled" && <button type="button" className="secondary-button icon-button danger-text" onClick={() => cancelPublish(item.sid)} aria-label="Cancel scheduled upload" title="Cancel scheduled upload"><CancelIcon /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResponsivePanel>
    </div>
  );
}
