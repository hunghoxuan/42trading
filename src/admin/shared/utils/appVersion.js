export function resolveDisplayedVersion(serverVersion, buildVersion) {
  const server = String(serverVersion || "").trim();
  if (server) return server;
  return String(buildVersion || "").trim();
}
