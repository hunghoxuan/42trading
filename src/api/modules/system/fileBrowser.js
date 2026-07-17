"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DUCKDB_WORKER_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "api",
  "modules",
  "42trade",
  "marketData",
  "providers",
  "marketDataDuckdbWorker.js",
);
const TABLE_PREVIEW_LIMIT = 100;
const TEXT_PREVIEW_LIMIT = 250000;

function safeUserId(raw = "") {
  return String(raw || "").trim().replace(/[^A-Za-z0-9_.-]/g, "");
}

function safeRelativePath(raw = "") {
  return String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function ensureChildPath(rootDir, relativePath = "") {
  const safeRelative = safeRelativePath(relativePath);
  const target = path.resolve(rootDir, safeRelative);
  const normalizedRoot = path.resolve(rootDir);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Path escapes root.");
  }
  return { safeRelative, target };
}

function findDefaultUserId(userDataRoot) {
  if (!fs.existsSync(userDataRoot)) return "";
  const entries = fs
    .readdirSync(userDataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  return entries[0] ? entries[0].name : "";
}

function resolveFilesRoot(userDataRoot, userId = "") {
  const resolvedUserId = safeUserId(userId) || findDefaultUserId(userDataRoot);
  const rootDir = path.join(userDataRoot, resolvedUserId);
  return {
    userId: resolvedUserId,
    rootDir,
    label: resolvedUserId ? `data/users/${resolvedUserId}` : "data/users",
  };
}

function resolveBrowserRoot({ scope, userId = "", userDataRoot, serverLogDir, projectRoot }) {
  if (scope === "files") {
    return resolveFilesRoot(userDataRoot, userId);
  }
  if (scope === "logs") {
    return {
      userId: "",
      rootDir: serverLogDir,
      label: path.relative(projectRoot, serverLogDir) || "logs",
    };
  }
  throw new Error("Unsupported browser scope.");
}

function buildDirectoryTree(rootDir, label, currentRelative = "") {
  if (!fs.existsSync(rootDir)) {
    return {
      name: path.basename(label) || label,
      path: "",
      meta: "Not found",
      right: "",
      type: "directory",
      children: [],
    };
  }
  const { target } = ensureChildPath(rootDir, currentRelative);
  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const directoryEntries = entries.filter((entry) => entry.isDirectory());
  const fileCount = entries.filter((entry) => entry.isFile()).length;
  return {
    name: currentRelative ? path.basename(currentRelative) : label,
    path: currentRelative,
    meta: fileCount ? `${fileCount} files` : "folder",
    right: "",
    type: "directory",
    children: directoryEntries.map((entry) => {
      const nextRelative = safeRelativePath(
        path.posix.join(currentRelative.replace(/\\/g, "/"), entry.name),
      );
      return buildDirectoryTree(rootDir, label, nextRelative);
    }),
  };
}

function listFiles(rootDir, relativeDir = "", page = 1, pageSize = 50, q = "") {
  const { safeRelative, target } = ensureChildPath(rootDir, relativeDir);
  if (!fs.existsSync(target)) {
    return { title: safeRelative || "/", items: [], total: 0 };
  }
  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(target, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: safeRelativePath(path.posix.join(safeRelative, entry.name)),
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
        kind:
          path.extname(entry.name).replace(/^\./, "").toLowerCase() || "file",
      };
    })
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const filtered = q
    ? entries.filter((entry) =>
        entry.name.toLowerCase().includes(String(q).toLowerCase()),
      )
    : entries;
  const start = (page - 1) * pageSize;
  return {
    title: safeRelative || "/",
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
  };
}

function detectContentKind(fileName = "") {
  const ext = path.extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
    return "image";
  }
  if (ext === ".csv") return "csv";
  if (ext === ".parquet") return "parquet";
  if (
    [
      ".txt",
      ".json",
      ".log",
      ".md",
      ".markdown",
      ".yaml",
      ".yml",
      ".xml",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".css",
      ".scss",
      ".html",
      ".htm",
    ].includes(ext)
  ) {
    return "text";
  }
  if (
    [
      ".zip",
      ".gz",
      ".tgz",
      ".7z",
      ".rar",
      ".pdf",
      ".exe",
      ".dll",
      ".bin",
      ".db",
      ".sqlite",
      ".mp4",
      ".mov",
      ".avi",
      ".mp3",
      ".wav",
    ].includes(ext)
  ) {
    return "binary";
  }
  return "text";
}

