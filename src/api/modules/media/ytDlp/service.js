"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { createYtDlpRepo } = require("./repo");
const { createMediaPublishService } = require("./publishService");

const execFileAsync = promisify(execFile);
const activeJobs = new Map();
const AUDIO_FORMATS = new Set(["mp3", "m4a", "opus", "wav", "flac"]);
const VIDEO_QUALITIES = new Set(["best", "2160", "1440", "1080", "720", "480", "360"]);

function moduleRoot(dataRoot) {
  return path.join(dataRoot, "modules", "yt-dlp");
}

function resolveBinary(dataRoot) {
  const configured = String(process.env.YT_DLP_BIN || "").trim();
  if (configured) return configured;
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const local = path.join(moduleRoot(dataRoot), "runtime", "bin", name);
  return fs.existsSync(local) ? local : name;
}

function validateSourceUrl(raw) {
  let value;
  try {
    value = new URL(String(raw || "").trim());
  } catch {
    throw new Error("Enter a valid http or https media URL.");
  }
  if (!["http:", "https:"].includes(value.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }
  const host = value.hostname.toLowerCase();
  if (
    host === "localhost" || host === "::1" || host.endsWith(".local") ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Local and private-network URLs are not allowed.");
  }
  return value.toString();
}

function normalizeOptions(input = {}) {
  const mediaKind = ["audio", "image"].includes(input.media_kind) ? input.media_kind : "video";
  const audioFormat = AUDIO_FORMATS.has(input.audio_format) ? input.audio_format : "mp3";
  const videoQuality = VIDEO_QUALITIES.has(String(input.video_quality))
    ? String(input.video_quality)
    : "best";
  return {
    media_kind: mediaKind,
    audio_format: audioFormat,
    video_quality: videoQuality,
    playlist: input.playlist === true,
    subtitles: input.subtitles === true,
    embed_metadata: input.embed_metadata !== false,
  };
}

function buildArgs(job, outputDir) {
  const options = job.options;
  const args = [
    "--no-config", "--no-color", "--newline", "--progress", "--progress-delta", "0.5",
    "--js-runtimes", "node",
    "--progress-template",
    "download:__YTDLP_PROGRESS__%(progress._percent_str)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s",
    "--print", "before_dl:__YTDLP_TITLE__%(title)j",
    "--print", "before_dl:__YTDLP_EXTRACTOR__%(extractor_key)j",
    "--print", "after_move:__YTDLP_FILE__%(filepath)j",
    "--no-simulate", "--restrict-filenames", "--windows-filenames",
    "--paths", outputDir,
    "--output", "%(title).180B [%(id)s].%(ext)s",
  ];
  if (!options.playlist) args.push("--no-playlist");
  if (options.subtitles) args.push("--write-subs", "--write-auto-subs", "--sub-langs", "all,-live_chat");
  if (options.embed_metadata) args.push("--embed-metadata");
  if (options.media_kind === "audio") {
    args.push("--extract-audio", "--audio-format", options.audio_format, "--audio-quality", "0");
  } else if (options.media_kind === "video") {
    args.push("--format", "bestvideo*+bestaudio/best", "--merge-output-format", "mp4");
    if (options.video_quality !== "best") args.push("--format-sort", `res:${options.video_quality}`);
  }
  args.push("--", job.source_url);
  return args;
}

function publicJob(job) {
  if (!job) return null;
  return {
    ...job,
    output_files: (job.output_files || []).map((file) => ({
      name: path.basename(file.name || file.path || "download"),
      size: Number(file.size || 0),
    })),
  };
}

function createYtDlpService(options) {
  const dataRoot = options.dataRoot;
  const repo = options.repo || createYtDlpRepo(options);
  let runtimeCache = null;

  async function runtimeStatus() {
    if (runtimeCache && Date.now() - runtimeCache.checkedAt < 60_000) {
      return runtimeCache.value;
    }
    const binary = resolveBinary(dataRoot);
    try {
      const localBinary = path.join(
        moduleRoot(dataRoot),
        "runtime",
        "bin",
        process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
      );
      let version = "";
      if (path.resolve(binary) === path.resolve(localBinary) && fs.existsSync(localBinary)) {
        fs.accessSync(
          localBinary,
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        version = String(
          fs.readFileSync(path.join(moduleRoot(dataRoot), "runtime", "version.txt"), "utf8"),
        ).trim();
      } else {
        const result = await execFileAsync(binary, ["--version"], { timeout: 30_000 });
        version = String(result.stdout || "").trim();
      }
      const ffmpeg = await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      const value = { installed: true, binary, version, ffmpeg };
      runtimeCache = { checkedAt: Date.now(), value };
      return value;
    } catch (error) {
      const value = { installed: false, binary, version: "", ffmpeg: false, error: error.message };
      runtimeCache = { checkedAt: Date.now(), value };
      return value;
    }
  }

  async function updateFromLine(sid, lineRaw) {
    const line = String(lineRaw || "").trim();
    if (!line) return;
    if (line.startsWith("__YTDLP_TITLE__")) {
      const raw = line.slice("__YTDLP_TITLE__".length);
      let title = raw;
      try { title = JSON.parse(raw); } catch {}
      await repo.update(sid, { source_title: String(title || ""), updated_at: new Date().toISOString() });
      return;
    }
    if (line.startsWith("__YTDLP_EXTRACTOR__")) {
      const raw = line.slice("__YTDLP_EXTRACTOR__".length);
      let extractor = raw;
      try { extractor = JSON.parse(raw); } catch {}
      await repo.update(sid, { extractor: String(extractor || ""), updated_at: new Date().toISOString() });
      return;
    }
    if (line.startsWith("__YTDLP_FILE__")) {
      const raw = line.slice("__YTDLP_FILE__".length);
      let filePath = raw;
      try { filePath = JSON.parse(raw); } catch {}
      const state = activeJobs.get(sid);
      if (state && filePath) state.outputFiles.add(path.resolve(String(filePath)));
      return;
    }
    if (!line.startsWith("__YTDLP_PROGRESS__")) return;
    const now = Date.now();
    const state = activeJobs.get(sid);
    if (state && now - state.lastProgressWrite < 400) return;
    if (state) state.lastProgressWrite = now;
    const [percentRaw, downloadedRaw, totalRaw, estimateRaw, speedRaw, etaRaw] = line
      .slice("__YTDLP_PROGRESS__".length)
      .split("\t");
    const progress = Math.max(0, Math.min(100, Number.parseFloat(percentRaw) || 0));
    await repo.update(sid, {
      progress,
      downloaded_bytes: Number(downloadedRaw) || 0,
      total_bytes: Number(totalRaw) || Number(estimateRaw) || 0,
      speed_text: speedRaw && speedRaw !== "NA" ? speedRaw : "",
      eta_text: etaRaw && etaRaw !== "NA" ? etaRaw : "",
      updated_at: new Date().toISOString(),
    });
  }

  async function runJob(job) {
    const outputDir = path.join(moduleRoot(dataRoot), "downloads", job.sid);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const binary = resolveBinary(dataRoot);
    const startedAt = new Date().toISOString();
    await repo.update(job.sid, { status: "running", started_at: startedAt, updated_at: startedAt });
    const child = spawn(binary, buildArgs(job, outputDir), {
      cwd: outputDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const state = { child, outputFiles: new Set(), stderr: [], lastProgressWrite: 0 };
    activeJobs.set(job.sid, state);
    for (const stream of [child.stdout, child.stderr]) {
      const lines = readline.createInterface({ input: stream });
      lines.on("line", (line) => {
        if (stream === child.stderr) {
          state.stderr.push(String(line));
          if (state.stderr.length > 20) state.stderr.shift();
        }
        updateFromLine(job.sid, line).catch(() => {});
      });
    }
    child.on("error", async (error) => {
      activeJobs.delete(job.sid);
      const now = new Date().toISOString();
      await repo.update(job.sid, {
        status: "failed", error_message: error.message, completed_at: now, updated_at: now,
      });
    });
    child.on("close", async (code, signal) => {
      activeJobs.delete(job.sid);
      const now = new Date().toISOString();
      const outputFiles = [...state.outputFiles]
        .filter((filePath) => filePath.startsWith(`${path.resolve(outputDir)}${path.sep}`) && fs.existsSync(filePath))
        .map((filePath) => ({ path: filePath, name: path.basename(filePath), size: fs.statSync(filePath).size }));
      const wasCancelled = signal === "SIGTERM" || signal === "SIGKILL";
      const patch = {
        status: wasCancelled ? "cancelled" : code === 0 ? "completed" : "failed",
        output_files: outputFiles,
        error_message: code === 0 ? null : state.stderr.slice(-6).join("\n") || `yt-dlp exited with code ${code}`,
        completed_at: now,
        updated_at: now,
      };
      if (code === 0) patch.progress = 100;
      await repo.update(job.sid, patch);
    });
  }

  async function createJob(input, userId) {
    const status = await runtimeStatus();
    if (!status.installed) throw new Error("yt-dlp is not installed. Run: pnpm media:yt-dlp:install");
    const sourceUrl = validateSourceUrl(input.source_url);
    const normalized = normalizeOptions(input);
    const now = new Date().toISOString();
    const sid = `ytdlp_${crypto.randomUUID().replace(/-/g, "")}`;
    const job = await repo.create({
      sid, user_id: userId, source_url: sourceUrl, source_title: null, extractor: null,
      media_kind: normalized.media_kind,
      requested_format: normalized.media_kind === "audio" ? normalized.audio_format : normalized.media_kind === "image" ? "original" : normalized.video_quality,
      status: "queued", progress: 0, downloaded_bytes: 0, total_bytes: 0,
      speed_text: null, eta_text: null, output_files: [], options: normalized,
      error_message: null, created_at: now, updated_at: now, started_at: null, completed_at: null,
    });
    setImmediate(() => runJob(job).catch(async (error) => {
      const failedAt = new Date().toISOString();
      await repo.update(sid, { status: "failed", error_message: error.message, completed_at: failedAt, updated_at: failedAt });
    }));
    return publicJob(job);
  }

  async function cancelJob(sid, userId) {
    const job = await repo.get(sid, userId);
    if (!job) return null;
    const state = activeJobs.get(sid);
    if (state) state.child.kill("SIGTERM");
    if (["queued", "running"].includes(job.status)) {
      const now = new Date().toISOString();
      return publicJob(await repo.update(sid, { status: "cancelled", completed_at: now, updated_at: now }));
    }
    return publicJob(job);
  }

  async function resolveOutputFile(sid, userId, index = 0) {
    const job = await repo.get(sid, userId);
    if (!job) return null;
    const file = job.output_files?.[Math.max(0, Number(index) || 0)];
    if (!file?.path) return null;
    const allowedRoot = path.resolve(moduleRoot(dataRoot), "downloads", sid);
    const resolved = path.resolve(file.path);
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`) || !fs.existsSync(resolved)) return null;
    return { path: resolved, name: path.basename(resolved), size: fs.statSync(resolved).size };
  }

  async function deleteJob(sid, userId) {
    const job = await repo.get(sid, userId);
    if (!job) return false;
    if (["queued", "running"].includes(job.status) || activeJobs.has(sid)) {
      throw new Error("Cancel the active download before deleting it.");
    }
    if (publishService.hasActivePublishForJob(sid)) {
      throw new Error("Wait for the active upload before deleting it.");
    }
    const jobDirectory = path.resolve(moduleRoot(dataRoot), "downloads", sid);
    const downloadsRoot = path.resolve(moduleRoot(dataRoot), "downloads");
    if (jobDirectory.startsWith(`${downloadsRoot}${path.sep}`)) {
      fs.rmSync(jobDirectory, { recursive: true, force: true });
    }
    return repo.delete(sid, userId);
  }

  const publishService = createMediaPublishService({
    repo,
    resolveOutputFile,
    getPublishingCredentials: options.getPublishingCredentials,
    savePublishingCredentials: options.savePublishingCredentials,
  });
  publishService.startPublishScheduler();

  return {
    runtimeStatus,
    createJob,
    cancelJob,
    deleteJob,
    resolveOutputFile,
    getJob: async (sid, userId) => publicJob(await repo.get(sid, userId)),
    listJobs: async (userId, limit) => (await repo.list(userId, limit)).map(publicJob),
    ...publishService,
  };
}

module.exports = { createYtDlpService, normalizeOptions, validateSourceUrl, resolveBinary };
