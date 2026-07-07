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
import DashboardPage from "../modules/42trade/pages/DashboardPage";
import ChartSnapshotsPage from "../modules/42trade/pages/ai/ChartSnapshotsPage";
import AiNewsPage from "../modules/42trade/pages/ai/AiNewsPage";
import TradesPage from "../modules/42trade/pages/trades/TradesPage";
import TempTradesPage from "../modules/42trade/pages/trades/TempTradesPage";
import BacktestsPage from "../modules/42trade/pages/BacktestsPage";
import SettingsPage from "../modules/system/pages/SettingsPage";
import ProfilePage from "../modules/system/pages/ProfilePage";
import CronPage from "../modules/system/pages/CronPage";
import ProvidersPage from "../modules/system/pages/ProvidersPage";
import UsersPage from "../modules/system/pages/UsersPage";
import AccountsV2Page from "../modules/system/pages/AccountsV2Page";
import AuthProbePage from "../modules/system/pages/AuthProbePage";
import LoginPage from "../modules/system/pages/LoginPage";
import SystemBrowserPage from "../modules/system/pages/SystemBrowserPage";
import SystemCachePage from "../modules/system/pages/SystemCachePage";
import SystemHealthPage from "../modules/system/pages/SystemHealthPage";
import DbManagerPage from "../modules/system/pages/DbManagerPage";
import Pay42DashboardPage from "../modules/42pay/pages/Pay42DashboardPage";
import Pay42ProductsPage from "../modules/42pay/pages/Pay42ProductsPage";
import Pay42OffersPage from "../modules/42pay/pages/Pay42OffersPage";
import Pay42OrdersPage from "../modules/42pay/pages/Pay42OrdersPage";
import Pay42AdminUsersPage from "../modules/42pay/pages/Pay42AdminUsersPage";
import Pay42ScanPage from "../modules/42pay/pages/Pay42ScanPage";
import Pay42TopupPage from "../modules/42pay/pages/Pay42TopupPage";
import Pay42PurchaseConfirmationPage from "../modules/42pay/pages/Pay42PurchaseConfirmationPage";
import StudioPage from "../modules/studio/pages/StudioPage";

function LegacyMiniAppRedirect() {
  const { appId } = useParams();
  const id = String(appId || "").trim().toLowerCase();
  if (id === "db-manager") return <Navigate to="/system/db" replace />;
  if (id === "system-files") return <Navigate to="/system/files" replace />;
  if (id === "system-cache") return <Navigate to="/system/cache" replace />;
  if (id === "system-logs") return <Navigate to="/system/logs" replace />;
  if (id === "system-health") return <Navigate to="/system/health" replace />;
  return <Navigate to="/system/db" replace />;
}

function LegacyPay42ConfirmationRedirect() {
  const { orderSid } = useParams();
  return <Navigate to={`/admin/42pay/orders/${orderSid || ""}/confirmation`} replace />;
}

import { api, getRuntimeActiveUserId, setRuntimeActiveUserId } from "./api";
import SessionClockBar from "../modules/42trade/components/SessionClockBar";
import NotificationWatcher from "../shared/components/NotificationWatcher";
import TickerBar from "../modules/42trade/components/TickerBar";

import ToastContainer from "../shared/components/ToastContainer";
import AppShell from "../shared/components/AppShell";
import NavDropdown from "../shared/components/NavDropdown";
import SiteNavigation from "../shared/components/SiteNavigation";
import AiChatDock from "../modules/42trade/components/AiChatDock";
import {
  AUTH_REQUIRED_EVENT,
  shouldRequireLoginScreen,
} from "../shared/utils/authPolicy.js";
import {
  isExplicitAuthFailure,
  loadStoredAuthUser,
  shouldApplyBootstrapAuthResult,
  storeAuthUserSnapshot,
} from "../shared/utils/authSession.js";
import { normalizeDisplayTimezone } from "../shared/utils/format";
import {
  canAccessPage,
  hasPermission,
  normalizeUserAccess,
} from "../shared/utils/permissions";
import { ConfirmDialogProvider } from "../shared/components/ConfirmDialog";

const payHubBrandLogo = (
  <img src="/logo/payhub-p-payhub-final.png" alt="PayHub" />
);

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

function resolveHomePath(user) {
  if (canAccessPage(user, "pages.42pay.dashboard")) return "/admin/42pay/dashboard";
  if (canAccessPage(user, "pages.dashboard")) return "/trades/dashboard";
  if (canAccessPage(user, "pages.ai.analyze")) return "/trades/analyze";
  if (canAccessPage(user, "pages.trades")) return "/trades/filled";
  if (canAccessPage(user, "pages.backtests")) return "/trades/backtests";
  if (canAccessPage(user, "pages.settings.profile")) return "/settings/profile";
  if (canAccessPage(user, "pages.system.db_manager")) return "/system/db";
  return "/login";
}

