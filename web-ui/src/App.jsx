import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
const ChartSnapshotsPage = lazy(() => import("./pages/ai/ChartSnapshotsPage"));
const AiNewsPage = lazy(() => import("./pages/ai/AiNewsPage"));
const TradesPage = lazy(() => import("./pages/trades/TradesPage"));
const TempTradesPage = lazy(() => import("./pages/trades/TempTradesPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const ProfilePage = lazy(() => import("./pages/settings/ProfilePage"));
const CronPage = lazy(() => import("./pages/settings/CronPage"));
const ProvidersPage = lazy(() => import("./pages/settings/ProvidersPage"));
const LogsPage = lazy(() => import("./pages/system/LogsPage"));
const HealthPage = lazy(() => import("./pages/system/HealthPage"));
const UsersPage = lazy(() => import("./pages/system/UsersPage"));
const AccountsV2Page = lazy(() => import("./pages/system/AccountsV2Page"));
const SnapshotsPage = lazy(() => import("./pages/system/SnapshotsPage"));
const StoragePage = lazy(() => import("./pages/system/StoragePage"));
const CachePage = lazy(() => import("./pages/system/CachePage"));

import {
  api,
  getRuntimeActiveUserId,
  getRuntimeDbSource,
  setRuntimeActiveUserId,
  setRuntimeDbSource,
} from "./api";
const LoginPage = lazy(() => import("./pages/LoginPage"));
import SessionClockBar from "./components/SessionClockBar";
import NotificationWatcher from "./components/NotificationWatcher";
import TickerBar from "./components/TickerBar";
import NotificationDot from "./components/NotificationDot";

import ToastContainer from "./components/ToastContainer";
import AppShell from "./components/AppShell";
import NavDropdown from "./components/NavDropdown";
import { normalizeDisplayTimezone } from "./utils/format";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";

const LOCAL_DB_MANAGER_URL = "http://127.0.0.1:8088";

export default function App() {
  const [serverVersion, setServerVersion] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ui_theme") || "dark",
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [dbSources, setDbSources] = useState([]);
  const [activeDbSource, setActiveDbSource] = useState(() =>
    getRuntimeDbSource(),
  );
  const [tradeCounts, setTradeCounts] = useState({});
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
    api
      .dbSources()
      .then((data) => {
        const sources = Array.isArray(data?.sources) ? data.sources : [];
        setDbSources(sources);
        const stored = getRuntimeDbSource();
        const next = sources.some((source) => source.id === stored)
          ? stored
          : data?.active || sources[0]?.id || "";
        setActiveDbSource(next);
        if (next && next !== stored) setRuntimeDbSource(next);
      })
      .catch(() => {
        setDbSources([]);
      });
  }, []);

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

  // Fetch trade counts for nav badges (single GROUP BY query, cached 30s)
  useEffect(() => {
    const fetch = () => {
      api
        .v2TradeCounts()
        .then((d) => {
          if (d?.ok) setTradeCounts(d.counts || {});
        })
        .catch(() => {});
    };
    fetch();
    const iv = setInterval(fetch, 30000);
    return () => clearInterval(iv);
  }, []);

  const countBadge = (key) => {
    const n = tradeCounts[key];
    if (n == null) return "";
    return ` (${n})`;
  };

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
  const closeMobileNav = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("mobile-nav-close"));
    }
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

  const mobileTopbarContent = (
    <div className="brand mobile-topbar-brand">
      <Link
        to="/dashboard"
        className="brand-link"
        onClick={closeMobileNav}
        title="Go to home page"
      >
        📈 Trading
      </Link>
      {serverVersion ? (
        <span className="brand-version">v{serverVersion}</span>
      ) : null}
      {dbSources.length >= 2 ? (
        <label className="db-source-switcher" title="DB Source">
          <span>DB</span>
          <select
            value={activeDbSource}
            onChange={(event) => {
              const next = event.target.value;
              setActiveDbSource(next);
              setRuntimeDbSource(next);
              window.location.reload();
            }}
          >
            {dbSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name || source.id}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  const topbarContent = (
    <>
      <div className="brand">
        <Link
          to="/dashboard"
          className="brand-link"
          onClick={closeMobileNav}
          title="Go to home page"
        >
          📈 Trading
        </Link>
        {serverVersion ? (
          <span className="brand-version">v{serverVersion}</span>
        ) : null}
        {dbSources.length >= 2 ? (
          <label className="db-source-switcher" title="DB Source">
            <span>DB</span>
            <select
              value={activeDbSource}
              onChange={(event) => {
                const next = event.target.value;
                setActiveDbSource(next);
                setRuntimeDbSource(next);
                window.location.reload();
              }}
            >
              {dbSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name || source.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {getRuntimeActiveUserId() && (
          <span style={{ marginLeft: 10, fontSize: "11px", color: "#f39c12" }}>
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
          className={({ isActive }) =>
            `mobile-nav-link ${isActive ? "active" : ""}`
          }
          onClick={closeMobileNav}
        >
          Dashboard
        </NavLink>
        <NavDropdown
          align="start"
          trigger={
            <NavLink
              to="/ai/analyze"
              className={({ isActive }) =>
                `mobile-nav-link ${isActive ? "active" : ""}`
              }
            >
              AI
            </NavLink>
          }
        >
          <NavLink to="/ai/analyze">Analyze</NavLink>
          <NavLink to="/ai/news">News</NavLink>
          <NavLink to="/ai/response">Response</NavLink>
        </NavDropdown>
        <NavDropdown
          align="start"
          trigger={
            <NavLink
              to="/trades"
              className={({ isActive }) =>
                `mobile-nav-link ${isActive ? "active" : ""}`
              }
            >
              Trades
            </NavLink>
          }
        >
          <NavLink
            to="/trades/filled"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Filled{countBadge("FILLED")}
          </NavLink>
          <NavLink
            to="/trades/pending"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Pending{countBadge("PENDING")}
          </NavLink>
          <NavLink
            to="/trades/closed"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Closed{countBadge("CLOSED")}
          </NavLink>
          <NavLink
            to="/trades/rejected"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Rejected{countBadge("REJECTED")}
          </NavLink>
          <NavLink
            to="/trades/cancelled"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Cancelled{countBadge("CANCELLED")}
          </NavLink>
          <NavLink
            to="/trades/draft"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Draft{countBadge("DRAFT")}
          </NavLink>
        </NavDropdown>

        <div style={{ flex: 1 }} />

        {canAccessSystemPages && (
          <NavDropdown
            trigger={
              <button
                type="button"
                className={`secondary-button nav-dropdown-trigger ${systemMenuActive ? "active" : ""}`}
              >
                System
              </button>
            }
          >
            <NavLink to="/system/files">Files</NavLink>
            <NavLink to="/system/storage">Storage</NavLink>
            <NavLink to="/system/cache">Cache</NavLink>
            <NavLink to="/system/logs">Logs</NavLink>
            <NavLink to="/system/health">Health</NavLink>
            <NavLink to="/system/users">Users</NavLink>
          </NavDropdown>
        )}
        <NavDropdown
          trigger={
            <button
              type="button"
              className={`secondary-button nav-dropdown-trigger ${settingsMenuActive ? "active" : ""}`}
            >
              User
            </button>
          }
        >
          <NavLink to="/settings/profile">Profile</NavLink>
          <NavLink to="/settings/accounts">Accounts</NavLink>
          <NavLink to="/settings/crons">Cron</NavLink>
          <NavLink to="/settings/providers">Providers</NavLink>
          <NavLink to="/settings/notification">Settings</NavLink>
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
        </NavDropdown>
        <div className="mobile-nav-utils">
          <NotificationDot />
          <button
            onClick={() => {
              toggleTheme();
              closeMobileNav();
            }}
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
        </div>
      </nav>
    </>
  );

  const mobileDrawerContent = (
    <>
      <nav>
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `mobile-nav-link ${isActive ? "active" : ""}`
          }
          onClick={closeMobileNav}
        >
          Dashboard
        </NavLink>
        <NavDropdown
          align="start"
          trigger={
            <NavLink
              to="/ai/analyze"
              className={({ isActive }) =>
                `mobile-nav-link ${isActive ? "active" : ""}`
              }
            >
              AI
            </NavLink>
          }
        >
          <NavLink to="/ai/analyze">Analyze</NavLink>
          <NavLink to="/ai/news">News</NavLink>
          <NavLink to="/ai/response">Response</NavLink>
        </NavDropdown>
        <NavDropdown
          align="start"
          trigger={
            <NavLink
              to="/trades"
              className={({ isActive }) =>
                `mobile-nav-link ${isActive ? "active" : ""}`
              }
            >
              Trades
            </NavLink>
          }
        >
          <NavLink
            to="/trades/filled"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Filled{countBadge("FILLED")}
          </NavLink>
          <NavLink
            to="/trades/pending"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Pending{countBadge("PENDING")}
          </NavLink>
          <NavLink
            to="/trades/closed"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Closed{countBadge("CLOSED")}
          </NavLink>
          <NavLink
            to="/trades/rejected"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Rejected{countBadge("REJECTED")}
          </NavLink>
          <NavLink
            to="/trades/cancelled"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Cancelled{countBadge("CANCELLED")}
          </NavLink>
          <NavLink
            to="/trades/draft"
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            Draft{countBadge("DRAFT")}
          </NavLink>
        </NavDropdown>

        <div style={{ flex: 1 }} />

        {canAccessSystemPages && (
          <NavDropdown
            trigger={
              <button
                type="button"
                className={`secondary-button nav-dropdown-trigger ${systemMenuActive ? "active" : ""}`}
              >
                System
              </button>
            }
          >
            <NavLink to="/system/files">Files</NavLink>
            <NavLink to="/system/storage">Storage</NavLink>
            <NavLink to="/system/cache">Cache</NavLink>
            <NavLink to="/system/logs">Logs</NavLink>
            <NavLink to="/system/health">Health</NavLink>
            <NavLink to="/system/users">Users</NavLink>
          </NavDropdown>
        )}
        <NavDropdown
          trigger={
            <button
              type="button"
              className={`secondary-button nav-dropdown-trigger ${settingsMenuActive ? "active" : ""}`}
            >
              User
            </button>
          }
        >
          <NavLink to="/settings/profile">Profile</NavLink>
          <NavLink to="/settings/accounts">Accounts</NavLink>
          <NavLink to="/settings/crons">Cron</NavLink>
          <NavLink to="/settings/providers">Providers</NavLink>
          <NavLink to="/settings/notification">Settings</NavLink>
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
        </NavDropdown>
        <div className="mobile-nav-utils">
          <NotificationDot />
          <button
            onClick={() => {
              toggleTheme();
              closeMobileNav();
            }}
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
        </div>
      </nav>
    </>
  );

  return (
    <AppShell
      topbar={topbarContent}
      mobileTopbar={mobileTopbarContent}
      mobileDrawer={mobileDrawerContent}
    >
      <ConfirmDialogProvider>
        <NotificationWatcher />
        <ToastContainer />
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
              <Route path="/trades/:status" element={<TradesPage />} />
              <Route path="/trades/:tradeId" element={<TradesPage />} />
              <Route path="/trades/:status/:tradeId" element={<TradesPage />} />
              <Route
                path="/ai"
                element={<Navigate to="/ai/analyze" replace />}
              />
              <Route path="/ai/analyze" element={<ChartSnapshotsPage />} />
              <Route
                path="/ai/analyze/:symbol"
                element={<ChartSnapshotsPage />}
              />
              <Route path="/ai/result" element={<ChartSnapshotsPage />} />
              <Route
                path="/ai/result/:symbol"
                element={<ChartSnapshotsPage />}
              />
              <Route path="/ai/trade" element={<ChartSnapshotsPage />} />
              <Route
                path="/ai/trade/:symbol"
                element={<ChartSnapshotsPage />}
              />
              <Route path="/ai/manual" element={<ChartSnapshotsPage />} />
              <Route
                path="/ai/manual/:symbol"
                element={<ChartSnapshotsPage />}
              />
              <Route path="/ai/response" element={<TempTradesPage />} />
              <Route path="/ai/response/:symbol" element={<TempTradesPage />} />
              <Route path="/ai/news" element={<AiNewsPage />} />
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
              <Route path="/settings/crons/:cronName" element={<CronPage />} />
              <Route path="/settings/providers" element={<ProvidersPage />} />
              <Route
                path="/settings/providers/:providerName"
                element={<ProvidersPage />}
              />
              <Route path="/settings/accounts" element={<AccountsV2Page />} />
              <Route
                path="/settings/notification"
                element={<SettingsPage showNotifications />}
              />
              <Route
                path="/settings/analyse"
                element={
                  <SettingsPage
                    routeAlias={{ type: "settings", name: "ANALYSE_SETTINGS" }}
                  />
                }
              />
              <Route
                path="/settings/log_prefixes"
                element={
                  <SettingsPage
                    routeAlias={{
                      type: "system_config",
                      name: "enabled_log_prefixes",
                    }}
                  />
                }
              />
              <Route
                path="/settings/execution_profile"
                element={
                  <SettingsPage
                    routeAlias={{ type: "execution_profile", name: "default" }}
                  />
                }
              />
              <Route
                path="/settings/symbol_groups"
                element={
                  <SettingsPage
                    routeAlias={{ type: "symbol_groups", name: "default" }}
                  />
                }
              />
              <Route
                path="/settings/settings/ANALYSE_SETTINGS"
                element={<Navigate to="/settings/analyse" replace />}
              />
              <Route
                path="/settings/settings/analyse"
                element={<Navigate to="/settings/analyse" replace />}
              />
              <Route
                path="/settings/settings/default"
                element={<Navigate to="/settings" replace />}
              />
              <Route
                path="/settings/execution_profile/default"
                element={<Navigate to="/settings/execution_profile" replace />}
              />
              <Route
                path="/settings/:settingType/:settingName"
                element={<SettingsPage />}
              />
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
                path="/system/db"
                element={<Navigate to="/dashboard" replace />}
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
              <Route
                path="/tools"
                element={<Navigate to="/dashboard" replace />}
              />
              <Route
                path="/tools/notification"
                element={<Navigate to="/dashboard" replace />}
              />
              <Route
                path="/settings/notifications"
                element={<Navigate to="/settings/notification" replace />}
              />
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
              <Route
                path="/db"
                element={<Navigate to="/dashboard" replace />}
              />
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
      </ConfirmDialogProvider>
    </AppShell>
  );
}
