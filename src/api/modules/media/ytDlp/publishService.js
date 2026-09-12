"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const activePublishes = new Map();

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function mediaType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ({
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
  })[ext] || "application/octet-stream";
}

function supportsTikTok(fileName) {
  return [".mp4", ".webm", ".mov"].includes(path.extname(fileName).toLowerCase());
}

async function responseJson(response) {
  const body = await response.text();
  let data = {};
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
  if (!response.ok) {
    const apiError = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(data?.error_description || apiError || data?.message || `HTTP ${response.status}`);
  }
  return data;
}

function uploadFile(urlRaw, file, headers = {}, onProgress = () => {}, start = 0, end = file.size - 1) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlRaw);
    const transport = url.protocol === "http:" ? http : https;
    const request = transport.request(url, {
      method: "PUT",
      headers: { ...headers, "Content-Length": end - start + 1 },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(data?.error?.message || data?.message || `Upload HTTP ${response.statusCode}`));
        }
      });
    });
    request.on("error", reject);
    let sent = start;
    const stream = fs.createReadStream(file.path, { start, end });
    stream.on("data", (chunk) => {
      sent += chunk.length;
      onProgress(file.size > 0 ? (sent / file.size) * 100 : 0);
    });
    stream.on("error", reject);
    stream.pipe(request);
  });
}

function credentials() {
  return {
    youtube: {
      clientId: text(process.env.MEDIA_YOUTUBE_CLIENT_ID),
      clientSecret: text(process.env.MEDIA_YOUTUBE_CLIENT_SECRET),
      refreshToken: text(process.env.MEDIA_YOUTUBE_REFRESH_TOKEN),
      label: text(process.env.MEDIA_YOUTUBE_CHANNEL_LABEL, "YouTube channel"),
    },
    tiktok: {
      accessToken: text(process.env.MEDIA_TIKTOK_ACCESS_TOKEN),
      clientKey: text(process.env.MEDIA_TIKTOK_CLIENT_KEY),
      clientSecret: text(process.env.MEDIA_TIKTOK_CLIENT_SECRET),
      refreshToken: text(process.env.MEDIA_TIKTOK_REFRESH_TOKEN),
      label: text(process.env.MEDIA_TIKTOK_ACCOUNT_LABEL, "TikTok account"),
    },
  };
}

async function tiktokAccessToken(config, dataRoot) {
  const tokenPath = path.join(dataRoot, "modules", "yt-dlp", "tiktok-token.json");
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(tokenPath, "utf8")); } catch { stored = {}; }
  const storedMatches = Boolean(config.clientKey && stored.client_key === config.clientKey);
  if (storedMatches && stored.access_token && Number(stored.expires_at) > Date.now() + 5 * 60_000) {
    return stored.access_token;
  }
  const refreshToken = (storedMatches ? text(stored.refresh_token) : "") || config.refreshToken;
  if (!(config.clientKey && config.clientSecret && refreshToken)) {
    if (config.accessToken) return config.accessToken;
    throw new Error("TikTok account credentials are not configured.");
  }
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const result = await responseJson(response);
  if (!result.access_token) throw new Error("TikTok OAuth refresh did not return an access token.");
  const next = {
    client_key: config.clientKey,
    access_token: result.access_token,
    refresh_token: result.refresh_token || refreshToken,
    expires_at: Date.now() + Math.max(60, Number(result.expires_in) || 86400) * 1000,
  };
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  const tempPath = `${tokenPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(tempPath, tokenPath);
  return next.access_token;
}

async function youtubeAccessToken(config) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await responseJson(response);
  if (!data.access_token) throw new Error("YouTube OAuth refresh did not return an access token.");
  return data.access_token;
}

async function uploadYouTube(item, file, config, onProgress) {
  const token = await youtubeAccessToken(config);
  const type = mediaType(file.name);
  const metadata = {
    snippet: {
      title: item.title.slice(0, 100),
      description: item.description.slice(0, 5000),
      categoryId: text(item.options?.category_id, "22"),
      tags: Array.isArray(item.options?.tags) ? item.options.tags.slice(0, 30) : [],
    },
    status: { privacyStatus: item.privacy },
  };
  const response = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(file.size),
        "X-Upload-Content-Type": type,
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!response.ok) await responseJson(response);
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");
  const result = await uploadFile(uploadUrl, file, {
    Authorization: `Bearer ${token}`,
    "Content-Type": type,
  }, onProgress);
  if (!result.id) throw new Error("YouTube upload completed without a video ID.");
  return { remoteId: result.id, remoteUrl: `https://www.youtube.com/watch?v=${result.id}` };
}

async function uploadTikTokDraft(item, file, config, dataRoot, onProgress) {
  const accessToken = await tiktokAccessToken(config, dataRoot);
  const chunkSize = file.size > 64 * 1024 * 1024 ? 32 * 1024 * 1024 : file.size;
  const chunkCount = Math.max(1, Math.floor(file.size / chunkSize));
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      source_info: {
        source: "FILE_UPLOAD",
        video_size: file.size,
        chunk_size: chunkSize,
        total_chunk_count: chunkCount,
      },
    }),
  });
  const init = await responseJson(response);
  if (init?.error?.code && init.error.code !== "ok") {
    throw new Error(init.error.message || init.error.code);
  }
  const uploadUrl = init?.data?.upload_url;
  const publishId = init?.data?.publish_id;
  if (!uploadUrl || !publishId) throw new Error("TikTok did not return an upload URL.");
  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const end = index === chunkCount - 1 ? file.size - 1 : start + chunkSize - 1;
    await uploadFile(uploadUrl, file, {
      "Content-Type": mediaType(file.name),
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
    }, onProgress, start, end);
  }
  return { remoteId: publishId, remoteUrl: "" };
}

