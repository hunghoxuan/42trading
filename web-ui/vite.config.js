import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const T = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000, strictPort: true,
    proxy: {
      "/auth": { target: T, changeOrigin: true },
      "/health": { target: T, changeOrigin: true },
      "/webhook": { target: T, changeOrigin: true },
      "/mt5": { target: T, changeOrigin: true },
      "/v2": { target: T, changeOrigin: true },
      "/sse": { target: T, changeOrigin: true, ws: true },
      "/system": { target: T, changeOrigin: true },
      "/api": { target: T, changeOrigin: true },
    },
  },
});
