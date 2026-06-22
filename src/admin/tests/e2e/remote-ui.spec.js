import { test, expect } from "@playwright/test";

const API_KEY = process.env.API_KEY || "";
const API_BASE = process.env.BASE_URL || "http://139.59.211.192";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([apiKey, apiBase]) => {
    if (apiKey) {
      localStorage.setItem("tvbridge_api_key", apiKey);
    }
    if (apiBase) {
      localStorage.setItem("tvbridge_api_base", apiBase);
    }
  }, [API_KEY, API_BASE]);
});

test("dashboard page loads data", async ({ page }) => {
  await page.goto("dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Loading dashboard...")).toHaveCount(0);
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.getByText("Total Trades")).toBeVisible();
});

test("trades page loads list panel", async ({ page }) => {
  await page.goto("trades");
  await expect(page.getByRole("heading", { name: "Trades" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Loading trades...")).toHaveCount(0);
  await expect(page.locator(".error")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Filters" })).toBeVisible();
});
