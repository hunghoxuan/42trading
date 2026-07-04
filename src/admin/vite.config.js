import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import uiPackage from "./package.json";
const T = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001";
const TAILSCALE_HOST = "hunghx.tail02c7f8.ts.net";
const CLOUDFLARE_HOSTS = ".trycloudflare.com";
const EXTRA_ALLOWED_HOSTS = String(
  process.env.VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "",
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(uiPackage.version || ""),
  },
  plugins: [react()],
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
    proxy: {
      "/auth": { target: T, changeOrigin: true },
      "/health": { target: T, changeOrigin: true },
      "/mt5": { target: T, changeOrigin: true },
      "/webhook": { target: T, changeOrigin: true },
      "/sse": { target: T, changeOrigin: true, ws: true },
      "/socket.io": { target: T, changeOrigin: true, ws: true },
      "^/api(?:/|$)": { target: T, changeOrigin: true },
      "^/v2(?:/|$)": { target: T, changeOrigin: true },
    },
  },
});
