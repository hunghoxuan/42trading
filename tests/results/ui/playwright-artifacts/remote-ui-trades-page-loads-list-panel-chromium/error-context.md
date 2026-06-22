# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: remote-ui.spec.js >> trades page loads list panel
- Location: tests/e2e/remote-ui.spec.js:43:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.logs-list-pane').first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('.logs-list-pane').first()

```

# Page snapshot

```yaml
- main [ref=e4]:
  - generic [ref=e5]:
    - generic [ref=e6]: AUTHENTICATION
    - generic [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]: Email Address
        - textbox "Email Address" [ref=e10]:
          - /placeholder: Enter your email
      - generic [ref=e11]:
        - generic [ref=e12]: Password
        - textbox "Password" [ref=e13]:
          - /placeholder: Enter your password
      - button "🔐 SIGN IN" [ref=e14] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const API_KEY = process.env.API_KEY || "";
  4  | const API_BASE = process.env.BASE_URL || "http://139.59.211.192";
  5  | const UI_EMAIL = process.env.UI_EMAIL || "";
  6  | const UI_PASSWORD = process.env.UI_PASSWORD || "";
  7  | 
  8  | test.beforeEach(async ({ page }) => {
  9  |   await page.addInitScript(([apiKey, apiBase]) => {
  10 |     if (apiKey) {
  11 |       localStorage.setItem("tvbridge_api_key", apiKey);
  12 |     }
  13 |     if (apiBase) {
  14 |       localStorage.setItem("tvbridge_api_base", apiBase);
  15 |     }
  16 |   }, [API_KEY, API_BASE]);
  17 | });
  18 | 
  19 | async function ensureAuthenticated(page) {
  20 |   await page.goto("dashboard");
  21 |   const current = page.url();
  22 |   if (!/\/login(?:[/?#]|$)/i.test(current)) return;
  23 |   if (!UI_EMAIL || !UI_PASSWORD) {
  24 |     throw new Error(
  25 |       "Reached login page. Set UI_EMAIL and UI_PASSWORD env vars for e2e auth.",
  26 |     );
  27 |   }
  28 |   await page.fill('input[type="email"]', UI_EMAIL);
  29 |   await page.fill('input[type="password"]', UI_PASSWORD);
  30 |   await page.click('button[type="submit"]');
  31 |   await page.waitForURL(/\/(?:dashboard)?(?:[?#].*)?$/i, { timeout: 20_000 });
  32 | }
  33 | 
  34 | test("dashboard page loads data", async ({ page }) => {
  35 |   await ensureAuthenticated(page);
  36 |   await page.goto("dashboard");
  37 |   await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/i, { timeout: 20_000 });
  38 |   await expect(page.getByText("Loading dashboard...")).toHaveCount(0);
  39 |   await expect(page.locator(".toolbar-panel").first()).toBeVisible({ timeout: 20_000 });
  40 |   await expect(page.locator(".panel").first()).toBeVisible({ timeout: 20_000 });
  41 | });
  42 | 
  43 | test("trades page loads list panel", async ({ page }) => {
  44 |   await ensureAuthenticated(page);
  45 |   await page.goto("trades");
  46 |   await expect(page).toHaveURL(/\/trades(?:[/?#]|$)/i, { timeout: 20_000 });
  47 |   await expect(page.getByText("Loading trades...")).toHaveCount(0);
> 48 |   await expect(page.locator(".logs-list-pane").first()).toBeVisible({ timeout: 20_000 });
     |                                                         ^ Error: expect(locator).toBeVisible() failed
  49 |   await expect(page.locator(".logs-detail-pane").first()).toBeVisible({ timeout: 20_000 });
  50 | });
  51 | 
```