function createMediaPublishService({ repo, resolveOutputFile, dataRoot }) {
  let timer = null;

  function status() {
    const config = credentials();
    return {
      youtube: {
        configured: Boolean(config.youtube.clientId && config.youtube.clientSecret && config.youtube.refreshToken),
        label: config.youtube.label,
        mode: "channel_upload",
      },
      tiktok: {
        configured: Boolean(config.tiktok.accessToken || (
          config.tiktok.clientKey && config.tiktok.clientSecret && config.tiktok.refreshToken
        )),
        label: config.tiktok.label,
        mode: "inbox_draft",
      },
    };
  }

  async function run(item) {
    if (!item || activePublishes.has(item.sid)) return;
    activePublishes.set(item.sid, item.job_sid);
    try {
      const startedAt = new Date().toISOString();
      await repo.updatePublish(item.sid, {
        status: "uploading", progress: 0, started_at: startedAt, updated_at: startedAt,
      });
      let lastWrite = 0;
      const onProgress = (progress) => {
        const now = Date.now();
        if (now - lastWrite < 500 && progress < 100) return;
        lastWrite = now;
        repo.updatePublish(item.sid, {
          progress: Math.max(0, Math.min(100, progress)),
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      };
      const file = await resolveOutputFile(item.job_sid, item.user_id, item.file_index);
      if (!file) throw new Error("The downloaded source file no longer exists.");
      if (!mediaType(file.name).startsWith("video/")) {
        throw new Error("YouTube and TikTok publishing requires a video file.");
      }
      const config = credentials();
      let result;
      if (item.platform === "youtube") {
        if (!status().youtube.configured) throw new Error("YouTube channel credentials are not configured.");
        result = await uploadYouTube(item, file, config.youtube, onProgress);
      } else {
        if (!status().tiktok.configured) throw new Error("TikTok account credentials are not configured.");
        result = await uploadTikTokDraft(item, file, config.tiktok, dataRoot, onProgress);
      }
      const completedAt = new Date().toISOString();
      await repo.updatePublish(item.sid, {
        status: "completed", progress: 100, remote_id: result.remoteId,
        remote_url: result.remoteUrl, completed_at: completedAt, updated_at: completedAt,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      await repo.updatePublish(item.sid, {
        status: "failed", error_message: error.message || String(error),
        completed_at: failedAt, updated_at: failedAt,
      });
    } finally {
      activePublishes.delete(item.sid);
    }
  }

  async function create(input, userId) {
    if (!["youtube", "tiktok"].includes(input.platform)) throw new Error("Select a valid publishing platform.");
    const platform = input.platform;
    const index = Math.max(0, Number(input.file_index) || 0);
    const file = await resolveOutputFile(input.job_sid, userId, index);
    if (!file) throw new Error("Downloaded video file not found.");
    if (!mediaType(file.name).startsWith("video/")) throw new Error("Select a downloaded video file.");
    if (file.size <= 0) throw new Error("The selected video file is empty.");
    if (platform === "tiktok" && !supportsTikTok(file.name)) {
      throw new Error("TikTok upload supports MP4, WebM, or MOV video files.");
    }
    if (platform === "tiktok" && file.size > 4 * 1024 ** 3) {
      throw new Error("TikTok upload supports video files up to 4 GB.");
    }
    const configured = status()[platform];
    if (!configured.configured) throw new Error(`${platform === "youtube" ? "YouTube" : "TikTok"} credentials are not configured.`);
    const now = new Date();
    const requestedAt = input.scheduled_at ? new Date(input.scheduled_at) : now;
    if (!Number.isFinite(requestedAt.getTime())) throw new Error("Invalid scheduled date and time.");
    const scheduledAt = requestedAt > now ? requestedAt : now;
    const createdAt = now.toISOString();
    const item = await repo.createPublish({
      sid: `publish_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id: userId,
      job_sid: text(input.job_sid),
      file_index: index,
      platform,
      account_label: configured.label,
      title: (text(input.title) || path.parse(file.name).name).slice(0, platform === "youtube" ? 100 : 2200),
      description: text(input.description),
      privacy: platform === "youtube" && ["private", "unlisted", "public"].includes(input.privacy) ? input.privacy : "private",
      status: "scheduled",
      progress: 0,
      scheduled_at: scheduledAt.toISOString(),
      started_at: null,
      completed_at: null,
      remote_id: null,
      remote_url: null,
      error_message: null,
      options: { category_id: text(input.category_id, "22") },
      created_at: createdAt,
      updated_at: createdAt,
    });
    if (scheduledAt.getTime() <= Date.now() + 1000) setImmediate(() => run(item));
    return item;
  }

  async function runDue() {
    const due = await repo.listDuePublishes(new Date().toISOString(), 5);
    await Promise.all(due.map(run));
  }

  function startScheduler() {
    if (timer) return;
    timer = setInterval(() => runDue().catch(() => {}), 15_000);
    timer.unref?.();
    setTimeout(() => runDue().catch(() => {}), 1000).unref?.();
  }

  async function cancel(sid, userId) {
    const item = await repo.getPublish(sid, userId);
    if (!item) return null;
    if (item.status !== "scheduled") throw new Error("Only scheduled uploads can be cancelled.");
    return repo.updatePublish(sid, {
      status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }

  return {
    publishingStatus: status,
    createPublish: create,
    listPublishes: (userId, limit) => repo.listPublishes(userId, limit),
    cancelPublish: cancel,
    runDuePublishes: runDue,
    startPublishScheduler: startScheduler,
    hasActivePublishForJob: (jobSid) => [...activePublishes.values()].includes(jobSid),
  };
}

module.exports = { createMediaPublishService, mediaType };
