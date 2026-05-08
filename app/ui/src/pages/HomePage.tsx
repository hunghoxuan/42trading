import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

export default function HomePage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 14,
  };

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000,
  });

  const trades = useQuery({
    queryKey: ["trades"],
    queryFn: () => api.trades({ limit: "10" }),
    enabled: loggedIn,
  });

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    try {
      await api.login(email, password);
      setLoggedIn(true);
    } catch (err) {
      setAuthError((err as Error).message);
    }
  }

  return (
    <div>
      {/* Health */}
      <div
        className="panel"
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: health.data?.ok ? "#22c55e" : "#ef4444",
          }}
        />
        <strong style={{ fontSize: 14 }}>
          {health.data?.ok ? "Connected" : "Disconnected"}
        </strong>
        <span className="minor-text" style={{ fontSize: 12 }}>
          {health.data?.version || "..."}
        </span>
        {loggedIn && (
          <button
            className="secondary-button"
            style={{ marginLeft: "auto", fontSize: 11 }}
            onClick={() => {
              api.logout().then(() => setLoggedIn(false));
            }}
          >
            Logout
          </button>
        )}
      </div>

      {/* Login */}
      {!loggedIn && (
        <div style={{ maxWidth: 360, margin: "40px auto" }}>
          <form
            onSubmit={login}
            className="panel"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="panel-label">Login to view trades</div>
            {authError && (
              <div className="error" style={{ fontSize: 12 }}>
                {authError}
              </div>
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
            <button
              type="submit"
              className="primary-button"
              style={{ width: "100%" }}
            >
              Login
            </button>
          </form>
        </div>
      )}

      {/* Trades */}
      {loggedIn && (
        <div className="panel">
          <div className="panel-label">Recent Trades</div>
          {trades.isLoading ? (
            <div className="loading">Loading...</div>
          ) : trades.error ? (
            <div className="error">{(trades.error as Error).message}</div>
          ) : (
            <table className="events-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {(trades.data?.items || []).slice(0, 10).map((t: any) => (
                  <tr key={t.sid || t.id}>
                    <td>
                      <strong>{t.symbol}</strong>
                    </td>
                    <td>
                      <span
                        className={
                          t.action === "BUY" ? "side-buy" : "side-sell"
                        }
                      >
                        {t.action}
                      </span>
                    </td>
                    <td>
                      <span className="badge">{t.execution_status}</span>
                    </td>
                    <td
                      className={
                        Number(t.pnl_realized || 0) >= 0
                          ? "money-pos"
                          : "money-neg"
                      }
                    >
                      ${Number(t.pnl_realized || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
