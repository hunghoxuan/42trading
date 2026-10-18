import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import uiPackage from "./package.json";
import posAndroidDownloads from "./posAndroidDownloads.js";
const T = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001";
const TAILSCALE_HOST = "hunghx.tail02c7f8.ts.net";
const CLOUDFLARE_HOSTS = ".trycloudflare.com";
const EXTRA_ALLOWED_HOSTS = String(
  process.env.VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "",
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const apiProxy = {
  "/auth": { target: T, changeOrigin: true },
  "/health": { target: T, changeOrigin: true },
  "/mt5": { target: T, changeOrigin: true },
  "/webhook": { target: T, changeOrigin: true },
  "/sse": { target: T, changeOrigin: true, ws: true },
  "/socket.io": { target: T, changeOrigin: true, ws: true },
  "^/api(?:/|$)": { target: T, changeOrigin: true },
  "^/v2(?:/|$)": { target: T, changeOrigin: true },
};

export default defineConfig({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(uiPackage.version || ""),
  },
  plugins: [
    react(),
    posAndroidDownloads(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "42Trade",
        short_name: "42Trade",
        description: "42Trade trading, payments, and point of sale",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [
          { src: "/logo/payhub-p-pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/logo/payhub-p-pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/logo/payhub-p-exact.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      includeAssets: ["logo/payhub-p-pwa-192.png", "logo/payhub-p-pwa-512.png", "logo/payhub-p-exact.svg"],
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/pos\//, /^\/mt5\//, /^\/downloads(?:\/|$)/],
        globPatterns: ["**/*.{js,css,html}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: /\.(?:wasm|onnx)(?:\?.*)?$/,
          handler: "CacheFirst",
          options: { cacheName: "pos-photo-model-v1", expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } },
        }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
      "@radix-ui/react-dialog": path.resolve(
        __dirname,
        "node_modules/@radix-ui/react-dialog",
      ),
      "@radix-ui/react-dropdown-menu": path.resolve(
        __dirname,
        "node_modules/@radix-ui/react-dropdown-menu",
      ),
      "@radix-ui/react-tooltip": path.resolve(
        __dirname,
        "node_modules/@radix-ui/react-tooltip",
      ),
      "@tanstack/react-table": path.resolve(
        __dirname,
        "node_modules/@tanstack/react-table",
      ),
      "@ai-sdk/react": path.resolve(__dirname, "node_modules/@ai-sdk/react"),
      ai: path.resolve(__dirname, "node_modules/ai"),
      "lightweight-charts": path.resolve(
        __dirname,
        "node_modules/lightweight-charts",
      ),
      "react-virtuoso": path.resolve(__dirname, "node_modules/react-virtuoso"),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    allowedHosts: [TAILSCALE_HOST, CLOUDFLARE_HOSTS, ...EXTRA_ALLOWED_HOSTS],
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
});