function runDuckDbWorker(command, payload = {}) {
  const payloadFile = path.join(
    os.tmpdir(),
    `system-browser-duckdb-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.json`,
  );
  fs.writeFileSync(payloadFile, JSON.stringify(payload), "utf8");
  try {
    const result = spawnSync(
      process.execPath,
      [DUCKDB_WORKER_PATH, command, `@file:${payloadFile}`],
      {
        cwd: PROJECT_ROOT,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      let message =
        result.stderr || result.stdout || `DuckDB worker failed: ${command}`;
      try {
        const parsed = JSON.parse(result.stderr || "{}");
        message = parsed.error || message;
      } catch {}
      throw new Error(String(message).trim());
    }
    const parsed = JSON.parse(result.stdout || "{}");
    return parsed.result;
  } finally {
    fs.rmSync(payloadFile, { force: true });
  }
}

function looksLikeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return true;
  let suspicious = 0;
  const sampleLength = Math.min(buffer.length, 4096);
  for (let index = 0; index < sampleLength; index += 1) {
    const value = buffer[index];
    if (value === 0) return false;
    const isControl =
      value < 7 || (value > 14 && value < 32 && value !== 9 && value !== 10 && value !== 13);
    if (isControl) suspicious += 1;
  }
  return suspicious / sampleLength < 0.02;
}

function parseDelimitedLine(line = "", delimiter = ",") {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => String(cell || "").trim());
}

function readCsvPreview(target, limit = TABLE_PREVIEW_LIMIT) {
  const raw = fs.readFileSync(target, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, ""))
    .filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter);
  return lines.slice(1, limit + 1).map((line, rowIndex) => {
    const values = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, columnIndex) => {
      const key = header || `column_${columnIndex + 1}`;
      row[key] = values[columnIndex] ?? "";
    });
    if (!headers.length) row.value = line;
    row.__row = rowIndex + 1;
    return row;
  });
}

function readParquetPreview(target, limit = TABLE_PREVIEW_LIMIT) {
  const rows = runDuckDbWorker("readPreviewTable", {
    parquetPath: target,
    limit,
  });
  return Array.isArray(rows) ? rows : [];
}

function readFileContent(rootDir, relativeFile = "") {
  const { safeRelative, target } = ensureChildPath(rootDir, relativeFile);
  const stat = fs.statSync(target);
  const kind = detectContentKind(target);
  if (kind === "image") {
    return {
      kind,
      path: safeRelative,
      name: path.basename(safeRelative),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
      content: "",
    };
  }
  if (kind === "csv") {
    const rows = readCsvPreview(target, TABLE_PREVIEW_LIMIT);
    return {
      kind: "text",
      path: safeRelative,
      name: path.basename(safeRelative),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
      mime_type: "application/json",
      content: rows,
    };
  }
  if (kind === "parquet") {
    const rows = readParquetPreview(target, TABLE_PREVIEW_LIMIT);
    return {
      kind: "text",
      path: safeRelative,
      name: path.basename(safeRelative),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
      mime_type: "application/json",
      content: rows,
    };
  }
  const buffer = fs.readFileSync(target);
  if (!looksLikeTextBuffer(buffer)) {
    return {
      kind: "binary",
      path: safeRelative,
      name: path.basename(safeRelative),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
      content: "",
    };
  }
  const content = buffer.toString("utf8");
  return {
    kind,
    path: safeRelative,
    name: path.basename(safeRelative),
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
    content:
      content.length > TEXT_PREVIEW_LIMIT
        ? `${content.slice(0, TEXT_PREVIEW_LIMIT)}\n\n...truncated...`
        : content,
  };
}

function deleteFile(rootDir, relativeFile = "") {
  const { target } = ensureChildPath(rootDir, relativeFile);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function resolveDownloadFile(rootDir, relativeFile = "") {
  return ensureChildPath(rootDir, relativeFile).target;
}

module.exports = {
  buildDirectoryTree,
  deleteFile,
  listFiles,
  readFileContent,
  resolveBrowserRoot,
  resolveDownloadFile,
};
