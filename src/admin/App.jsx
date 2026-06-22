import { Component, useEffect, useMemo, useRef, useState, Suspense } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ChartSnapshotsPage from "./pages/ai/ChartSnapshotsPage";
import RealtimeChartPage from "./pages/ai/RealtimeChartPage";
import AiNewsPage from "./pages/ai/AiNewsPage";
import TradesPage from "./pages/trades/TradesPage";
import TempTradesPage from "./pages/trades/TempTradesPage";
import BacktestsPage from "./pages/BacktestsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import ProfilePage from "./pages/settings/ProfilePage";
import CronPage from "./pages/settings/CronPage";
import ProvidersPage from "./pages/settings/ProvidersPage";
import UsersPage from "./pages/system/UsersPage";
import AccountsV2Page from "./pages/system/AccountsV2Page";
import AppHostPage from "./pages/system/AppHostPage";
import AuthProbePage from "./pages/system/AuthProbePage";
import LoginPage from "./pages/LoginPage";

function LegacyMiniAppRedirect() {
  const { appId } = useParams();
  return <Navigate to={`/apps/${appId || ""}`} replace />;
}

import { api, getRuntimeActiveUserId, setRuntimeActiveUserId } from "./api";
import SessionClockBar from "./components/SessionClockBar";
import NotificationWatcher from "./components/NotificationWatcher";
import TickerBar from "./components/TickerBar";

import ToastContainer from "../shared/components/ToastContainer";
import AppShell from "../shared/components/AppShell";
import NavDropdown from "../shared/components/NavDropdown";
import SiteNavigation from "../shared/components/SiteNavigation";
import AiChatDock from "./components/AiChatDock";
import { normalizeDisplayTimezone } from "./utils/format";
import { resolveDisplayedVersion } from "./utils/appVersion";
import { ConfirmDialogProvider } from "../shared/components/ConfirmDialog";

class RouteLoadBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("[RouteLoadBoundary] route render failed", error);
  }

  render() {
    if (this.state.error) {
      const message = String(
        this.state.error?.message || this.state.error || "Failed to load page",
      ).trim();
      return (
        <div className="loading-container" style={{ gap: 12, flexDirection: "column" }}>
          <div className="minor-text msg-error">
            {message || "Failed to load page"}
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.reload()}
            style={{ alignSelf: "center" }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [serverVersion, setServerVersion] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ui_theme") || "dark",
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [tradeCounts, setTradeCounts] = useState({});
  const [tradeCountsPollingEnabled, setTradeCountsPollingEnabled] =
    useState(true);
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
      p.startsWith("/sources") ||
      p.startsWith("/apps") ||
      p.startsWith("/miniapps")
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
  const uiLocale = useMemo(() => {
    return (
      String(
        authUser?.metadata?.settings?.language ||
          authUser?.metadata?.language ||
          localStorage.getItem("ui_locale") ||
          "English",
      ).trim() || "English"
    );
  }, [authUser]);

  const displayedVersion = resolveDisplayedVersion(
    serverVersion,
    __APP_BUILD_VERSION__,
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ui_theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ui_locale", uiLocale);
    document.documentElement.lang = uiLocale;
  }, [uiLocale]);

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

  const isLocalDev =
    import.meta.env.DEV &&
    (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_PROXY_TARGET);

  // Fetch trade counts for nav badges (single GROUP BY query, cached 30s)
  useEffect(() => {
    if (!tradeCountsPollingEnabled) return undefined;
    if (authLoading) return undefined;
    if (!authUser && !isLocalDev) return undefined;
    const fetch = () => {
      api
        .v2TradeCounts()
        .then((d) => {
          if (d?.ok) setTradeCounts(d.counts || {});
        })
        .catch((error) => {
          const status = Number(error?.apiRequest?.status || 0);
          const message = String(error?.message || "").trim().toLowerCase();
          if (
            status === 400 &&
            (message.includes("mt5 bridge disabled") ||
              message.includes("bridge disabled"))
          ) {
            setTradeCountsPollingEnabled(false);
          }
        });
    };
    fetch();
    const iv = setInterval(fetch, 30000);
    return () => clearInterval(iv);
  }, [authLoading, authUser, isLocalDev, tradeCountsPollingEnabled]);

  const countBadge = (key) => {
    const n = tradeCounts[key];
    if (n == null) return "";
    return ` (${n})`;
  };

  useEffect(() => {
    let cancelled = false;

    function withTimeout(promise, timeoutMs, label) {
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`${label} timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        Promise.resolve(promise).then(
          (value) => {
            window.clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            window.clearTimeout(timer);
            reject(error);
          },
        );
      });
    }

    Promise.allSettled([
      withTimeout(api.health(), 4000, "health"),
      withTimeout(api.authMe(), 8000, "auth"),
    ])
      .then(([healthRes, meRes]) => {
        if (cancelled) return;
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
          const nextLocale =
            String(
              user.metadata?.settings?.language ||
                user.metadata?.language ||
                "English",
            ).trim() || "English";
          localStorage.setItem("ui_display_timezone", tz);
          localStorage.setItem("ui_locale", nextLocale);
        } else {
          setAuthUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
      const nextLocale =
        String(
          user.metadata?.settings?.language ||
            user.metadata?.language ||
            "English",
        ).trim() || "English";
      localStorage.setItem("ui_display_timezone", tz);
      localStorage.setItem("ui_locale", nextLocale);
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

  if (!authUser && !isLocalDev) {
    return (
      <div className="app-shell">
        <main className="page-wrap">
          <Routes>
            <Route
              path="/bridge/auth-probe"
              element={<AuthProbePage authUser={null} />}
            />
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

  const actingAsBadge = getRuntimeActiveUserId() ? (
    <span style={{ marginLeft: 10, fontSize: "11px", color: "#f39c12" }}>
      (Acting as {getRuntimeActiveUserId()})
      <button
        type="button"
        onClick={() => {
          setRuntimeActiveUserId("");
          window.location.reload();
        }}
        className="secondary-button icon-button"
        style={{ marginLeft: 6 }}
      >
        ✖
      </button>
    </span>
  ) : null;

  const mobileTopbarContent = displayedVersion ? (
    <div className="mobile-topbar-version" aria-label="Build version">
      v{displayedVersion}
    </div>
  ) : null;

  const topbarContent = (
    <SiteNavigation
      logo="📈"
      title="42trade"
      version={displayedVersion}
      onHomeClick={closeMobileNav}
      brandExtras={<>{actingAsBadge}</>}
      nav={
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
            <NavLink to="/ai/response">Response</NavLink>
            <NavLink to="/ai/realtime-chart">Realtime Chart</NavLink>
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
              Positions{countBadge("FILLED")}
            </NavLink>
            <NavLink
              to="/trades/pending"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Orders{countBadge("PENDING")}
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
          <NavLink
            to="/backtests"
            className={({ isActive }) =>
              `mobile-nav-link ${isActive ? "active" : ""}`
            }
            onClick={closeMobileNav}
          >
            Backtests
          </NavLink>

          <div style={{ flex: 1 }} />

          {canAccessSystemPages && (
            <NavDropdown
              trigger={
                <button
                  type="button"
                  className={`secondary-button nav-dropdown-trigger ${systemMenuActive ? "active" : ""}`}
                >
                  <span className="combo-button-menu-trigger__label">
                    System
                  </span>
                  <span
                    aria-hidden="true"
                    className="combo-button-menu-trigger__caret"
                  >
                    ▾
                  </span>
                </button>
              }
            >
              <NavLink to="/apps/system-files">Files</NavLink>
              <NavLink to="/apps/system-cache">Cache</NavLink>
              <NavLink to="/apps/system-logs">Logs</NavLink>
              <NavLink to="/apps/db-manager">DB Manager</NavLink>
              <NavLink to="/apps/system-health">Health</NavLink>
              <NavLink to="/system/users">Users</NavLink>
            </NavDropdown>
          )}
          <NavDropdown
            trigger={
              <button
                type="button"
                className={`secondary-button nav-dropdown-trigger ${settingsMenuActive ? "active" : ""}`}
              >
                <span className="combo-button-menu-trigger__label">User</span>
                <span
                  aria-hidden="true"
                  className="combo-button-menu-trigger__caret"
                >
                  ▾
                </span>
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

                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </NavDropdown>
          <div className="mobile-nav-utils">
            <button
              onClick={() => {
                toggleTheme();
                closeMobileNav();
              }}
              className="secondary-button"
              style={{
                marginLeft: "10px",
                minWidth: "40px",
              }}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </nav>
      }
    />
  );

  const mobileDrawerContent = (
    <SiteNavigation
      logo="📈"
      title="42trade"
      version={displayedVersion}
      onHomeClick={closeMobileNav}
      nav={
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
            <NavLink to="/ai/response">Response</NavLink>
            <NavLink to="/ai/realtime-chart">Realtime Chart</NavLink>
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
              Positions{countBadge("FILLED")}
            </NavLink>
            <NavLink
              to="/trades/pending"
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              Orders{countBadge("PENDING")}
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
          <NavLink
            to="/backtests"
            className={({ isActive }) =>
              `mobile-nav-link ${isActive ? "active" : ""}`
            }
            onClick={closeMobileNav}
          >
            Backtests
          </NavLink>

          <div style={{ flex: 1 }} />

          {canAccessSystemPages && (
            <NavDropdown
              trigger={
                <button
                  type="button"
                  className={`secondary-button nav-dropdown-trigger ${systemMenuActive ? "active" : ""}`}
                >
                  <span className="combo-button-menu-trigger__label">
                    System
                  </span>
                  <span
                    aria-hidden="true"
                    className="combo-button-menu-trigger__caret"
                  >
                    ▾
                  </span>
                </button>
              }
            >
              <NavLink to="/apps/system-files">Files</NavLink>
              <NavLink to="/apps/system-cache">Cache</NavLink>
              <NavLink to="/apps/system-logs">Logs</NavLink>
              <NavLink to="/apps/db-manager">DB Manager</NavLink>
              <NavLink to="/apps/system-health">Health</NavLink>
              <NavLink to="/system/users">Users</NavLink>
            </NavDropdown>
          )}
          <NavDropdown
            trigger={
              <button
                type="button"
                className={`secondary-button nav-dropdown-trigger ${settingsMenuActive ? "active" : ""}`}
              >
                <span className="combo-button-menu-trigger__label">User</span>
                <span
                  aria-hidden="true"
                  className="combo-button-menu-trigger__caret"
                >
                  ▾
                </span>
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

                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </NavDropdown>
          <div className="mobile-nav-utils">
            <button
              onClick={() => {
                toggleTheme();
                closeMobileNav();
              }}
              className="secondary-button"
              style={{
                marginLeft: "10px",
                minWidth: "40px",
              }}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </nav>
      }
    />
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
        <AiChatDock
          pathname={`${location.pathname || ""}${location.search || ""}`}
          authUser={authUser}
        />
        <main className="page-wrap">
          <RouteLoadBoundary>
            <Suspense
              fallback={<div className="loading-container">Loading page...</div>}
            >
              <Routes>
              <Route
                path="/bridge/auth-probe"
                element={<AuthProbePage authUser={authUser} />}
              />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route
                path="/apps"
                element={<Navigate to="/apps/db-manager" replace />}
              />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/trades" element={<TradesPage />} />
              <Route path="/trades/:status" element={<TradesPage />} />
              <Route path="/trades/:tradeId" element={<TradesPage />} />
              <Route path="/trades/:status/:tradeId" element={<TradesPage />} />
              <Route path="/backtests" element={<BacktestsPage />} />
              <Route path="/backtests/:runId" element={<BacktestsPage />} />
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
              <Route path="/ai/realtime-chart" element={<RealtimeChartPage />} />
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
                path="/apps/:appId"
                element={
                  canAccessSystemPages ? (
                    <AppHostPage
                      authUser={authUser}
                      theme={theme}
                      locale={uiLocale}
                    />
                  ) : (
                    <Navigate to="/dashboard" replace />
                  )
                }
              />
              <Route
                path="/miniapps/:appId"
                element={<LegacyMiniAppRedirect />}
              />
              <Route
                path="/system/files"
                element={<Navigate to="/apps/system-files" replace />}
              />
              <Route
                path="/system/snapshots"
                element={<Navigate to="/apps/system-files" replace />}
              />
              <Route
                path="/system/storage"
                element={<Navigate to="/apps/system-files" replace />}
              />
              <Route
                path="/system/cache"
                element={<Navigate to="/apps/system-cache" replace />}
              />
              <Route
                path="/system/logs/:logId"
                element={<Navigate to="/apps/system-logs" replace />}
              />
              <Route
                path="/system/logs"
                element={<Navigate to="/apps/system-logs" replace />}
              />
              <Route
                path="/system/db"
                element={<Navigate to="/apps/db-manager" replace />}
              />
              <Route
                path="/system/health"
                element={<Navigate to="/apps/system-health" replace />}
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
                element={<Navigate to="/apps/system-files" replace />}
              />
              <Route
                path="/storage"
                element={<Navigate to="/apps/system-files" replace />}
              />
              <Route
                path="/cache"
                element={<Navigate to="/apps/system-cache" replace />}
              />
              <Route
                path="/logs"
                element={<Navigate to="/apps/system-logs" replace />}
              />
              <Route
                path="/db"
                element={<Navigate to="/apps/db-manager" replace />}
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
          </RouteLoadBoundary>
        </main>
      </ConfirmDialogProvider>
    </AppShell>
  );
}
