import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const apiTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001";

export default defineConfig({
  base: "/pos/",
  plugins: [
    react(),
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
        runtimeCaching: [],
      },
      devOptions: { enabled: true },
    }),
  ],
  server: {
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true }, "/auth": { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true }, "/auth": { target: apiTarget, changeOrigin: true } },
  },
});
