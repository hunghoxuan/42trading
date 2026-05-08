import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@v2": path.resolve(__dirname, "../../web-ui/src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v2": "https://trade.mozasolution.com",
      "/auth": "https://trade.mozasolution.com",
      "/health": "https://trade.mozasolution.com",
    },
  },
});
