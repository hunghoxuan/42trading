import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../app/api";
import PageHeader from "../../../shared/components/PageHeader";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
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
  if (status === "running" || status === "queued") return "pending";
  return "idle";
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

export default function YtDlpPage() {
  const confirm = useConfirmDialog();
  const [form, setForm] = useState(INITIAL_FORM);
  const [runtime, setRuntime] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => ["queued", "running"].includes(job.status)),
    [jobs],
  );

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [statusResult, jobsResult] = await Promise.all([
        api.ytDlpStatus(),
        api.ytDlpJobs(),
      ]);
      setRuntime(statusResult.runtime || null);
      setJobs(Array.isArray(jobsResult.items) ? jobsResult.items : []);
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
    const timer = window.setInterval(() => load({ quiet: true }), hasActiveJobs ? 1500 : 8000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, load]);

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

  return (
    <div className="yt-dlp-page">
      <PageHeader
        title="YT DLP"
        actions={
          <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}>
            <span aria-hidden="true">↻</span> Refresh
          </button>
        }
      />

      <div className="yt-dlp-runtime panel">
        <span className={`status-dot ${runtime?.installed ? "success" : "error"}`} />
        <strong>{runtime?.installed ? `yt-dlp ${runtime.version}` : "yt-dlp unavailable"}</strong>
        <span className="minor-text">{runtime?.binary || "Checking runtime…"}</span>
        <span className={`minor-text ${runtime?.ffmpeg ? "money-pos" : "money-neg"}`}>
          FFmpeg {runtime?.ffmpeg ? "ready" : "not found"}
        </span>
      </div>

      {error && <div className="msg-error yt-dlp-message">{error}</div>}

      <form className="toolbar-panel yt-dlp-form" onSubmit={submit}>
        <label className="yt-dlp-field yt-dlp-url-field">
          <span>Media URL</span>
          <input
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            value={form.source_url}
            onChange={(event) => setForm({ ...form, source_url: event.target.value })}
          />
        </label>
        <label className="yt-dlp-field">
          <span>Type</span>
          <select
            value={form.media_kind}
            onChange={(event) => setForm({ ...form, media_kind: event.target.value })}
          >
            <option value="video">Video</option>
            <option value="audio">Audio only</option>
          </select>
        </label>
        {form.media_kind === "video" ? (
          <label className="yt-dlp-field">
            <span>Maximum quality</span>
            <select
              value={form.video_quality}
              onChange={(event) => setForm({ ...form, video_quality: event.target.value })}
            >
              <option value="best">Best available</option>
              {[2160, 1440, 1080, 720, 480, 360].map((quality) => (
                <option key={quality} value={quality}>{quality}p</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="yt-dlp-field">
            <span>Audio format</span>
            <select
              value={form.audio_format}
              onChange={(event) => setForm({ ...form, audio_format: event.target.value })}
            >
              {["mp3", "m4a", "opus", "flac", "wav"].map((format) => (
                <option key={format} value={format}>{format.toUpperCase()}</option>
              ))}
            </select>
          </label>
        )}
        <div className="yt-dlp-options">
          <label><input type="checkbox" checked={form.playlist} onChange={(event) => setForm({ ...form, playlist: event.target.checked })} /> Playlist</label>
          <label><input type="checkbox" checked={form.subtitles} onChange={(event) => setForm({ ...form, subtitles: event.target.checked })} /> Subtitles</label>
          <label><input type="checkbox" checked={form.embed_metadata} onChange={(event) => setForm({ ...form, embed_metadata: event.target.checked })} /> Metadata</label>
        </div>
        <button type="submit" className="primary-button" disabled={submitting || !runtime?.installed}>
          <span aria-hidden="true">⬇</span> {submitting ? "Starting…" : "Download"}
        </button>
        <div className="minor-text yt-dlp-auto-save">
          Downloads are automatically saved to <code>data/modules/yt-dlp/downloads/</code>.
        </div>
      </form>

      {preview && (
        <section className="panel yt-dlp-preview">
          <div className="yt-dlp-preview__header">
            <div>
              <div className="panel-label">Preview</div>
              <div className="minor-text">{preview.name}</div>
            </div>
            <button type="button" className="secondary-button icon-button" onClick={() => setPreview(null)} aria-label="Close preview" title="Close preview">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {preview.mediaKind === "audio" ? (
            <audio key={preview.url} src={preview.url} controls autoPlay crossOrigin="use-credentials" />
          ) : (
            <video key={preview.url} src={preview.url} controls autoPlay crossOrigin="use-credentials" />
          )}
        </section>
      )}

      <section className="panel yt-dlp-history">
        <div className="panel-label">Download history</div>
        {loading && !jobs.length ? (
          <div className="loading-container">Loading downloads…</div>
        ) : !jobs.length ? (
          <div className="minor-text">No downloads yet.</div>
        ) : (
          <div className="yt-dlp-table-wrap">
            <table className="table-dense yt-dlp-table">
              <thead>
                <tr><th>Media</th><th>Format</th><th>Status</th><th>Progress</th><th>Created</th><th>Files</th></tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.sid}>
                    <td>
                      <div className="yt-dlp-title">{job.source_title || job.source_url}</div>
                      <div className="minor-text">{job.extractor || job.source_url}</div>
                      {job.error_message && <div className="msg-error yt-dlp-job-error">{job.error_message}</div>}
                    </td>
                    <td>{job.media_kind} · {job.requested_format}</td>
                    <td><span className={`status-dot ${statusTone(job.status)}`} /> {job.status}</td>
                    <td>
                      <div>{Math.round(job.progress || 0)}% · {formatBytes(job.downloaded_bytes)}</div>
                      <progress max="100" value={job.progress || 0} />
                      {(job.speed_text || job.eta_text) && <div className="minor-text">{job.speed_text || "—"} · ETA {job.eta_text || "—"}</div>}
                    </td>
                    <td>{new Date(job.created_at).toLocaleString()}</td>
                    <td>
                      {["queued", "running"].includes(job.status) && (
                        <button type="button" className="secondary-button danger-text" onClick={() => cancel(job.sid)} title="Cancel download">
                          <span aria-hidden="true">■</span> Cancel
                        </button>
                      )}
                      {(job.output_files || []).map((file, index) => (
                        <span className="yt-dlp-file-actions" key={`${job.sid}-${index}`}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setPreview({
                              sid: job.sid,
                              name: file.name,
                              mediaKind: job.media_kind,
                              url: api.ytDlpPreviewUrl(job.sid, index),
                            })}
                            title={`Preview ${file.name}`}
                          >
                            <span aria-hidden="true">▶</span> Preview
                          </button>
                          <button type="button" className="secondary-button" onClick={() => download(job, index)} title={`Choose where to save ${file.name} (${formatBytes(file.size)})`}>
                            <span aria-hidden="true">⬇</span> Save
                          </button>
                        </span>
                      ))}
                      {!["queued", "running"].includes(job.status) && (
                        <button type="button" className="secondary-button danger-text" onClick={() => remove(job)} title="Delete history and module files">
                          <span aria-hidden="true">🗑</span> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
