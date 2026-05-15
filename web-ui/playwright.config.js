import { defineConfig } from "@playwright/test";

const rawBaseUrl = process.env.UI_URL || "https://trade.mozasolution.com/ui";
const normalizedBaseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;
const includeWebkit = String(process.env.PW_INCLUDE_WEBKIT || "")
  .trim()
  .toLowerCase();
const projects = [
  {
    name: "chromium",
    use: { browserName: "chromium" },
  },
];
if (includeWebkit === "1" || includeWebkit === "true" || includeWebkit === "yes") {
  projects.push({
    name: "safari",
    use: { browserName: "webkit" },
  });
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: normalizedBaseUrl,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects,
});
