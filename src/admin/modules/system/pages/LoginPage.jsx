import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  api,
  getRuntimeApiBase,
  getRuntimeDirectDevApiBase,
} from "../../../app/api";
import InputComboSelect from "../../../shared/components/InputComboSelect";

function text(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function buildQuickUsers() {
  const env = import.meta.env;
  return [
    {
      user_id: text(env.VITE_UI_LOGIN_USER_USERNAME, "user"),
      name: text(env.VITE_UI_LOGIN_USER_USERNAME, "user"),
      login: text(env.VITE_UI_LOGIN_USER_USERNAME, "user"),
      password: text(env.VITE_UI_LOGIN_USER_PASSWORD, "123456"),
    },
    {
      user_id: text(env.VITE_UI_LOGIN_SELLER_USERNAME, "seller"),
      name: text(env.VITE_UI_LOGIN_SELLER_USERNAME, "seller"),
      login: text(env.VITE_UI_LOGIN_SELLER_USERNAME, "seller"),
      password: text(env.VITE_UI_LOGIN_SELLER_PASSWORD, "123456"),
    },
    {
      user_id: text(env.VITE_UI_LOGIN_ADMIN_USERNAME, "admin"),
      name: text(env.VITE_UI_LOGIN_ADMIN_USERNAME, "admin"),
      login: text(env.VITE_UI_LOGIN_ADMIN_USERNAME, "admin"),
      password: text(env.VITE_UI_LOGIN_ADMIN_PASSWORD, "123456"),
    },
    {
      user_id: text(env.VITE_UI_LOGIN_TRADER_USERNAME, "trader"),
      name: text(env.VITE_UI_LOGIN_TRADER_USERNAME, "trader"),
      login: text(env.VITE_UI_LOGIN_TRADER_USERNAME, "trader"),
      password: text(env.VITE_UI_LOGIN_TRADER_PASSWORD, "123456"),
    },
  ].filter((user, index, all) => {
    const userId = String(user?.user_id || "").trim();
    if (!userId) return false;
    return all.findIndex((item) => item.user_id === userId) === index;
  });
}

async function probeApiService() {
  const candidates = [
    getRuntimeDirectDevApiBase(),
    getRuntimeApiBase(),
    window.location.hostname === "localhost" ? "http://localhost:3001" : "",
    window.location.hostname === "127.0.0.1" ? "http://127.0.0.1:3001" : "",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
  ]
    .map((value) => String(value || "").trim().replace(/\/+$/, ""))
    .filter((value, index, all) => value && all.indexOf(value) === index);

  for (const base of candidates) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);
    try {
      const probeUrl = new URL("/health", `${base}/`).toString();
      await fetch(probeUrl, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      return true;
    } catch {
      // try next candidate
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw new Error("API service is not running on port 3001.");
}

export default function LoginPage({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiReady, setApiReady] = useState(true);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectableUsers = useMemo(() => buildQuickUsers(), []);
  const effectiveReturnUrl = useMemo(() => {
    const queryValue = searchParams.get("return_url");
    if (queryValue) return queryValue;
    try {
      return sessionStorage.getItem("tvbridge_pending_return_url") || "";
    } catch {
      return "";
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    let retryId = null;
    async function checkApi() {
      try {
        setError("");
        await probeApiService();
        if (!active) return;
        setApiReady(true);
        if (retryId) {
          window.clearTimeout(retryId);
          retryId = null;
        }
      } catch (err) {
        if (!active) return;
        setApiReady(false);
        setError(err?.message || "API service is not running on port 3001.");
        retryId = window.setTimeout(() => {
          if (!active) return;
          checkApi();
        }, 3000);
      }
    }
    checkApi();
    return () => {
      active = false;
      if (retryId) window.clearTimeout(retryId);
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const out = await api.login(login, password);
      onLogin?.(out?.user || null);
      // Use client-side navigation to avoid full page reload
      // (full reload would re-init React and re-check authMe, which can fail
      //  when cookie isn't yet established on cross-origin dev setups).
      // React Router will automatically redirect /login → /trades/dashboard via
      // the authenticated route's <Navigate to="/trades/dashboard" replace />.
      const returnUrl = effectiveReturnUrl;
      try {
        sessionStorage.removeItem("tvbridge_pending_return_url");
      } catch {
        // ignore
      }
      if (returnUrl) {
        const decoded = decodeURIComponent(returnUrl);
        if (/^https?:\/\//i.test(decoded)) {
          window.location.assign(decoded);
          return;
        }
        navigate(decoded, { replace: true });
      }
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleUserSelect(nextValue) {
    if (nextValue === "__none__") {
      setSelectedUser("");
      return;
    }
    setSelectedUser(nextValue);
    if (!nextValue) return;
    const picked =
      selectableUsers.find(
        (user) => String(user?.user_id || "") === String(nextValue),
      ) || null;
    if (!picked) return;
    setLogin(String(picked.login || picked.email || picked.name || ""));
    setPassword(String(picked.password || ""));
  }

  return (
    <section
      className="panel stack-layout login-page fadeIn"
      style={{ maxWidth: "400px", margin: "100px auto" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <img
          src="/logo/payhub-p-payhub-final.png"
          alt="42Trade"
          style={{ width: 56, height: 56, objectFit: "contain" }}
        />
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.2,
            color: "var(--text-primary)",
          }}
        >
          Login
        </div>
      </div>
      <form onSubmit={submit} className="stack-layout" style={{ gap: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div className="minor-text">Username or Email</div>
          <input
            type="text"
            value={login}
            placeholder="Enter your username or email"
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div className="minor-text">Password</div>
          <input
            type="password"
            value={password}
            placeholder="Enter your password"
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div className="minor-text">Quick User</div>
          <InputComboSelect
            value={selectedUser || "__none__"}
            onChange={(e) => handleUserSelect(e.target.value)}
            style={{ width: "100%" }}
            items={[
              {
                value: "__none__",
                label: "Select a user",
                disabled: true,
              },
              ...selectableUsers.map((user) => ({
                value: user.user_id || "",
                label: user.name || user.login || user.user_id || "",
              })),
            ]}
          />
        </label>
        {error ? <div className="error">{error}</div> : null}
        <button
          type="submit"
          className="secondary-button"
          disabled={loading}
          style={{ width: "100%"}}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}
