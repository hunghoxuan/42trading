"use strict";

async function handleSpaRequest({ req, res, url, getService, json, requirePermission, getActor }) {
  if (url.pathname !== "/spa" && !url.pathname.startsWith("/spa/")) return false;
  const write = req.method !== "GET";
  if (!requirePermission(req, res, write ? "apis.spa.write" : "apis.spa.read")) return true;
  try {
    const service = await getService();
    const route = url.pathname.slice(4);
    let result;
    if (req.method === "GET" && route === "/bootstrap") result = await service.snapshot();
    else if (req.method === "GET" && route === "/reports") result = await service.report(Object.fromEntries(url.searchParams));
    else {
      const match = route.match(/^\/([a-z_]+)(?:\/(\d+))?$/);
      if (!match || !service.entities.includes(match[1]) || !["POST", "PUT"].includes(req.method) || (req.method === "PUT") !== Boolean(match[2])) {
        json(res, 404, { ok: false, error: "Không tìm thấy chức năng" });
        return true;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 128 * 1024) { const error = new Error("Dữ liệu quá lớn"); error.status = 413; throw error; }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { const error = new Error("JSON không hợp lệ"); error.status = 400; throw error; }
      result = await service.save(match[1], payload, await getActor(req), match[2] ? Number(match[2]) : null);
    }
    json(res, 200, result);
  } catch (error) {
    if (!error.status) console.error("[spa]", error);
    json(res, error.status || 500, { ok: false, error: error.status ? error.message : "Không thể xử lý dữ liệu Spa. Vui lòng thử lại." });
  }
  return true;
}

module.exports = { handleSpaRequest };
