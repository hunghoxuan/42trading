# TICKET-2026-05-16-01: Fix Global Console JSON Syntax Error

## Image Analysis
- **Image Content**: A screenshot of a web inspector (Chrome DevTools).
- **Text Observed**:
  - `<!doctype html>` (Line 1)
  - `<html lang="en">` (Line 2)
  - `<head>` (Line 3)
  - `<title>MT5 Dashboard</title>` (Line 6)
  - Error indicator (red wavy line) on line 1.
  - Tab title: `VM454`.
- **User Description**: "Uncaught (in promise) SyntaxError: Unexpected token '<', \"<!doctype \"... is not valid JSON"
- **Context**: This error occurs globally on every page, indicating a recurring background fetch or a global component initialization.

## Analysis
The application is making network requests (likely via `fetch`) and attempting to parse the responses as JSON using `.json()` or `JSON.parse()`. However, the server is returning an HTML document (a `<!doctype html>` boilerplate), which usually signifies:
1. A **404 Not Found** error where the server returns a default index.html/error page.
2. A **500 Internal Server Error** where a middleware or proxy returns an HTML error page.
3. A **Redirect** to a login page or landing page that is not handled by the API client.

Grepping reveals multiple direct `fetch().then(r => r.json())` calls outside the protected `api.js` wrapper, most notably in `SessionClockBar.jsx`, which is a global component.

## Execution Plan
1. **Sanitize SessionClockBar**: Refactor `SessionClockBar.jsx` to use the shared `api.js` client or implement robust text-then-parse logic.
2. **Harden api.js Exceptions**: Update the remaining `res.json()` calls in `api.js` (e.g., in `getBlob` and `uploadTradeFile`) to use the `res.text()` + `try-catch` pattern.
3. **Audit other fetch calls**: Update `SignalDetailCard.jsx` and `TradeSignalChart.jsx` to ensure they handle non-JSON responses gracefully.
4. **Backend verification**: Ensure the `/v2/calendar/today` endpoint is correctly mapped and not returning 404.

## Goal & Expectation
- **Goal**: Eliminate the `SyntaxError: Unexpected token '<'` from the browser console.
- **Expectation**: Instead of a cryptic syntax error, the application should either log a clear "Non-JSON response" error or fail silently without crashing the promise chain.
