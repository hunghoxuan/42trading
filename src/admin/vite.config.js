import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import uiPackage from "./package.json";
const T = process.env.VITE_API_PROXY_TARGET || "http://localhost:3001";
const DB_MANAGER_TARGET =
  process.env.VITE_DB_MANAGER_PROXY_TARGET || "http://127.0.0.1:8088";
const SYSTEM_TOOLS_TARGET =
  process.env.VITE_SYSTEM_TOOLS_PROXY_TARGET || "http://127.0.0.1:8090";
const TAILSCALE_HOST = "hunghx.tail02c7f8.ts.net";
const CLOUDFLARE_HOSTS = ".trycloudflare.com";
const EXTRA_ALLOWED_HOSTS = String(
  process.env.VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "",
)
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

function probeTcpPort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function createMiniappAutoStartPlugin() {
  let booted = false;
  return {
    name: "miniapp-auto-start",
    configureServer(server) {
      if (booted) return;
      booted = true;
      const rootDir = path.resolve(__dirname, "..", "..");
      const services = [
        {
          name: "db-manager",
          host: process.env.DB_MANAGER_HOST || "127.0.0.1",
          port: Number(process.env.DB_MANAGER_PORT || 8088),
          entry: path.resolve(rootDir, "src/apps/db-manager/server.js"),
        },
        {
          name: "system-tools",
          host: process.env.SYSTEM_MINIAPPS_HOST || "127.0.0.1",
          port: Number(process.env.SYSTEM_MINIAPPS_PORT || 8090),
          entry: path.resolve(rootDir, "src/apps/system-tools/server.js"),
        },
      ];
      for (const service of services) {
        if (!Number.isFinite(service.port) || service.port <= 0) continue;
        probeTcpPort(service.host, service.port)
          .then((reachable) => {
            if (reachable) return;
            const child = spawn(process.execPath, [service.entry], {
              cwd: rootDir,
              env: {
                ...process.env,
                DB_MANAGER_HOST:
                  service.name === "db-manager"
                    ? service.host
                    : process.env.DB_MANAGER_HOST,
                DB_MANAGER_PORT:
                  service.name === "db-manager"
                    ? String(service.port)
                    : process.env.DB_MANAGER_PORT,
                SYSTEM_MINIAPPS_HOST:
                  service.name === "system-tools"
                    ? service.host
                    : process.env.SYSTEM_MINIAPPS_HOST,
                SYSTEM_MINIAPPS_PORT:
                  service.name === "system-tools"
                    ? String(service.port)
                    : process.env.SYSTEM_MINIAPPS_PORT,
              },
              stdio: "ignore",
              detached: true,
            });
            child.unref();
            server.config.logger.info(
              `[miniapp-auto-start] starting ${service.name} on ${service.host}:${service.port}`,
              { timestamp: true },
            );
          })
          .catch(() => {});
      }
    },
  };
}
export default defineConfig({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(uiPackage.version || ""),
  },
  plugins: [react(), createMiniappAutoStartPlugin()],
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
      "^/api(?:/|$)": { target: T, changeOrigin: true },
      "/miniapps/db-manager": {
        target: DB_MANAGER_TARGET,
        changeOrigin: true,
        rewrite: (pathValue) =>
          pathValue.replace(/^\/miniapps\/db-manager/, "") || "/",
      },
      "/miniapps/system-tools": {
        target: SYSTEM_TOOLS_TARGET,
        changeOrigin: true,
        rewrite: (pathValue) =>
          pathValue.replace(/^\/miniapps\/system-tools/, "") || "/",
      },
    },
  },
});
