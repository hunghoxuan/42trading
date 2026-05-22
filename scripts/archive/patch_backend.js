const fs = require('fs');
let code = fs.readFileSync('webhook/server.js', 'utf8');

// 1. Add getTableSchema to MT5_BACKEND
code = code.replace(/async listTables\(\) \{/, `async getTableSchema(table) {
      const allowed = await this.listTables();
      if (!allowed.includes(table)) throw new Error(\`Access denied to table: \${table}\`);
      const res = await pool.query(\`
        SELECT column_name, data_type, is_nullable, character_maximum_length, column_default
        FROM information_schema.columns 
        WHERE table_name = $1
        ORDER BY ordinal_position
      \`, [table]);
      return res.rows;
    },
    async listTables() {`);

// 2. Add /mt5/db/schema route
const tablesRouteStr = `  if (req.method === "GET" && url.pathname === "/mt5/db/tables") {`;
const schemaRouteStr = `  if (req.method === "GET" && url.pathname === "/mt5/db/schema") {
    if (!CFG.mt5Enabled) return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const b = await mt5Backend();
      if (!b.getTableSchema) return json(res, 400, { ok: false, error: "Not supported by this backend" });
      const table = envStr(url.searchParams.get("table") || "signals");
      if (table.toLowerCase() === "ui_auth_users") return json(res, 403, { ok: false, error: "table access forbidden" });
      const schema = await b.getTableSchema(table);
      return json(res, 200, { ok: true, table, schema });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/storage/stats") {
    if (!CFG.mt5Enabled) return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const cancelErrorRes = await pool.query(\`SELECT COUNT(*) as c FROM signals WHERE status IN ('CANCEL', 'ERROR', 'CANCELLED')\`);
      const testRes = await pool.query(\`SELECT COUNT(*) as c FROM signals WHERE symbol = 'TEST'\`);
      
      const fs = require('fs');
      const path = require('path');
      let snapshotsSize = 0;
      let snapshotsCount = 0;
      if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
        const files = fs.readdirSync(CHART_SNAPSHOT_DIR);
        snapshotsCount = files.length;
        for (const f of files) {
          try {
            snapshotsSize += fs.statSync(path.join(CHART_SNAPSHOT_DIR, f)).size;
          } catch(e){}
        }
      }
      
      return json(res, 200, {
        ok: true,
        stats: {
          cancelled_error_count: parseInt(cancelErrorRes.rows[0].c),
          test_trades_count: parseInt(testRes.rows[0].c),
          snapshots_count: snapshotsCount,
          snapshots_size_bytes: snapshotsSize
        }
      });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/mt5/storage/cleanup") {
    if (!CFG.mt5Enabled) return json(res, 400, { ok: false, error: "MT5 bridge disabled" });
    if (!requireSystemRoleForUi(req, res)) return;
    try {
      const payload = await readJson(req);
      const target = String(payload.target || "").trim();
      if (!target) return json(res, 400, { ok: false, error: "target is required" });
      
      if (target === 'snapshots') {
        const fs = require('fs');
        const path = require('path');
        let deletedFiles = 0;
        if (fs.existsSync(CHART_SNAPSHOT_DIR)) {
          const files = fs.readdirSync(CHART_SNAPSHOT_DIR);
          for (const f of files) {
            try {
              fs.unlinkSync(path.join(CHART_SNAPSHOT_DIR, f));
              deletedFiles++;
            } catch(e){}
          }
        }
        return json(res, 200, { ok: true, target, deleted_files: deletedFiles });
      } else if (target === 'cancelled_error' || target === 'test_trades') {
        const whereClause = target === 'cancelled_error' ? "status IN ('CANCEL', 'ERROR', 'CANCELLED')" : "symbol = 'TEST'";
        const q = await pool.query(\`SELECT * FROM signals WHERE \${whereClause}\`);
        const rows = q.rows;
        const ids = rows.map(r => String(r.signal_id));
        const removed = await mt5DeleteSignalsByIds(ids);
        const cleanup = await mt5CleanupSignalTradeArtifacts({ signalRows: rows, signalIds: ids });
        return json(res, 200, { ok: true, target, deleted_signals: removed.deleted, logs_deleted: cleanup.logs_deleted, files_deleted: cleanup.files_deleted });
      } else {
        return json(res, 400, { ok: false, error: "unknown target" });
      }
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/mt5/db/tables") {`;

code = code.replace(tablesRouteStr, schemaRouteStr);
fs.writeFileSync('webhook/server.js', code);
console.log("Patched server.js");
