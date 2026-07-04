export function formatNonJsonApiResponseError({
  path = "",
  status = 0,
  text = "",
  isDev = false,
} = {}) {
  const responseText = String(text || "");
  const snippet = responseText.slice(0, 100);
  const isBlankBody = responseText.trim().length === 0;
  const normalizedPath = String(path || "");

  if (
    isDev &&
    status >= 500 &&
    isBlankBody &&
    (normalizedPath === "/auth/login" ||
      normalizedPath.startsWith("/auth/") ||
      normalizedPath.startsWith("/api/"))
  ) {
    return "Backend API unavailable. Start src/api on :3001 and try again.";
  }

  return `Server returned non-JSON response (${status}): ${snippet}...`;
}
