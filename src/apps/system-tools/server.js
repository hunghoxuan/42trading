"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const APP_DIR = __dirname;
const TRADING_DIR = process.env.TRADING_DIR || path.resolve(__dirname, "../../..");
const GLOBAL_DATA_DIR = path.join(TRADING_DIR, "data");
const ADMIN_SHARED_CSS_PATH = path.join(TRADING_DIR, "src/shared/styles/admin.css");
const MINIAPP_BRIDGE_CLIENT_PATH = path.join(TRADING_DIR, "src/shared/bridge/miniappBridgeClient.js");
const SHELL_TEMPLATE_PATH = path.join(APP_DIR, "shell.html");
const CLIENT_JS_PATH = path.join(APP_DIR, "client.js");
const CSS_PATH = path.join(APP_DIR, "system-tools.css");
const ENV_PATH = path.join(TRADING_DIR, "src/api/.env");

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function loadEnvFile() {
  const vars = {};
  if (!fs.existsSync(ENV_PATH)) return vars;
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    vars[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return vars;
}

const ENV = loadEnvFile();
const SERVER_LOG_DIR = process.env.SERVER_LOG_DIR || ENV.SERVER_LOG_DIR || path.join(GLOBAL_DATA_DIR, "logs");
const API_BASE_URL = (process.env.SYSTEM_MINIAPPS_API_BASE || ENV.SYSTEM_MINIAPPS_API_BASE || "http://127.0.0.1:3001").replace(/\/+$/, "");
const MAIN_APP_URL = (process.env.SYSTEM_MINIAPPS_MAIN_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || ENV.ADMIN_KEY || ENV.SIGNAL_API_KEY || "";

const ADMIN_SHARED_CSS = readText(ADMIN_SHARED_CSS_PATH);
const MINIAPP_BRIDGE_CLIENT = readText(MINIAPP_BRIDGE_CLIENT_PATH);
const SHELL_HTML = readText(SHELL_TEMPLATE_PATH);
const APP_CSS = readText(CSS_PATH);

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res) {
  const basePathScript = `
      function resolveMiniAppBasePath() {
        try {
          var params = new URLSearchParams(window.location.search);
          var fromQuery = String(params.get("basePath") || "").trim();
          if (fromQuery) return trimTrailingSlashes(fromQuery);
        } catch {}
        var marker = "/miniapps/system-tools";
        var pathname = String(window.location.pathname || "");
        var idx = pathname.indexOf(marker);
        if (idx >= 0) return pathname.slice(0, idx + marker.length);
        return "";
      }
  `;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>42trade System Tools</title>
  <style>
${ADMIN_SHARED_CSS}
${APP_CSS}
  </style>
</head>
<body>
${SHELL_HTML}
  <script>
${MINIAPP_BRIDGE_CLIENT}
  </script>
  <script>
    (function () {
      function trimTrailingSlashes(value) {
        var out = String(value || "");
        while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
        return out;
      }
${basePathScript}
      function getHostBridge() {
        return window.__42tradeMiniAppBridge || null;
      }
      function isEmbeddedQueryMode() {
        try {
          var params = new URLSearchParams(window.location.search);
          return params.get("bridge") === "main" || params.get("embedded") === "1";
        } catch {
          return false;
        }
      }
      function resolveMainAppUrl() {
        try {
          const params = new URLSearchParams(window.location.search);
          const fromQuery = String(params.get("mainAppUrl") || "").trim();
          if (fromQuery) {
            localStorage.setItem("main_app_url", fromQuery);
            return trimTrailingSlashes(fromQuery);
          }
        } catch {}
        try {
          const fromStorage = String(localStorage.getItem("main_app_url") || "").trim();
          if (fromStorage) return trimTrailingSlashes(fromStorage);
        } catch {}
        return ${JSON.stringify(MAIN_APP_URL)};
      }
      function redirectToMainLogin() {
        const returnUrl = encodeURIComponent(window.location.href);
        window.location.assign(resolveMainAppUrl() + "/login?return_url=" + returnUrl);
      }
      function ensureStandaloneAuth() {
        const bridge = getHostBridge();
        if (bridge?.isEmbedded?.() || isEmbeddedQueryMode()) return Promise.resolve(true);
        return new Promise((resolve) => {
          let settled = false;
          let authFrame = null;
          const mainAppUrl = resolveMainAppUrl();
          const expectedOrigin = new URL(mainAppUrl).origin;
          const timeoutId = window.setTimeout(() => finish(false), 3000);
          function cleanup() {
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", onMessage);
            if (authFrame && authFrame.parentNode) authFrame.parentNode.removeChild(authFrame);
          }
          function finish(ok) {
            if (settled) return;
            settled = true;
            cleanup();
            if (ok) resolve(true);
            else redirectToMainLogin();
          }
          function onMessage(event) {
            if (event.origin !== expectedOrigin) return;
            const data = event.data || {};
            if (data.source !== "42trade-auth-probe") return;
            finish(!!data.ok);
          }
          window.addEventListener("message", onMessage);
          authFrame = document.createElement("iframe");
          authFrame.style.display = "none";
          authFrame.src = mainAppUrl + "/bridge/auth-probe?parent_origin=" + encodeURIComponent(window.location.origin);
          document.body.appendChild(authFrame);
        });
      }
      ensureStandaloneAuth().then(function () {
        var script = document.createElement("script");
        script.src = (resolveMiniAppBasePath() || "") + "/internal/client.js";
        script.async = false;
        document.body.appendChild(script);
      }).catch(function () {
        redirectToMainLogin();
      });
    })();
  </script>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

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

function findDefaultUserId() {
  const usersRoot = path.join(GLOBAL_DATA_DIR, "users");
  if (!fs.existsSync(usersRoot)) return "";
  const entries = fs.readdirSync(usersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return entries[0] ? entries[0].name : "";
}

function resolveFilesRoot(userId = "") {
  const resolvedUserId = safeUserId(userId) || findDefaultUserId();
  const rootDir = path.join(GLOBAL_DATA_DIR, "users", resolvedUserId);
  return {
    userId: resolvedUserId,
    rootDir,
    label: resolvedUserId ? `data/users/${resolvedUserId}` : "data/users",
  };
}

function resolveBrowserRoot(scope, userId = "") {
  if (scope === "files") return resolveFilesRoot(userId);
  if (scope === "logs") {
    return {
      userId: "",
      rootDir: SERVER_LOG_DIR,
      label: path.relative(TRADING_DIR, SERVER_LOG_DIR) || "logs",
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
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const directoryEntries = entries.filter((entry) => entry.isDirectory());
  const fileCount = entries.filter((entry) => entry.isFile()).length;
  return {
    name: currentRelative ? path.basename(currentRelative) : label,
    path: currentRelative,
    meta: fileCount ? `${fileCount} files` : "folder",
    right: "",
    type: "directory",
    children: [
      ...directoryEntries.map((entry) => {
        const nextRelative = safeRelativePath(path.posix.join(currentRelative.replace(/\\/g, "/"), entry.name));
        return buildDirectoryTree(rootDir, label, nextRelative);
      }),
    ],
  };
}

function listFiles(rootDir, relativeDir = "", page = 1, pageSize = 50, q = "") {
  const { safeRelative, target } = ensureChildPath(rootDir, relativeDir);
  if (!fs.existsSync(target)) {
    return { title: safeRelative || "/", items: [], total: 0 };
  }
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(target, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: safeRelativePath(path.posix.join(safeRelative, entry.name)),
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
        kind: path.extname(entry.name).replace(/^\./, "").toLowerCase() || "file",
      };
    })
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const filtered = q
    ? entries.filter((entry) => entry.name.toLowerCase().includes(String(q).toLowerCase()))
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
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
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
    content: content.length > 250000 ? `${content.slice(0, 250000)}\n\n...truncated...` : content,
  };
}

function deleteFile(rootDir, relativeFile = "") {
  const { target } = ensureChildPath(rootDir, relativeFile);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function streamDownload(res, rootDir, relativeFile = "") {
  const { target } = ensureChildPath(rootDir, relativeFile);
  const filename = path.basename(target);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  fs.createReadStream(target).pipe(res);
}

function requestExternal(pathname, options = {}) {
  const target = new URL(`${API_BASE_URL}${pathname}`);
  const body = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000) || 15000);
  const headers = Object.assign(
    {
      Accept: "application/json",
    },
    options.headers || {},
  );
  if (ADMIN_KEY && !headers["x-api-key"]) headers["x-api-key"] = ADMIN_KEY;
  if (body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (body) headers["Content-Length"] = String(body.length);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: options.method || (body ? "POST" : "GET"),
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const data = raw ? JSON.parse(raw) : {};
            if (response.statusCode >= 400) {
              reject(new Error(data?.error || `HTTP ${response.statusCode}`));
              return;
            }
            resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Upstream request timed out."));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildCacheDeleteBody(payload = {}) {
  if (payload.all) return { key: "", source: "" };
  return {
    key: String(payload.key || "").trim(),
    source: String(payload.source || "").trim(),
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (req.method === "GET" && ["/files", "/logs", "/health", "/cache"].includes(url.pathname)) {
      return sendHtml(res);
    }

    if (req.method === "GET" && url.pathname === "/internal/client.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(readText(CLIENT_JS_PATH));
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/browser/tree") {
      const scope = String(url.searchParams.get("scope") || "files").trim().toLowerCase();
      const userId = String(url.searchParams.get("userId") || "").trim();
      const root = resolveBrowserRoot(scope, userId);
      return sendJson(res, 200, {
        ok: true,
        tree: buildDirectoryTree(root.rootDir, root.label, ""),
        initialPath: "",
        meta: root.label,
      });
    }

    if (req.method === "GET" && url.pathname === "/internal/browser/list") {
      const scope = String(url.searchParams.get("scope") || "files").trim().toLowerCase();
      const userId = String(url.searchParams.get("userId") || "").trim();
      const dir = String(url.searchParams.get("dir") || "").trim();
      const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
      const pageSize = Math.max(1, Math.min(200, Number(url.searchParams.get("pageSize") || 50) || 50));
      const q = String(url.searchParams.get("q") || "").trim();
      const root = resolveBrowserRoot(scope, userId);
      return sendJson(res, 200, { ok: true, ...listFiles(root.rootDir, dir, page, pageSize, q) });
    }

    if (req.method === "GET" && url.pathname === "/internal/browser/content") {
      const scope = String(url.searchParams.get("scope") || "files").trim().toLowerCase();
      const userId = String(url.searchParams.get("userId") || "").trim();
      const file = String(url.searchParams.get("file") || "").trim();
      const root = resolveBrowserRoot(scope, userId);
      return sendJson(res, 200, { ok: true, ...readFileContent(root.rootDir, file) });
    }

    if (req.method === "POST" && url.pathname === "/internal/browser/delete") {
      const body = await readJson(req);
      const root = resolveBrowserRoot(String(body.scope || "files").trim().toLowerCase(), String(body.userId || "").trim());
      deleteFile(root.rootDir, String(body.file || "").trim());
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/internal/browser/download") {
      const scope = String(url.searchParams.get("scope") || "files").trim().toLowerCase();
      const userId = String(url.searchParams.get("userId") || "").trim();
      const file = String(url.searchParams.get("file") || "").trim();
      const root = resolveBrowserRoot(scope, userId);
      return streamDownload(res, root.rootDir, file);
    }

    if (req.method === "GET" && url.pathname === "/internal/health") {
      return sendJson(res, 200, await requestExternal("/health"));
    }

    if (req.method === "GET" && url.pathname === "/internal/cache/list") {
      return sendJson(res, 200, await requestExternal("/api/system/cache"));
    }

    if (req.method === "GET" && url.pathname === "/internal/cache/detail") {
      const key = String(url.searchParams.get("key") || "").trim();
      const source = String(url.searchParams.get("source") || "memory").trim();
      return sendJson(
        res,
        200,
        await requestExternal(`/api/system/cache?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`),
      );
    }

    if (req.method === "POST" && url.pathname === "/internal/cache/delete") {
      const body = await readJson(req);
      const payload = buildCacheDeleteBody(body);
      return sendJson(
        res,
        200,
        await requestExternal(
          `/api/system/cache?key=${encodeURIComponent(payload.key)}&source=${encodeURIComponent(payload.source)}`,
          { method: "DELETE" },
        ),
      );
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const host = process.env.SYSTEM_MINIAPPS_HOST || "127.0.0.1";
const port = Number(process.env.SYSTEM_MINIAPPS_PORT || 8090);

server.listen(port, host, () => {
  console.log(`[system-tools] http://${host}:${port}`);
});
