"use strict";

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const { startDemoServer } = require("./server.cjs");

async function main() {
  const api = await startDemoServer();
  const cwd = path.resolve(__dirname, "..");
  const viteBin = path.resolve(cwd, "node_modules/vite/bin/vite.js");
  const env = { ...process.env, VITE_API_PROXY_TARGET: "http://127.0.0.1:3101", VITE_POS_DEMO: "1" };
  const build = spawnSync(process.execPath, [viteBin, "build"], { cwd, env, stdio: "inherit" });
  if (build.status !== 0) {
    api.close();
    throw new Error("POS demo build failed");
  }
  const vite = spawn(process.execPath, [viteBin, "preview",
    "--host", "127.0.0.1", "--port", "3002", "--strictPort"], {
    cwd, env,
    stdio: "inherit",
  });
  console.log("POS demo: http://127.0.0.1:3002/pos/ (sample data in .local/pos-demo-system.sqlite)");
  const stop = () => { vite.kill("SIGTERM"); api.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  vite.once("exit", (code) => { api.close(); process.exitCode = code || 0; });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
