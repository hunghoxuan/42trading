import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
const ChartSnapshotsPage = lazy(() => import("./pages/ai/ChartSnapshotsPage"));
const TradesPage = lazy(() => import("./pages/trades/TradesPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const ProfilePage = lazy(() => import("./pages/settings/ProfilePage"));
const CronPage = lazy(() => import("./pages/settings/CronPage"));
const ProvidersPage = lazy(() => import("./pages/settings/ProvidersPage"));
const LogsPage = lazy(() => import("./pages/system/LogsPage"));
const DatabasePage = lazy(() => import("./pages/system/DatabasePage"));
const HealthPage = lazy(() => import("./pages/system/HealthPage"));
const UsersPage = lazy(() => import("./pages/system/UsersPage"));
const AccountsV2Page = lazy(() => import("./pages/system/AccountsV2Page"));
const SnapshotsPage = lazy(() => import("./pages/system/SnapshotsPage"));
const StoragePage = lazy(() => import("./pages/system/StoragePage"));
const CachePage = lazy(() => import("./pages/system/CachePage"));
const EventsPage = lazy(() => import("./pages/system/EventsPage"));
const ToolsPage = lazy(() => import("./pages/tools/ToolsPage"));
import { api, getRuntimeActiveUserId, setRuntimeActiveUserId } from "./api";
const LoginPage = lazy(() => import("./pages/LoginPage"));
import SessionClockBar from "./components/SessionClockBar";
import NotificationWatcher from "./components/NotificationWatcher";
import TickerBar from "./components/TickerBar";
import NotificationDot from "./components/NotificationDot";

import ToastContainer from "./components/ToastContainer";
import { normalizeDisplayTimezone } from "./utils/format";

export default function App() {
  const [serverVersion, setServerVersion] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ui_theme") || "dark",
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [, setRelativeTimeTick] = useState(0);
  const [tzUiTick, setTzUiTick] = useState(0);
  const location = useLocation();
  const canAccessSystemPages =
    String(authUser?.role || "").toLowerCase() === "system";
  const settingsMenuActive = useMemo(() => {
    const p = String(location?.pathname || "");
    return p.startsWith("/settings") || p.startsWith("/profile");
  }, [location?.pathname]);
  const systemMenuActive = useMemo(() => {
    const p = String(location?.pathname || "");
    return (
      p.startsWith("/system") ||
      p.startsWith("/logs") ||
      p.startsWith("/db") ||
      p.startsWith("/users") ||
      p.startsWith("/snapshots") ||
      p.startsWith("/storage") ||
      p.startsWith("/cache") ||
      p.startsWith("/accounts-v2") ||
      p.startsWith("/sources")
    );
  }, [location?.pathname]);

  const displayTimezone = useMemo(() => {
    return normalizeDisplayTimezone(
      localStorage.getItem("ui_display_timezone") ||
        authUser?.metadata?.settings?.display_timezone ||
        authUser?.metadata?.display_timezone ||
        "Local",
    );
  }, [authUser, tzUiTick]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ui_theme", theme);
  }, [theme]);

  useEffect(() => {
    // Keep "x mins ago" labels moving forward without requiring data refetches.
    const timer = window.setInterval(() => {
      setRelativeTimeTick((n) => n + 1);
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onTimezoneUiChanged = () => setTzUiTick((n) => n + 1);
    window.addEventListener("ui-timezone-changed", onTimezoneUiChanged);
    return () =>
      window.removeEventListener("ui-timezone-changed", onTimezoneUiChanged);
  }, []);

  useEffect(() => {
    Promise.allSettled([api.health(), api.authMe()])
      .then(([healthRes, meRes]) => {
        if (healthRes.status === "fulfilled") {
          setServerVersion(String(healthRes.value?.version || ""));
        } else {
          setServerVersion("");
        }
        if (meRes.status === "fulfilled" && meRes.value?.user) {
          const user = meRes.value.user;
          setAuthUser(user);
          const tz = normalizeDisplayTimezone(
            user.metadata?.settings?.display_timezone ||
              user.metadata?.display_timezone ||
              "Local",
          );
          localStorage.setItem("ui_display_timezone", tz);
        } else {
          setAuthUser(null);
        }
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const handleUserUpdate = (user) => {
    if (user) {
      setAuthUser(user);
      const tz = normalizeDisplayTimezone(
        user.metadata?.settings?.display_timezone ||
          user.metadata?.display_timezone ||
          "Local",
      );
      localStorage.setItem("ui_display_timezone", tz);
    }
  };
  const handleLogin = (user) => handleUserUpdate(user);
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // noop
    }
    setAuthUser(null);
  };

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  // Local dev with env API base: skip auth, use API key directly
  const isLocalDev = import.meta.env.DEV && import.meta.env.VITE_API_BASE;

  if (!authUser && !isLocalDev) {
    return (
      <div className="app-shell">
        <main className="page-wrap">
          <Routes>
            <Route
              path="/login"
              element={<LoginPage onLogin={handleLogin} />}
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <NotificationWatcher />
      <ToastContainer />
      <header className="topbar">
        <div className="brand">
          <span>📈 Trading</span>
          {serverVersion ? (
            <span className="brand-version">v{serverVersion}</span>
          ) : null}
          {getRuntimeActiveUserId() && (
            <span
              style={{ marginLeft: 10, fontSize: "11px", color: "#f39c12" }}
            >
              (Acting as {getRuntimeActiveUserId()})
              <button
                type="button"
                onClick={() => {
                  setRuntimeActiveUserId("");
                  window.location.reload();
                }}
                className="secondary-button icon-button"
                style={{ marginLeft: 6, padding: "2px 6px" }}
              >
                ✖
              </button>
            </span>
          )}
        </div>
        <nav>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/ai/analyze"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            AI
          </NavLink>
          <div className="nav-dropdown">
            <NavLink
              to="/trades"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Trades
            </NavLink>
            <div className="nav-dropdown-menu">
              <NavLink
                to="/trades?status=PENDING"
                className={({ isActive }) =>
                  isActive &&
                  location.pathname === "/trades" &&
                  new URLSearchParams(location.search).get("status") ===
                    "PENDING"
                    ? "active"
                    : ""
                }
              >
                Pending
              </NavLink>
              <NavLink
                to="/trades?status=FILLED"
                className={({ isActive }) =>
                  isActive &&
                  location.pathname === "/trades" &&
                  new URLSearchParams(location.search).get("status") ===
                    "FILLED"
                    ? "active"
                    : ""
                }
              >
                Filled
              </NavLink>
              <NavLink
                to="/trades?status=CLOSED"
                className={({ isActive }) =>
                  isActive &&
                  location.pathname === "/trades" &&
                  new URLSearchParams(location.search).get("status") ===
                    "CLOSED"
                    ? "active"
                    : ""
                }
              >
                Closed
              </NavLink>
              <NavLink
                to="/trades?status=Draft"
                className={({ isActive }) =>
                  isActive &&
                  location.pathname === "/trades" &&
                  new URLSearchParams(location.search).get("status") === "Draft"
                    ? "active"
                    : ""
                }
              >
                Draft
              </NavLink>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {canAccessSystemPages && (
            <div className="nav-dropdown">
              <button
                type="button"
                className={`secondary-button nav-dropdown-trigger ${systemMenuActive ? "active" : ""}`}
              >
                System
              </button>
              <div className="nav-dropdown-menu">
                <NavLink to="/system/files">Files</NavLink>
                <NavLink to="/system/storage">Storage</NavLink>
                <NavLink to="/system/cache">Cache</NavLink>
                <NavLink to="/system/logs">Logs</NavLink>
                <NavLink to="/system/db">DB</NavLink>
                <NavLink to="/system/health">Health</NavLink>
                <NavLink to="/system/users">Users</NavLink>
                <hr
                  style={{
                    border: "0",
                    borderTop: "1px solid rgba(255,255,255,0.1)",
                    margin: "4px 0",
                  }}
                />
                <NavLink to="/tools">🛠 Tools</NavLink>
              </div>
            </div>
          )}
          <div className="nav-dropdown">
            <button
              type="button"
              className={`secondary-button nav-dropdown-trigger ${settingsMenuActive ? "active" : ""}`}
            >
              User
            </button>
            <div className="nav-dropdown-menu">
              <NavLink to="/settings/profile">Profile</NavLink>
              <NavLink to="/settings/notifications">Notifications</NavLink>
              <NavLink to="/settings/accounts">Accounts</NavLink>
              <NavLink to="/settings/crons">Cron</NavLink>
              <NavLink to="/settings/providers">Providers</NavLink>
              <NavLink to="/settings" end>
                Settings
              </NavLink>
              <hr
                style={{
                  border: "0",
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  margin: "4px 0",
                }}
              />
              <button
                onClick={handleLogout}
                className="nav-item-button danger-text"
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "#ff4d4f",
                  padding: "8px 12px",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          </div>
          <NotificationDot />
          <button
            onClick={toggleTheme}
            className="secondary-button"
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              marginLeft: "10px",
              minWidth: "40px",
            }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </nav>
      </header>
      <SessionClockBar displayTimezone={displayTimezone} />
      <TickerBar />
      <main className="page-wrap">
        <Suspense
          fallback={<div className="loading-container">Loading page...</div>}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/trades/:tradeId" element={<TradesPage />} />
            <Route path="/ai" element={<Navigate to="/ai/analyze" replace />} />
            <Route path="/ai/analyze" element={<ChartSnapshotsPage />} />
            <Route
              path="/ai/analyze/:symbol"
              element={<ChartSnapshotsPage />}
            />
            <Route path="/ai/result" element={<ChartSnapshotsPage />} />
            <Route path="/ai/result/:symbol" element={<ChartSnapshotsPage />} />
            <Route path="/ai/trade" element={<ChartSnapshotsPage />} />
            <Route path="/ai/trade/:symbol" element={<ChartSnapshotsPage />} />
            <Route
              path="/ai/response/:symbol"
              element={<ChartSnapshotsPage />}
            />
            <Route
              path="/ai/browser"
              element={<Navigate to="/ai/analyze" replace />}
            />
            <Route
              path="/ai/browser/:symbol"
              element={<ChartSnapshotsPage />}
            />
            <Route
              path="/settings/profile"
              element={
                <ProfilePage
                  authUser={authUser}
                  onUserUpdate={handleUserUpdate}
                />
              }
            />
            <Route path="/settings/crons" element={<CronPage />} />
            <Route path="/settings/providers" element={<ProvidersPage />} />
            <Route path="/settings/accounts" element={<AccountsV2Page />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/system/files"
              element={
                canAccessSystemPages ? (
                  <SnapshotsPage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/snapshots"
              element={<Navigate to="/system/files" replace />}
            />
            <Route
              path="/system/storage"
              element={
                canAccessSystemPages ? (
                  <StoragePage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/cache"
              element={
                canAccessSystemPages ? (
                  <CachePage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/logs/:logId"
              element={
                canAccessSystemPages ? (
                  <LogsPage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/logs"
              element={
                canAccessSystemPages ? (
                  <LogsPage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/db/:tableName"
              element={
                canAccessSystemPages ? (
                  <DatabasePage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/db"
              element={
                canAccessSystemPages ? (
                  <DatabasePage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/health"
              element={
                canAccessSystemPages ? (
                  <HealthPage />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/users/:userId"
              element={
                canAccessSystemPages ? (
                  <UsersPage authUser={authUser} />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/users"
              element={
                canAccessSystemPages ? (
                  <UsersPage authUser={authUser} />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/accounts/:accountId"
              element={
                canAccessSystemPages ? (
                  <AccountsV2Page />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/system/accounts"
              element={
                canAccessSystemPages ? (
                  <AccountsV2Page />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/tools/notification" element={<EventsPage />} />
            <Route path="/settings/notifications" element={<EventsPage />} />
            <Route
              path="/snapshots"
              element={<Navigate to="/system/files" replace />}
            />
            <Route
              path="/storage"
              element={<Navigate to="/system/storage" replace />}
            />
            <Route
              path="/cache"
              element={<Navigate to="/system/cache" replace />}
            />
            <Route
              path="/logs"
              element={<Navigate to="/system/logs" replace />}
            />
            <Route path="/db" element={<Navigate to="/system/db" replace />} />
            <Route
              path="/users"
              element={<Navigate to="/system/users" replace />}
            />
            <Route
              path="/accounts-v2"
              element={<Navigate to="/system/accounts" replace />}
            />
            <Route path="/sources" />
            <Route
              path="/profile"
              element={<Navigate to="/settings/profile" replace />}
            />
            <Route
              path="/login"
              element={<Navigate to="/dashboard" replace />}
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
