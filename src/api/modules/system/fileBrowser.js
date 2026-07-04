"use strict";

const fs = require("fs");
const path = require("path");

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
  return "text";
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
  const buffer = fs.readFileSync(target);
  const content = buffer.toString("utf8");
  return {
    kind,
    path: safeRelative,
    name: path.basename(safeRelative),
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
    content:
      content.length > 250000
        ? `${content.slice(0, 250000)}\n\n...truncated...`
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
