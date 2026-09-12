"use strict";

const fs = require("fs");
const path = require("path");

const MEDIA_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

function sendFile(req, res, file, { inline = false } = {}) {
  const contentType = MEDIA_TYPES[path.extname(file.name).toLowerCase()] || "application/octet-stream";
  const range = String(req.headers.range || "");
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "X-Content-Type-Options": "nosniff",
  };
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  if (match) {
    start = match[1] ? Number(match[1]) : 0;
    end = match[2] ? Number(match[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= file.size) {
      res.writeHead(416, { "Content-Range": `bytes */${file.size}` });
      res.end();
      return;
    }
    end = Math.min(end, file.size - 1);
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  }
  headers["Content-Length"] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file.path, { start, end }).pipe(res);
}

function createYtDlpHttpHandler({ service, json, readJson, getSession, requirePermission }) {
  return async function handleYtDlpRequest(req, res, url) {
    if (!url.pathname.startsWith("/v2/media/yt-dlp")) return false;
    const write = req.method !== "GET" && req.method !== "HEAD";
    if (!requirePermission(req, res, write ? "apis.media.yt_dlp.write" : "apis.media.yt_dlp.read")) {
      return true;
    }
    const session = getSession(req);
    const userId = String(session.user_id || "default");
    try {
      if (req.method === "GET" && url.pathname === "/v2/media/yt-dlp/status") {
        json(res, 200, { ok: true, runtime: await service.runtimeStatus() });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/v2/media/yt-dlp/jobs") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
        json(res, 200, { ok: true, items: await service.listJobs(userId, limit) });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/v2/media/yt-dlp/jobs") {
        json(res, 202, { ok: true, item: await service.createJob(await readJson(req), userId) });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/v2/media/yt-dlp/publishing/status") {
        json(res, 200, { ok: true, platforms: service.publishingStatus() });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/v2/media/yt-dlp/publishes") {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
        json(res, 200, { ok: true, items: await service.listPublishes(userId, limit) });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/v2/media/yt-dlp/publishes") {
        json(res, 202, { ok: true, item: await service.createPublish(await readJson(req), userId) });
        return true;
      }
      const publishMatch = /^\/v2\/media\/yt-dlp\/publishes\/([^/]+)\/cancel$/.exec(url.pathname);
      if (req.method === "POST" && publishMatch) {
        const item = await service.cancelPublish(decodeURIComponent(publishMatch[1]), userId);
        json(res, item ? 200 : 404, item ? { ok: true, item } : { ok: false, error: "NOT_FOUND" });
        return true;
      }
      const match = /^\/v2\/media\/yt-dlp\/jobs\/([^/]+)(?:\/(cancel|file|preview))?$/.exec(url.pathname);
      if (!match) {
        json(res, 404, { ok: false, error: "NOT_FOUND" });
        return true;
      }
      const sid = decodeURIComponent(match[1]);
      if (req.method === "GET" && !match[2]) {
        const item = await service.getJob(sid, userId);
        json(res, item ? 200 : 404, item ? { ok: true, item } : { ok: false, error: "NOT_FOUND" });
        return true;
      }
      if (req.method === "POST" && match[2] === "cancel") {
        const item = await service.cancelJob(sid, userId);
        json(res, item ? 200 : 404, item ? { ok: true, item } : { ok: false, error: "NOT_FOUND" });
        return true;
      }
      if (req.method === "DELETE" && !match[2]) {
        const deleted = await service.deleteJob(sid, userId);
        json(res, deleted ? 200 : 404, deleted ? { ok: true, deleted: sid } : { ok: false, error: "NOT_FOUND" });
        return true;
      }
      if ((req.method === "GET" || req.method === "HEAD") && match[2] === "file") {
        const file = await service.resolveOutputFile(sid, userId, url.searchParams.get("index"));
        if (!file) {
          json(res, 404, { ok: false, error: "FILE_NOT_FOUND" });
          return true;
        }
        sendFile(req, res, file);
        return true;
      }
      if ((req.method === "GET" || req.method === "HEAD") && match[2] === "preview") {
        const file = await service.resolveOutputFile(sid, userId, url.searchParams.get("index"));
        if (!file) {
          json(res, 404, { ok: false, error: "FILE_NOT_FOUND" });
          return true;
        }
        sendFile(req, res, file, { inline: true });
        return true;
      }
      json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
      return true;
    } catch (error) {
      json(res, /valid|allowed|supported|configured|select|scheduled|not found/i.test(error.message) ? 400 : 500, {
        ok: false,
        error: error.message || String(error),
      });
      return true;
    }
  };
}

module.exports = { createYtDlpHttpHandler };