export default function App() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ui_theme") || "dark",
  );
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState(() => loadStoredAuthUser());
  const [adminSwitchUsers, setAdminSwitchUsers] = useState([]);
  const [adminSwitchRole, setAdminSwitchRole] = useState("");
  const [tradeCounts, setTradeCounts] = useState({});
  const [tradeCountsPollingEnabled, setTradeCountsPollingEnabled] =
    useState(true);
  const [, setRelativeTimeTick] = useState(0);
  const [tzUiTick, setTzUiTick] = useState(0);
  const authVersionRef = useRef(0);
  const location = useLocation();
  const canAccessSystemPages = hasPermission(authUser, "pages.system.users");
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
  const pay42MenuActive = useMemo(() => {
    const p = String(location?.pathname || "");
    return (
      p.startsWith("/admin/42pay") ||
      p.startsWith("/admin/pay42") ||
      p.startsWith("/42pay")
    );
  }, [location?.pathname]);
  const studioMenuActive = useMemo(() => {
    const p = String(location?.pathname || "");
    return p.startsWith("/studio");
  }, [location?.pathname]);
  const tradesMenuActive = useMemo(() => {
    const p = String(location?.pathname || "");
    return (
      p.startsWith("/trades") ||
      p.startsWith("/dashboard") ||
      p.startsWith("/backtests") ||
      p.startsWith("/ai/")
    );
  }, [location?.pathname]);
  const suppressTradeCountsPolling = useMemo(() => {
    const p = String(location?.pathname || "");
    return p.startsWith("/system/health") || p.startsWith("/miniapps/");
  }, [location?.pathname]);
  const isLoginRoute = useMemo(() => {
    const p = String(location?.pathname || "");
    return p === "/login";
  }, [location?.pathname]);
  const loginReturnUrl = useMemo(() => {
    const path = String(location?.pathname || "");
    const search = String(location?.search || "");
    const hash = String(location?.hash || "");
    return encodeURIComponent(`${path}${search}${hash}`);
  }, [location?.hash, location?.pathname, location?.search]);

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

  const homePath = resolveHomePath(authUser);
  const runtimeActiveUserId = getRuntimeActiveUserId();
  const isRootAdminSwitcher = useMemo(() => {
    const userName = String(authUser?.name || "").trim().toLowerCase();
    const roles = Array.isArray(authUser?.roles)
      ? authUser.roles.map((role) => String(role || "").trim().toLowerCase())
      : [];
    return userName === "admin" && roles.includes("admin");
  }, [authUser]);

  function countBadge(key) {
    const n = tradeCounts[key];
    if (n == null) return "";
    return ` (${n})`;
  }

  const adminSwitchRoleOptions = useMemo(() => {
    const discovered = new Set(["admin", "seller", "buyer", "trader"]);
    adminSwitchUsers.forEach((user) => {
      (Array.isArray(user?.roles) ? user.roles : []).forEach((role) => {
        const normalized = String(role || "").trim().toLowerCase();
        if (normalized) discovered.add(normalized);
      });
    });
    return ["", ...Array.from(discovered)];
  }, [adminSwitchUsers]);

  const filteredAdminSwitchUsers = useMemo(() => {
    if (!adminSwitchRole) return adminSwitchUsers;
    return adminSwitchUsers.filter((user) =>
      Array.isArray(user?.roles)
        ? user.roles.some(
            (role) =>
              String(role || "").trim().toLowerCase() === adminSwitchRole,
          )
        : false,
    );
  }, [adminSwitchRole, adminSwitchUsers]);

  const activeSwitchUser = useMemo(
    () =>
      filteredAdminSwitchUsers.find(
        (user) => String(user?.user_id || "") === runtimeActiveUserId,
      ) ||
      adminSwitchUsers.find(
        (user) => String(user?.user_id || "") === runtimeActiveUserId,
      ) ||
      null,
    [adminSwitchUsers, filteredAdminSwitchUsers, runtimeActiveUserId],
  );

  const navigationUser = useMemo(() => {
    if (!isRootAdminSwitcher) {
      return normalizeUserAccess(authUser);
    }
    if (activeSwitchUser) {
      return normalizeUserAccess(activeSwitchUser);
    }
    if (adminSwitchRole) {
      return normalizeUserAccess({
        ...authUser,
        roles: [adminSwitchRole],
        permissions: [],
      });
    }
    return normalizeUserAccess(authUser);
  }, [
    activeSwitchUser,
    adminSwitchRole,
    authUser,
    isRootAdminSwitcher,
  ]);
  const navigationRoles = Array.isArray(navigationUser?.roles)
    ? navigationUser.roles.map((role) => String(role || "").trim().toLowerCase())
    : [];
  const navIsAdmin = navigationRoles.includes("admin");
  const navIsSeller = navigationRoles.includes("seller");
  const navIsBuyer = navigationRoles.includes("buyer");
  const navShows42PayOnly =
    isRootAdminSwitcher &&
    (Boolean(runtimeActiveUserId) || Boolean(adminSwitchRole)) &&
    !navIsAdmin &&
    (navIsSeller || navIsBuyer);

  const guardPageElement = (permission, element) =>
    canAccessPage(navigationUser, permission) ? element : <Navigate to="/login" replace />;

  const systemMenuItems = [
    { to: "/system/files", label: "Files", permission: "pages.system.files" },
    { to: "/system/cache", label: "Cache", permission: "pages.system.cache" },
    { to: "/system/logs", label: "Logs", permission: "pages.system.logs" },
    { to: "/system/db", label: "DB Manager", permission: "pages.system.db_manager" },
    { to: "/system/health", label: "Health", permission: "pages.system.health" },
    { to: "/system/users", label: "Users", permission: "pages.system.users" },
  ].filter((item) => canAccessPage(navigationUser, item.permission));

  const userMenuItems = [
    { to: "/settings/profile", label: "Profile", permission: "pages.settings.profile" },
    { to: "/settings/accounts", label: "Accounts", permission: "pages.settings.accounts" },
    { to: "/settings/crons", label: "Cron", permission: "pages.settings.crons" },
    { to: "/settings/providers", label: "Providers", permission: "pages.settings.providers" },
    { to: "/settings/notification", label: "Settings", permission: "pages.settings.notification" },
  ].filter((item) => canAccessPage(navigationUser, item.permission));

  const aiMenuItems = [
    { to: "/trades/analyze", label: "Analyze", permission: "pages.ai.analyze" },
    { to: "/trades/response", label: "Response", permission: "pages.ai.response" },
    { to: "/trades/news", label: "News", permission: "pages.ai.news" },
  ].filter((item) => canAccessPage(navigationUser, item.permission));

  const pay42MenuItems = [
    { to: "/admin/42pay/dashboard", label: navIsBuyer ? "Wallet" : "Dashboard", permission: "pages.42pay.dashboard" },
    { to: "/admin/42pay/products", label: "Products", permission: "pages.42pay.products" },
    { to: "/admin/42pay/offers", label: navIsBuyer ? "Browse Offers" : "Offers", permission: "pages.42pay.offers" },
    ...(Array.isArray(navigationUser?.roles) &&
    navigationUser.roles.length === 1 &&
    String(navigationUser.roles[0] || "").trim().toLowerCase() === "buyer"
      ? [
          { to: "/admin/42pay/scan", label: "Pay", permission: "pages.42pay.scan" },
          { to: "/admin/42pay/topup", label: "Top Up", permission: "pages.42pay.topup" },
        ]
      : []),
    { to: "/admin/42pay/orders", label: navIsBuyer ? "My Purchases" : "Orders", permission: "pages.42pay.orders" },
    { to: "/admin/42pay/admin/users", label: "Admin", permission: "pages.42pay.admin.users" },
  ].filter((item) => canAccessPage(navigationUser, item.permission));

  const primaryNavGroupCount = [
    pay42MenuItems.length > 0,
    !navShows42PayOnly && canAccessPage(navigationUser, "pages.trades"),
    !navShows42PayOnly && canAccessPage(navigationUser, "pages.studio"),
  ].filter(Boolean).length;
  const flattenPay42Navigation =
    primaryNavGroupCount === 1 && pay42MenuItems.length > 0;

  const tradesHomePath = canAccessPage(navigationUser, "pages.dashboard")
    ? "/trades/dashboard"
    : canAccessPage(navigationUser, "pages.ai.analyze")
      ? "/trades/analyze"
      : canAccessPage(navigationUser, "pages.backtests")
        ? "/trades/backtests"
        : "/trades/filled";

  const tradeMenuItems = [
    { to: "/trades/dashboard", label: "Dashboard", permission: "pages.dashboard" },
    { to: "/trades/analyze", label: "Analyze", permission: "pages.ai.analyze" },
    { to: "/trades/backtests", label: "Backtests", permission: "pages.backtests" },
    { to: "/trades/filled", label: `Positions${countBadge("FILLED")}` },
    { to: "/trades/pending", label: `Orders${countBadge("PENDING")}` },
    { to: "/trades/closed", label: `Closed${countBadge("CLOSED")}` },
    { to: "/trades/rejected", label: `Rejected${countBadge("REJECTED")}` },
    { to: "/trades/cancelled", label: `Cancelled${countBadge("CANCELLED")}` },
    { to: "/trades/draft", label: `Draft${countBadge("DRAFT")}` },
  ].filter((item) =>
    item.permission ? canAccessPage(navigationUser, item.permission) : true,
  );
  const flattenTradesNavigation =
    primaryNavGroupCount === 1 &&
    pay42MenuItems.length === 0 &&
    tradeMenuItems.length > 0;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ui_theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isRootAdminSwitcher) {
      setAdminSwitchUsers([]);
      setAdminSwitchRole("");
      return;
    }
    let cancelled = false;
    api
      .listUserSelectOptions()
      .then((out) => {
        if (cancelled) return;
        const users = Array.isArray(out?.users) ? out.users : [];
        setAdminSwitchUsers(users);
      })
      .catch(() => {
        if (!cancelled) setAdminSwitchUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isRootAdminSwitcher]);

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

  // Fetch trade counts for nav badges (single GROUP BY query, cached 30s)
  useEffect(() => {
    if (!tradeCountsPollingEnabled) return undefined;
    if (suppressTradeCountsPolling) return undefined;
    if (pay42MenuActive) return undefined;
    if (authLoading) return undefined;
    if (!navigationUser) return undefined;
    if (!canAccessPage(navigationUser, "pages.trades")) return undefined;
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
  }, [
    authLoading,
    navigationUser,
    pay42MenuActive,
    suppressTradeCountsPolling,
    tradeCountsPollingEnabled,
  ]);

  useEffect(() => {
    if (isLoginRoute) {
      setAuthLoading(false);
      return undefined;
    }
    let cancelled = false;
    const startedAuthVersion = authVersionRef.current;

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
        if (
          !shouldApplyBootstrapAuthResult({
            cancelled,
            startedAuthVersion,
            currentAuthVersion: authVersionRef.current,
          })
        )
          return;
        if (meRes.status === "fulfilled" && meRes.value?.user) {
          const user = meRes.value.user;
          setAuthUser(user);
          storeAuthUserSnapshot(user);
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
        } else if (isExplicitAuthFailure(meRes.reason)) {
          setAuthUser(null);
          storeAuthUserSnapshot(null);
        } else {
          console.warn(
            "[auth] transient bootstrap auth failure; keeping previous session snapshot",
            {
              healthStatus: healthRes.status,
              authStatus: meRes.status,
              authError:
                meRes.status === "rejected"
                  ? String(meRes.reason?.message || meRes.reason || "")
                  : "",
            },
          );
        }
      })
      .finally(() => {
        if (
          shouldApplyBootstrapAuthResult({
            cancelled,
            startedAuthVersion,
            currentAuthVersion: authVersionRef.current,
          })
        ) {
          setAuthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoginRoute]);

  useEffect(() => {
    const onAuthRequired = () => {
      authVersionRef.current += 1;
      setAuthUser(null);
      storeAuthUserSnapshot(null);
      setAuthLoading(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const handleUserUpdate = (user) => {
    authVersionRef.current += 1;
    if (user) {
      setAuthUser(user);
      storeAuthUserSnapshot(user);
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
      return;
    }
    setAuthUser(null);
    storeAuthUserSnapshot(null);
  };
  const handleLogin = (user) => handleUserUpdate(user);
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // noop
    }
    authVersionRef.current += 1;
    setAuthUser(null);
    storeAuthUserSnapshot(null);
    setAuthLoading(false);
  };
  const closeMobileNav = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("mobile-nav-close"));
    }
  };
  const applyAdminSwitchUser = (userId = "") => {
    setRuntimeActiveUserId(userId);
    window.location.reload();
  };
  const handleAdminRoleFilter = (roleId = "") => {
    const nextRole = String(roleId || "").trim().toLowerCase();
    setAdminSwitchRole(nextRole);
    if (!nextRole) return;
    if (
      runtimeActiveUserId &&
      filteredAdminSwitchUsers.some(
        (user) => String(user?.user_id || "") === runtimeActiveUserId,
      )
    ) {
      return;
    }
  };

  if (authLoading) {
    return <div className="loading">Loading...</div>;
  }

  if (shouldRequireLoginScreen({ authUser })) {
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
            <Route path="*" element={<Navigate to={`/login?return_url=${loginReturnUrl}`} replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  const actingAsBadge = runtimeActiveUserId ? (
    <span style={{ marginLeft: 10, fontSize: "11px", color: "#f39c12" }}>
      (Acting as {runtimeActiveUserId})
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
  const loggedInUserId = String(authUser?.user_id || "").trim();
  const isActingAsLoggedInUser =
    runtimeActiveUserId && runtimeActiveUserId === loggedInUserId;
  const visibleSwitchUser =
    activeSwitchUser ||
    adminSwitchUsers.find(
      (user) => String(user?.user_id || "") === loggedInUserId,
    ) ||
    authUser ||
    null;
  const formatAdminSwitchUserLabel = (user = null) => {
    if (!user) return "";
    const userId = String(user?.user_id || "").trim();
    const baseLabel = String(user?.name || userId || "").trim();
    if (!baseLabel) return "";
    return userId && userId === loggedInUserId
      ? `${baseLabel} (me)`
      : baseLabel;
  };
  const adminUserLabel = formatAdminSwitchUserLabel(visibleSwitchUser) || "User";
  const showSystemMenu = systemMenuItems.length > 0;
  const showUserMenu = true;
  const adminSwitchMenus = isRootAdminSwitcher ? (
    <>
      <NavDropdown
        trigger={
          <button type="button" className="secondary-button nav-dropdown-trigger">
            <span className="combo-button-menu-trigger__label">{adminUserLabel}</span>
            <span aria-hidden="true" className="combo-button-menu-trigger__caret">
              ▾
            </span>
          </button>
        }
      >
        {filteredAdminSwitchUsers.map((user) => {
          const userId = String(user?.user_id || "");
          const isLoggedInUser = userId === loggedInUserId;
          const isSelected = runtimeActiveUserId
            ? userId === runtimeActiveUserId || (isLoggedInUser && isActingAsLoggedInUser)
            : isLoggedInUser;
          return (
          <button
            key={userId}
            type="button"
            className={`nav-item-button ${isSelected ? "active" : ""}`}
            onClick={() => applyAdminSwitchUser(isLoggedInUser ? "" : userId)}
            style={{
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            title={`${userId} (${Array.isArray(user.roles) ? user.roles.join(", ") : "-"})`}
          >
            {formatAdminSwitchUserLabel(user)}
          </button>
          );
        })}
      </NavDropdown>
    </>
  ) : null;

  const mobileTopbarContent = null;

  const topbarContent = (
    <SiteNavigation
      logo={payHubBrandLogo}
      title={null}
      onHomeClick={closeMobileNav}
      homeTo={homePath}
      brandExtras={<>{actingAsBadge}</>}
      nav={
        <nav>
          {flattenPay42Navigation
            ? pay42MenuItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `mobile-nav-link ${isActive ? "active" : ""}`
                  }
                  onClick={closeMobileNav}
                >
                  {item.label}
                </NavLink>
              ))
            : pay42MenuItems.length > 0 && (
            <NavDropdown
              align="start"
              trigger={
                <NavLink
                  to={pay42MenuItems[0].to}
                  className={() =>
                    `mobile-nav-link ${pay42MenuActive ? "active" : ""}`
                  }
                >
                  Pay
                </NavLink>
              }
            >
              {pay42MenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </NavDropdown>
          )}
          {!navShows42PayOnly && canAccessPage(navigationUser, "pages.trades") &&
            (flattenTradesNavigation
              ? tradeMenuItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `mobile-nav-link ${isActive ? "active" : ""}`
                    }
                    onClick={closeMobileNav}
                  >
                    {item.label}
                  </NavLink>
                ))
              : (
                <NavDropdown
                  align="start"
                  trigger={
                    <NavLink
                      to={tradesHomePath}
                      className={() =>
                        `mobile-nav-link ${tradesMenuActive ? "active" : ""}`
                      }
                    >
                      Trades
                    </NavLink>
                  }
                >
                  {tradeMenuItems.map((item) => (
                    <NavLink key={item.to} to={item.to}>
                      {item.label}
                    </NavLink>
                  ))}
                </NavDropdown>
              ))}
          {!navShows42PayOnly && canAccessPage(navigationUser, "pages.studio") && (
            <NavLink
              to="/studio"
              className={() =>
                `mobile-nav-link ${studioMenuActive ? "active" : ""}`
              }
              onClick={closeMobileNav}
            >
              Studio
            </NavLink>
          )}

          <div style={{ flex: 1 }} />

          {adminSwitchMenus}
          {showSystemMenu && (
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
              {systemMenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </NavDropdown>
          )}
          {showUserMenu && (
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
              {userMenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
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
          )}
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
      logo={payHubBrandLogo}
      title={null}
      onHomeClick={closeMobileNav}
      homeTo={homePath}
      nav={
        <nav>
          {flattenPay42Navigation
            ? pay42MenuItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `mobile-nav-link ${isActive ? "active" : ""}`
                  }
                  onClick={closeMobileNav}
                >
                  {item.label}
                </NavLink>
              ))
            : pay42MenuItems.length > 0 && (
            <NavDropdown
              align="start"
              trigger={
                <NavLink
                  to={pay42MenuItems[0].to}
                  className={() =>
                    `mobile-nav-link ${pay42MenuActive ? "active" : ""}`
                  }
                >
                  Pay
                </NavLink>
              }
            >
              {pay42MenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </NavDropdown>
          )}
          {!navShows42PayOnly && canAccessPage(navigationUser, "pages.trades") &&
            (flattenTradesNavigation
              ? tradeMenuItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `mobile-nav-link ${isActive ? "active" : ""}`
                    }
                    onClick={closeMobileNav}
                  >
                    {item.label}
                  </NavLink>
                ))
              : (
                <NavDropdown
                  align="start"
                  trigger={
                    <NavLink
                      to={tradesHomePath}
                      className={() =>
                        `mobile-nav-link ${tradesMenuActive ? "active" : ""}`
                      }
                    >
                      Trades
                    </NavLink>
                  }
                >
                  {tradeMenuItems.map((item) => (
                    <NavLink key={item.to} to={item.to}>
                      {item.label}
                    </NavLink>
                  ))}
                </NavDropdown>
              ))}
          {!navShows42PayOnly && canAccessPage(navigationUser, "pages.studio") && (
            <NavLink
              to="/studio"
              className={() =>
                `mobile-nav-link ${studioMenuActive ? "active" : ""}`
              }
              onClick={closeMobileNav}
            >
              Studio
            </NavLink>
          )}

          <div style={{ flex: 1 }} />

          {adminSwitchMenus}
          {showSystemMenu && (
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
              {systemMenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </NavDropdown>
          )}
          {showUserMenu && (
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
              {userMenuItems.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
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
          )}
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

  const mobileBottomBarContent = flattenPay42Navigation ? (
    <>
      {pay42MenuItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `mobile-bottom-bar__link ${isActive ? "active" : ""}`
          }
        >
          <span className="mobile-bottom-bar__label">{item.label}</span>
        </NavLink>
      ))}
    </>
  ) : null;

  return (
    <AppShell
      topbar={topbarContent}
      mobileTopbar={mobileTopbarContent}
      mobileDrawer={mobileDrawerContent}
      mobileBottomBar={mobileBottomBarContent}
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
              <Route path="/" element={<Navigate to={homePath} replace />} />
              <Route
                path="/apps"
                element={guardPageElement(
                  "pages.system.db_manager",
                  <Navigate to="/system/db" replace />,
                )}
              />
              <Route
                path="/admin/42pay"
                element={<Navigate to="/admin/42pay/dashboard" replace />}
              />
              <Route
                path="/admin/42pay/dashboard"
                element={guardPageElement("pages.42pay.dashboard", <Pay42DashboardPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/products"
                element={guardPageElement("pages.42pay.products", <Pay42ProductsPage />)}
              />
              <Route
                path="/admin/42pay/offers"
                element={guardPageElement("pages.42pay.offers", <Pay42OffersPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/scan"
                element={guardPageElement("pages.42pay.scan", <Pay42ScanPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/orders"
                element={guardPageElement("pages.42pay.orders", <Pay42OrdersPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/topup"
                element={guardPageElement("pages.42pay.topup", <Pay42TopupPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/orders/:orderSid/confirmation"
                element={guardPageElement("pages.42pay.orders", <Pay42PurchaseConfirmationPage authUser={authUser} />)}
              />
              <Route
                path="/admin/42pay/admin/users"
                element={guardPageElement("pages.42pay.admin.users", <Pay42AdminUsersPage />)}
              />
              <Route
                path="/admin/pay42"
                element={<Navigate to="/admin/42pay/dashboard" replace />}
              />
              <Route
                path="/admin/pay42/dashboard"
                element={<Navigate to="/admin/42pay/dashboard" replace />}
              />
              <Route
                path="/admin/pay42/products"
                element={<Navigate to="/admin/42pay/products" replace />}
              />
              <Route
                path="/admin/pay42/offers"
                element={<Navigate to="/admin/42pay/offers" replace />}
              />
              <Route
                path="/admin/pay42/scan"
                element={<Navigate to="/admin/42pay/scan" replace />}
              />
              <Route
                path="/admin/pay42/orders"
                element={<Navigate to="/admin/42pay/orders" replace />}
              />
              <Route
                path="/admin/pay42/topup"
                element={<Navigate to="/admin/42pay/topup" replace />}
              />
              <Route
                path="/admin/pay42/orders/:orderSid/confirmation"
                element={<LegacyPay42ConfirmationRedirect />}
              />
              <Route
                path="/admin/pay42/admin/users"
                element={<Navigate to="/admin/42pay/admin/users" replace />}
              />
              <Route
                path="/42pay"
                element={<Navigate to="/admin/42pay/dashboard" replace />}
              />
              <Route
                path="/42pay/dashboard"
                element={<Navigate to="/admin/42pay/dashboard" replace />}
              />
              <Route
                path="/42pay/products"
                element={<Navigate to="/admin/42pay/products" replace />}
              />
              <Route
                path="/42pay/offers"
                element={<Navigate to="/admin/42pay/offers" replace />}
              />
              <Route
                path="/42pay/scan"
                element={<Navigate to="/admin/42pay/scan" replace />}
              />
              <Route
                path="/42pay/orders"
                element={<Navigate to="/admin/42pay/orders" replace />}
              />
              <Route
                path="/42pay/topup"
                element={<Navigate to="/admin/42pay/topup" replace />}
              />
              <Route
                path="/42pay/orders/:orderSid/confirmation"
                element={<LegacyPay42ConfirmationRedirect />}
              />
              <Route
                path="/42pay/admin/users"
                element={<Navigate to="/admin/42pay/admin/users" replace />}
              />
              <Route
                path="/dashboard"
                element={<Navigate to="/trades/dashboard" replace />}
              />
              <Route
                path="/trades"
                element={<Navigate to={tradesHomePath} replace />}
              />
              <Route
                path="/trades/dashboard"
                element={guardPageElement("pages.dashboard", <DashboardPage />)}
              />
              <Route
                path="/trades/analyze"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/analyze/:symbol"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/result"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/result/:symbol"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/trade"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/trade/:symbol"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/manual"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/manual/:symbol"
                element={guardPageElement("pages.ai.analyze", <ChartSnapshotsPage />)}
              />
              <Route
                path="/trades/response"
                element={guardPageElement("pages.ai.response", <TempTradesPage />)}
              />
              <Route
                path="/trades/response/:symbol"
                element={guardPageElement("pages.ai.response", <TempTradesPage />)}
              />
              <Route
                path="/trades/news"
                element={guardPageElement("pages.ai.news", <AiNewsPage />)}
              />
              <Route
                path="/trades/backtests"
                element={guardPageElement("pages.backtests", <BacktestsPage />)}
              />
              <Route
                path="/trades/backtests/:runId"
                element={guardPageElement("pages.backtests", <BacktestsPage />)}
              />
              <Route
                path="/trades/:status"
                element={guardPageElement("pages.trades", <TradesPage />)}
              />
              <Route
                path="/trades/:tradeId"
                element={guardPageElement("pages.trades", <TradesPage />)}
              />
              <Route
                path="/trades/:status/:tradeId"
                element={guardPageElement("pages.trades", <TradesPage />)}
              />
              <Route
                path="/backtests"
                element={<Navigate to="/trades/backtests" replace />}
              />
              <Route
                path="/backtests/:runId"
                element={<Navigate to="/trades/backtests" replace />}
              />
              <Route
                path="/studio"
                element={guardPageElement("pages.studio", <StudioPage authUser={authUser} />)}
              />
              <Route
                path="/ai"
                element={<Navigate to="/trades/analyze" replace />}
              />
              <Route
                path="/ai/analyze"
                element={<Navigate to="/trades/analyze" replace />}
              />
              <Route
                path="/ai/analyze/:symbol"
                element={<Navigate to="/trades/analyze" replace />}
              />
              <Route
                path="/ai/result"
                element={<Navigate to="/trades/result" replace />}
              />
              <Route
                path="/ai/result/:symbol"
                element={<Navigate to="/trades/result" replace />}
              />
              <Route
                path="/ai/trade"
                element={<Navigate to="/trades/trade" replace />}
              />
              <Route
                path="/ai/trade/:symbol"
                element={<Navigate to="/trades/trade" replace />}
              />
              <Route
                path="/ai/manual"
                element={<Navigate to="/trades/manual" replace />}
              />
              <Route
                path="/ai/manual/:symbol"
                element={<Navigate to="/trades/manual" replace />}
              />
              <Route
                path="/ai/response"
                element={<Navigate to="/trades/response" replace />}
              />
              <Route
                path="/ai/response/:symbol"
                element={<Navigate to="/trades/response" replace />}
              />
              <Route
                path="/ai/news"
                element={<Navigate to="/trades/news" replace />}
              />
              <Route
                path="/ai/browser"
                element={<Navigate to="/trades/analyze" replace />}
              />
              <Route
                path="/ai/browser/:symbol"
                element={<Navigate to="/trades/analyze" replace />}
              />
              <Route
                path="/settings/profile"
                element={guardPageElement(
                  "pages.settings.profile",
                  <ProfilePage authUser={authUser} onUserUpdate={handleUserUpdate} />,
                )}
              />
              <Route
                path="/settings/crons"
                element={guardPageElement("pages.settings.crons", <CronPage />)}
              />
              <Route
                path="/settings/crons/:cronName"
                element={guardPageElement("pages.settings.crons", <CronPage />)}
              />
              <Route
                path="/settings/providers"
                element={guardPageElement("pages.settings.providers", <ProvidersPage />)}
              />
              <Route
                path="/settings/providers/:providerName"
                element={guardPageElement("pages.settings.providers", <ProvidersPage />)}
              />
              <Route
                path="/settings/accounts"
                element={guardPageElement("pages.settings.accounts", <AccountsV2Page />)}
              />
              <Route
                path="/settings/notification"
                element={guardPageElement(
                  "pages.settings.notification",
                  <SettingsPage showNotifications />,
                )}
              />
              <Route
                path="/settings/analyse"
                element={
                  guardPageElement(
                    "pages.settings.analyse",
                    <SettingsPage
                      routeAlias={{ type: "settings", name: "ANALYSE_SETTINGS" }}
                    />,
                  )
                }
              />
              <Route
                path="/settings/log_prefixes"
                element={
                  guardPageElement(
                    "pages.system.logs",
                    <SettingsPage
                      routeAlias={{
                        type: "system_config",
                        name: "enabled_log_prefixes",
                      }}
                    />,
                  )
                }
              />
              <Route
                path="/settings/execution_profile"
                element={
                  guardPageElement(
                    "pages.settings.execution_profile",
                    <SettingsPage
                      routeAlias={{ type: "execution_profile", name: "default" }}
                    />,
                  )
                }
              />
              <Route
                path="/settings/symbol_groups"
                element={
                  guardPageElement(
                    "pages.settings.symbol_groups",
                    <SettingsPage
                      routeAlias={{ type: "symbol_groups", name: "default" }}
                    />,
                  )
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
                element={guardPageElement("pages.settings.notification", <SettingsPage />)}
              />
              <Route
                path="/settings"
                element={guardPageElement("pages.settings.notification", <SettingsPage />)}
              />
              <Route
                path="/apps/db-manager"
                element={guardPageElement(
                  "pages.system.db_manager",
                  <Navigate to="/system/db" replace />,
                )}
              />
              <Route
                path="/apps/system-files"
                element={<Navigate to="/system/files" replace />}
              />
              <Route
                path="/apps/system-cache"
                element={<Navigate to="/system/cache" replace />}
              />
              <Route
                path="/apps/system-logs"
                element={<Navigate to="/system/logs" replace />}
              />
              <Route
                path="/apps/system-health"
                element={<Navigate to="/system/health" replace />}
              />
              <Route
                path="/apps/:appId"
                element={<LegacyMiniAppRedirect />}
              />
              <Route
                path="/miniapps/:appId"
                element={<LegacyMiniAppRedirect />}
              />
              <Route
                path="/system/files"
                element={guardPageElement(
                  "pages.system.files",
                  <SystemBrowserPage mode="files" title="System Files" authUser={authUser} />,
                )}
              />
              <Route
                path="/system/snapshots"
                element={<Navigate to="/system/files" replace />}
              />
              <Route
                path="/system/storage"
                element={<Navigate to="/system/files" replace />}
              />
              <Route
                path="/system/cache"
                element={guardPageElement("pages.system.cache", <SystemCachePage />)}
              />
              <Route
                path="/system/logs/:logId"
                element={<Navigate to="/system/logs" replace />}
              />
              <Route
                path="/system/logs"
                element={guardPageElement(
                  "pages.system.logs",
                  <SystemBrowserPage mode="logs" title="System Logs" authUser={authUser} />,
                )}
              />
              <Route
                path="/system/db"
                element={guardPageElement("pages.system.db_manager", <DbManagerPage />)}
              />
              <Route
                path="/system/health"
                element={guardPageElement("pages.system.health", <SystemHealthPage />)}
              />
              <Route
                path="/system/users/:userId"
                element={guardPageElement(
                  "pages.system.users",
                  <UsersPage authUser={authUser} />,
                )}
              />
              <Route
                path="/system/users"
                element={guardPageElement(
                  "pages.system.users",
                  <UsersPage authUser={authUser} />,
                )}
              />
              <Route
                path="/system/accounts/:accountId"
                element={guardPageElement(
                  "pages.system.accounts",
                  <AccountsV2Page />,
                )}
              />
              <Route
                path="/system/accounts"
                element={guardPageElement(
                  "pages.system.accounts",
                  <AccountsV2Page />,
                )}
              />
              <Route
                path="/tools"
                element={<Navigate to={homePath} replace />}
              />
              <Route
                path="/tools/notification"
                element={<Navigate to={homePath} replace />}
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
                element={<Navigate to="/system/files" replace />}
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
                element={<Navigate to="/system/db" replace />}
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
                element={<Navigate to={homePath} replace />}
              />
              <Route path="*" element={<Navigate to={homePath} replace />} />
              </Routes>
            </Suspense>
          </RouteLoadBoundary>
        </main>
      </ConfirmDialogProvider>
    </AppShell>
  );
}
