import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
} from "react-router-dom";
import { getApiUrl, setApiUrl } from "./api";

// Import v2 pages directly — zero rewrites
const TradesPage = lazy(() => import("@v2/pages/trades/TradesPage"));
const SignalsPage = lazy(() => import("@v2/pages/signals/SignalsPage"));
const LogsPage = lazy(() => import("@v2/pages/system/LogsPage"));
const ChartSnapshotsPage = lazy(
  () => import("@v2/pages/ai/ChartSnapshotsPage"),
);
const SettingsPage = lazy(() => import("@v2/pages/settings/SettingsPage"));
import HomePage from "./pages/HomePage";

const queryClient = new QueryClient();

function Loading() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
      Loading...
    </div>
  );
}

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/trades", label: "Trades" },
  { to: "/signals", label: "Signals" },
  { to: "/files", label: "Analyze" },
  { to: "/logs", label: "Logs" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [adminKey, setAdminKey] = useState(
    () => localStorage.getItem("tvbridge_api_key") || "",
  );

  function updateAdminKey(key: string) {
    setAdminKey(key);
    localStorage.setItem("tvbridge_api_key", key);
    // Bridge to v2 API module (reads tvbridge_api_key)
    if (key) localStorage.setItem("tvbridge_api_key", key);
    else localStorage.removeItem("tvbridge_api_key");
  }

  function updateApiUrl(url: string) {
    setApiUrlState(url);
    setApiUrl(url);
    // Bridge to v2 API module (uses window.location.origin by default)
    if (url) localStorage.setItem("tvbridge_api_base", url);
    else localStorage.removeItem("tvbridge_api_base");
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div
          style={{
            minHeight: "100vh",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              gap: 12,
            }}
          >
            <nav style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: 14, marginRight: 12 }}>
                AG
              </span>
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  style={({ isActive }) => ({
                    textDecoration: "none",
                    color: isActive ? "var(--text)" : "var(--muted)",
                    fontWeight: 600,
                    fontSize: 12,
                    padding: "4px 8px",
                    borderBottom: isActive
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                  })}
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={adminKey}
                onChange={(e) => updateAdminKey(e.target.value)}
                placeholder="Admin key"
                type="password"
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  width: 150,
                }}
              />
              <input
                value={apiUrl}
                onChange={(e) => updateApiUrl(e.target.value)}
                placeholder="API URL"
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  width: 220,
                }}
              />
            </div>
          </header>
          <main>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/trades/*" element={<TradesPage />} />
                <Route path="/signals/*" element={<SignalsPage />} />
                <Route path="/files/*" element={<ChartSnapshotsPage />} />
                <Route path="/logs/*" element={<LogsPage />} />
                <Route path="/settings/*" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
