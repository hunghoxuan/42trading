import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001";
const adminTarget = process.env.VITE_ADMIN_PROXY_TARGET || "http://127.0.0.1:3000";

// A previously installed production/demo worker can keep serving cached POS
// assets even after Vite starts. Replace it in development and return control
// to the live dev server.
const retireStalePosWorker: Plugin = {
  name: "retire-stale-pos-worker",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] === "/pos-reset") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(`<!doctype html><title>Refreshing POS</title><p>Refreshing POS…</p>
<script>
(async () => {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter(registration =>
    new URL(registration.scope).pathname === "/pos/").map(registration => registration.unregister()));
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.includes("/pos/")).map(name => caches.delete(name)));
  location.replace("/pos/");
})().catch(error => { document.querySelector("p").textContent = String(error); });
</script>`);
        return;
      }
      if (req.url?.split("?")[0] !== "/pos/sw.js") return next();
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(`self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(window => window.navigate(window.url)));
  })());
});`);
    });
  },
};

export default defineConfig({
  base: "/pos/",
  plugins: [
    react(),
    retireStalePosWorker,
    VitePWA({
      registerType: "prompt",
      scope: "/pos/",
      manifest: {
        name: "42Trade POS",
        short_name: "42Trade POS",
        description: "42Trade point of sale",
        start_url: "/pos/",
        scope: "/pos/",
        display: "standalone",
        background_color: "#101820",
        theme_color: "#101820",
        icons: [{ src: "/pos/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      includeAssets: ["icon.svg"],
      workbox: {
        navigateFallback: "/pos/index.html",
        navigateFallbackAllowlist: [/^\/pos(?:\/|$)/],
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        runtimeCaching: [{
          urlPattern: /\.(?:wasm|onnx)(?:\?.*)?$/,
          handler: "CacheFirst",
          options: { cacheName: "pos-photo-model-v1", expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } },
        }],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true }, "/auth": { target: apiTarget, changeOrigin: true }, "/pay42": { target: adminTarget, changeOrigin: true } },
  },
  preview: {
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true }, "/auth": { target: apiTarget, changeOrigin: true }, "/pay42": { target: adminTarget, changeOrigin: true } },
  },
});
