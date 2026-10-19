// A production worker can outlive a switch to the Mac mini's live Vite server.
// Serve a valid replacement instead of SPA HTML so its update can succeed.
export const retireWorkerSource = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
  })());
});`;

export default function devServiceWorkerRecovery() {
  return {
    name: "dev-service-worker-recovery",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname !== "/sw.js" && pathname !== "/pos/sw.js") return next();
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(retireWorkerSource);
      });
    },
  };
}
