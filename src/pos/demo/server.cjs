"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const demoDir = path.resolve(__dirname, "../../../.local");
fs.mkdirSync(demoDir, { recursive: true });
process.env.POS_GRANT_KEY_PATH = path.join(demoDir, "pos-demo-grant-key.json");

const { createPosService } = require("../../api/modules/pos/service");
const { handlePosRequest } = require("../../api/modules/pos/httpHandlers");
const actor = { user_id: "pos-demo-cashier", name: "Demo cashier", roles: ["pos_manager"] };

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function startDemoServer() {
  const service = createPosService({ provider: "sqlite", sqlitePath: path.join(demoDir, "pos-demo-system.sqlite") });
  await service.init();
  if (!(await service.catalog()).length) {
    for (const item of [
      { sid: "POS_DEMO_COFFEE", name: "Demo Coffee", sku: "POS-DEMO-1", barcode: "8901234567890", price: 25000, vat: 1000 },
      { sid: "POS_DEMO_WATER", name: "Demo Water", sku: "POS-DEMO-2", barcode: "8901234567891", price: 12000, vat: 0 },
    ]) {
      await service.upsertProduct({ sid: item.sid, name: item.name, sku: item.sku,
        barcodes: [item.barcode], vat_rate_bps: item.vat }, actor);
      await service.setPrice({ product_sid: item.sid, price_minor: item.price }, actor);
      await service.adjustStock({ product_sid: item.sid, delta: 20, reason: "Demo opening stock" }, actor);
    }
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:3101");
    if (req.method === "GET" && url.pathname === "/auth/me") {
      json(res, 200, { ok: true, user: actor });
      return;
    }
    if (url.pathname === "/api/pos") url.pathname = "/pos";
    else if (url.pathname.startsWith("/api/pos/")) url.pathname = url.pathname.slice(4);
    if (await handlePosRequest({ req, res, url, service, json,
      requirePermission: () => true, getActor: () => actor })) return;
    json(res, 404, { ok: false, error: "Not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(3101, "127.0.0.1", resolve);
  });
  return server;
}

module.exports = { startDemoServer };
