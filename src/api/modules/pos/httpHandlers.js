"use strict";

const { PosError } = require("./service");

async function readPosJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024) throw new PosError("POS request is too large", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PosError("Invalid JSON request"); }
}

async function handlePosRequest(context) {
  const { req, res, url, service, json, requirePermission, getActor } = context;
  const pathname = url.pathname;
  if (pathname !== "/pos" && !pathname.startsWith("/pos/")) return false;
  const method = req.method;
  const route = pathname.slice(4) || "/";
  const write = method !== "GET" && method !== "HEAD";
  let permission = write ? "apis.pos.sales.write" : "apis.pos.read";
  if (write && (route === "/products" || /^\/products\/[^/]+/.test(route))) permission = "apis.pos.catalog.write";
  if (write && route === "/prices") permission = "apis.pos.price.write";
  if (write && route === "/stock/movements") permission = "apis.pos.stock.write";
  if (write && /^\/stock\/counts/.test(route)) permission = "apis.pos.stock.write";
  if (write && route === "/offline/allocations") permission = "apis.pos.offline.allocate";
  if (write && (/^\/sales\/[^/]+\/(returns|void)$/.test(route))) permission = "apis.pos.refunds.write";
  if (write && /^\/shifts\/[^/]+\/close$/.test(route)) permission = "apis.pos.shifts.write";
  if (write && (route === "/imports" || route === "/imports/preview")) permission = "apis.pos.catalog.write";
  if (route === "/images/recognize" || route === "/scan/resolve") permission = "apis.pos.read";
  if (!requirePermission(req, res, permission)) return true;

  try {
    const actor = await getActor(req, url);
    const payload = write ? await readPosJson(req) : {};
    let output;
    if (route === "/products" && method === "GET") {
      output = { ok: true, items: await service.catalog(url.searchParams.get("device_id") || "",
        url.searchParams.get("include_archived") === "1") };
    } else if (route === "/products" && method === "POST") {
      output = await service.upsertProduct(payload, actor);
    } else if (/^\/products\/[^/]+\/image$/.test(route) && method === "PUT") {
      output = await service.setProductImage({ sid: decodeURIComponent(route.slice(10, -6)), image: payload.image });
    } else if (/^\/products\/[^/]+$/.test(route) && method === "PATCH") {
      output = await service.upsertProduct({ ...payload, sid: decodeURIComponent(route.slice(10)) }, actor);
    } else if (/^\/products\/[^/]+\/archive$/.test(route) && method === "POST") {
      const sid = decodeURIComponent(route.slice(10, -8));
      const current = (await service.catalog()).find((item) => item.sid === sid);
      if (!current) throw new PosError("Product not found", 404);
      output = await service.upsertProduct({ ...current, status: "ARCHIVED" }, actor);
    } else if (route === "/prices" && method === "PUT") {
      output = await service.setPrice(payload, actor);
    } else if (route === "/stock/movements" && method === "POST") {
      output = await service.adjustStock(payload, actor);
    } else if (route === "/stock/counts" && method === "GET") {
      output = { ok: true, items: await service.stockCounts() };
    } else if (route === "/stock/counts" && method === "POST") {
      output = await service.createStockCount(actor);
    } else if (/^\/stock\/counts\/[^/]+\/submit$/.test(route) && method === "POST") {
      output = await service.submitStockCount({ ...payload, count_sid: decodeURIComponent(route.slice(14, -7)) }, actor);
    } else if (/^\/stock\/counts\/[^/]+\/post$/.test(route) && method === "POST") {
      output = await service.postStockCount({ ...payload, count_sid: decodeURIComponent(route.slice(14, -5)) }, actor);
    } else if (route === "/devices/pair" && method === "POST") {
      output = await service.pairDevice(payload, actor);
    } else if (route === "/offline/allocations" && method === "PUT") {
      output = await service.allocateStock(payload, actor);
    } else if (route === "/offline/bootstrap" && method === "GET") {
      output = await service.bootstrap(url.searchParams.get("device_id"), actor);
    } else if (route === "/offline/sales/sync" && method === "POST") {
      output = await service.syncSale(payload, actor);
    } else if (route === "/sales/checkout" && method === "POST") {
      output = await service.checkout(payload, actor);
    } else if (/^\/sales\/[^/]+\/returns$/.test(route) && method === "POST") {
      output = await service.refundSale({ ...payload, sale_sid: decodeURIComponent(route.slice(7, -8)) }, actor);
    } else if (/^\/sales\/[^/]+\/void$/.test(route) && method === "POST") {
      output = await service.refundSale({ ...payload, sale_sid: decodeURIComponent(route.slice(7, -5)) }, actor, true);
    } else if (route === "/sales" && method === "GET") {
      output = { ok: true, items: await service.sales(url.searchParams.get("limit") || 100) };
    } else if (route === "/shifts" && method === "GET") {
      output = { ok: true, items: await service.shifts() };
    } else if (route === "/shifts/open" && method === "POST") {
      output = await service.openShift(payload, actor);
    } else if (/^\/shifts\/[^/]+\/close$/.test(route) && method === "POST") {
      output = await service.closeShift({ ...payload, shift_sid: decodeURIComponent(route.slice(8, -6)) }, actor);
    } else if (route === "/dashboard" && method === "GET") {
      output = await service.dashboard();
    } else if (route === "/reports/sales" && method === "GET") {
      output = await service.reportSales(Object.fromEntries(url.searchParams));
    } else if (route === "/imports/preview" && method === "POST") {
      output = await service.previewImport(payload);
    } else if (route === "/imports" && method === "POST") {
      output = await service.commitImport(payload, actor);
    } else if (/^\/exports\/(products|sales|returns|shifts)\.csv$/.test(route) && method === "GET") {
      const csv = await service.exportCsv(route.split("/")[2].replace(".csv", ""));
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=pos-" + route.split("/")[2],
        "Cache-Control": "no-store" });
      res.end(csv);
      return true;
    } else if (route === "/scan/resolve" && method === "POST") {
      const code = String(payload.code || "").trim();
      if (!code) throw new PosError("Code is required");
      const items = (await service.catalog()).filter((product) =>
        product.sku === code || product.sid === code || product.barcodes.includes(code));
      output = { ok: true, items };
    } else if (route === "/images/recognize" && method === "POST") {
      output = await service.recognizeImage(payload);
    } else if (route === "/cash/recognize" && method === "POST") {
      output = await service.recognizeCash(payload, actor);
    } else {
      json(res, 404, { ok: false, error: "NOT_FOUND" });
      return true;
    }
    json(res, 200, output);
  } catch (error) {
    json(res, error.status || 400, { ok: false, error: error.message || String(error) });
  }
  return true;
}

module.exports = { handlePosRequest };
