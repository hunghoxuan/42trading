import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const prefix = "/downloads/pos-android";
const types = {
  "index.html": "text/html; charset=utf-8",
  "42trade-pos.apk": "application/vnd.android.package-archive",
  "release.json": "application/json; charset=utf-8",
  "SHA256SUMS": "text/plain; charset=utf-8",
};

// Vite's SPA fallback otherwise turns the directory URL into the main app shell,
// and its static MIME table does not identify APK files for Android browsers.
export default function posAndroidDownloads() {
  const configure = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const pathname = req.url?.split("?")[0];
      if (pathname !== prefix && !pathname?.startsWith(prefix + "/")) return next();
      if (pathname === prefix) { res.writeHead(302, { Location: prefix + "/" }); res.end(); return; }
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
      const filename = pathname.slice(prefix.length + 1) || "index.html";
      if (!Object.hasOwn(types, filename)) { res.writeHead(404); res.end(); return; }
      const file = path.join(server.config.publicDir, "downloads", "pos-android", filename);
      try {
        const info = await stat(file);
        res.setHeader("Content-Type", types[filename]);
        res.setHeader("Content-Length", info.size);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (filename.endsWith(".apk")) res.setHeader("Content-Disposition", 'attachment; filename="42trade-pos.apk"');
        if (req.method === "HEAD") { res.end(); return; }
        const stream = createReadStream(file);
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      } catch (error) {
        res.writeHead(error.code === "ENOENT" ? 404 : 500);
        res.end();
      }
    });
  };
  return { name: "pos-android-downloads", configureServer: configure, configurePreviewServer: configure };
}
