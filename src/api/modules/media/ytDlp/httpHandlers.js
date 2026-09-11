"use strict";

const fs = require("fs");

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
      const match = /^\/v2\/media\/yt-dlp\/jobs\/([^/]+)(?:\/(cancel|file))?$/.exec(url.pathname);
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
      if ((req.method === "GET" || req.method === "HEAD") && match[2] === "file") {
        const file = await service.resolveOutputFile(sid, userId, url.searchParams.get("index"));
        if (!file) {
          json(res, 404, { ok: false, error: "FILE_NOT_FOUND" });
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": file.size,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "X-Content-Type-Options": "nosniff",
        });
        if (req.method === "HEAD") res.end();
        else fs.createReadStream(file.path).pipe(res);
        return true;
      }
      json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
      return true;
    } catch (error) {
      json(res, /valid|allowed|supported/i.test(error.message) ? 400 : 500, {
        ok: false,
        error: error.message || String(error),
      });
      return true;
    }
  };
}

module.exports = { createYtDlpHttpHandler };
