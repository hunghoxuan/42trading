"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function escapeSqlString(value) {
  return String(value || "").replace(/'/g, "''");
}

function ensureDir(dir) {
  if (!dir) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function connectDuckDb(dbPath) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(dbPath || ":memory:");
  return instance.connect();
}

function resolveWorkerDuckDbPath(payload = {}) {
  const requested = String(payload.duckdbPath || "").trim();
  const mode = String(process.env.BARS_DUCKDB_WORKER_MODE || "memory")
    .trim()
    .toLowerCase();
  if (mode === "file" && requested) return requested;
  return ":memory:";
}

async function readParquet(payload = {}) {
  const parquetPath = String(payload.parquetPath || "").trim();
  const duckdbPath = resolveWorkerDuckDbPath(payload);
  const requestedLimit = Number(payload.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.min(requestedLimit, 5000))
      : null;
  const requestedEndTimeSec = Number(payload.endTimeSec);
  const endTimeSec =
    Number.isFinite(requestedEndTimeSec) && requestedEndTimeSec > 0
      ? Math.floor(requestedEndTimeSec)
      : null;
  if (!parquetPath || !fs.existsSync(parquetPath)) return [];
  const connection = await connectDuckDb(duckdbPath);
  try {
    const baseSelect = `
      SELECT
        CAST(time AS BIGINT) AS time,
        CAST(open AS DOUBLE) AS open,
        CAST(high AS DOUBLE) AS high,
        CAST(low AS DOUBLE) AS low,
        CAST(close AS DOUBLE) AS close,
        CAST(COALESCE(volume, 0) AS DOUBLE) AS volume
      FROM read_parquet('${escapeSqlString(parquetPath)}')
      ${endTimeSec !== null ? `WHERE CAST(time AS BIGINT) <= ${endTimeSec}` : ""}
    `;
    const sql =
      limit === null
        ? `${baseSelect}\nORDER BY time ASC`
        : `
          SELECT * FROM (
            ${baseSelect}
            ORDER BY time DESC
            LIMIT ${limit}
          )
          ORDER BY time ASC
        `;
    const reader = await connection.runAndReadAll(sql);
    const rows = reader.getRowObjects().map((row) => ({
      time: Number(row.time),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume || 0),
    }));
    return rows;
  } finally {
    connection.closeSync();
  }
}

async function readPreviewTable(payload = {}) {
  const parquetPath = String(payload.parquetPath || "").trim();
  const duckdbPath = resolveWorkerDuckDbPath(payload);
  const requestedLimit = Number(payload.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.min(requestedLimit, 500))
      : 100;
  if (!parquetPath || !fs.existsSync(parquetPath)) return [];
  const connection = await connectDuckDb(duckdbPath);
  try {
    const sql = `
      SELECT *
      FROM read_parquet('${escapeSqlString(parquetPath)}')
      LIMIT ${limit}
    `;
    const reader = await connection.runAndReadAll(sql);
    return reader.getRowObjects();
  } finally {
    connection.closeSync();
  }
}

async function writeParquet(payload = {}) {
  const parquetPath = String(payload.parquetPath || "").trim();
  const duckdbPath = resolveWorkerDuckDbPath(payload);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!parquetPath) return { wrote: false };
  ensureDir(path.dirname(parquetPath));
  const tmpInput = path.join(
    os.tmpdir(),
    `bars-input-${process.pid}-${Date.now()}.json`,
  );
  const tmpParquet = `${parquetPath}.tmp-${process.pid}-${Date.now()}.parquet`;
  fs.writeFileSync(tmpInput, JSON.stringify(rows), "utf8");
  const connection = await connectDuckDb(duckdbPath);
  try {
    const createSql = `
      CREATE OR REPLACE TEMP TABLE bars_input AS
      SELECT
        CAST(time AS BIGINT) AS time,
        CAST(open AS DOUBLE) AS open,
        CAST(high AS DOUBLE) AS high,
        CAST(low AS DOUBLE) AS low,
        CAST(close AS DOUBLE) AS close,
        CAST(COALESCE(volume, 0) AS DOUBLE) AS volume
      FROM read_json_auto('${escapeSqlString(tmpInput)}')
    `;
    await connection.run(createSql);
    const copySql = `
      COPY (
        SELECT time, open, high, low, close, volume
        FROM bars_input
        ORDER BY time ASC
      )
      TO '${escapeSqlString(tmpParquet)}'
      (FORMAT PARQUET)
    `;
    await connection.run(copySql);
    fs.renameSync(tmpParquet, parquetPath);
    return { wrote: true, rows: rows.length };
  } finally {
    connection.closeSync();
    fs.rmSync(tmpInput, { force: true });
    fs.rmSync(tmpParquet, { force: true });
  }
}

async function main() {
  const command = String(process.argv[2] || "").trim();
  const rawPayload = String(process.argv[3] || "").trim();
  let payload = {};
  if (rawPayload.startsWith("@file:")) {
    payload = JSON.parse(
      fs.readFileSync(rawPayload.slice("@file:".length), "utf8") || "{}",
    );
  } else if (rawPayload) {
    payload = JSON.parse(Buffer.from(rawPayload, "base64").toString("utf8"));
  }
  const commands = {
    readParquet,
    readPreviewTable,
    writeParquet,
  };
  if (!commands[command]) {
    throw new Error(`Unsupported DuckDB worker command: ${command}`);
  }
  const result = await commands[command](payload);
  process.stdout.write(JSON.stringify({ ok: true, result }));
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: error?.message || String(error),
    }),
  );
  process.exit(1);
});
