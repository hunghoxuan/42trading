import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const T = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";
const TAILSCALE_HOST = "hunghx.tail02c7f8.ts.net";
const CLOUDFLARE_HOSTS = ".trycloudflare.com";
const EXTRA_ALLOWED_HOSTS = String(
  process.env.VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "",
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    allowedHosts: [TAILSCALE_HOST, CLOUDFLARE_HOSTS, ...EXTRA_ALLOWED_HOSTS],
    proxy: {
      "/auth": { target: T, changeOrigin: true },
      "/health": { target: T, changeOrigin: true },
      "/webhook": { target: T, changeOrigin: true },
      "/mt5": { target: T, changeOrigin: true },
      "/v2": { target: T, changeOrigin: true },
      "/sse": { target: T, changeOrigin: true, ws: true },
      "/api": { target: T, changeOrigin: true },
    },
  },
});
