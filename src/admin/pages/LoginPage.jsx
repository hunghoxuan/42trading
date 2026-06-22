import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function LoginPage({ onLogin }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

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
      // React Router will automatically redirect /login → /dashboard via
      // the authenticated route's <Navigate to="/dashboard" replace />.
      const returnUrl = searchParams.get("return_url");
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

  return (
    <section
      className="panel stack-layout login-page fadeIn"
      style={{ maxWidth: "400px", margin: "100px auto" }}
    >
      <div className="panel-label">AUTHENTICATION</div>
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
        {error ? <div className="error">{error}</div> : null}
        <button
          type="submit"
          className="secondary-button"
          disabled={loading}
          style={{ width: "100%"}}
        >
          {loading ? "🔐 AUTHORIZING..." : "🔐 SIGN IN"}
        </button>
      </form>
    </section>
  );
}
