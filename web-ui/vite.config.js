import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET =
  process.env.VITE_API_PROXY_TARGET || "https://trade.mozasolution.com/webhook";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Proxy API/auth/SSE paths to backend so cookies work same-origin
      "/auth": { target: API_TARGET, changeOrigin: true },
      "/health": { target: API_TARGET, changeOrigin: true },
      "/webhook": { target: API_TARGET, changeOrigin: true },
      "/mt5": { target: API_TARGET, changeOrigin: true },
      "/v2": { target: API_TARGET, changeOrigin: true },
      "/sse": { target: API_TARGET, changeOrigin: true, ws: true },
      "/system": { target: API_TARGET, changeOrigin: true },
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
