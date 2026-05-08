import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

export default function HomePage() {
  const [authMode, setAuthMode] = useState<"login" | "apikey">("apikey");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem("tvbridge_api_key") || "",
  );
  const [authError, setAuthError] = useState("");

  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 14,
    width: "100%",
  };

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 30000,
  });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    try {
      await api.login(email, password);
    } catch (err) {
      setAuthError((err as Error).message);
    }
  }

  function handleApiKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("tvbridge_api_key", apiKey);
    // Force refetch
    window.location.reload();
  }

  const connected = health.data?.ok;

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
            background: connected ? "#22c55e" : "#ef4444",
          }}
        />
        <strong style={{ fontSize: 14 }}>
          {connected ? "Connected" : "Disconnected"}
        </strong>
        <span className="minor-text" style={{ fontSize: 12 }}>
          {health.data?.version || "..."}
        </span>
      </div>

      {/* Auth */}
      {!connected && (
        <div style={{ maxWidth: 380, margin: "20px auto" }}>
          <div
            className="panel"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {/* Mode switch */}
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className={`secondary-button ${authMode === "apikey" ? "active" : ""}`}
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => setAuthMode("apikey")}
              >
                API Key
              </button>
              <button
                className={`secondary-button ${authMode === "login" ? "active" : ""}`}
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => setAuthMode("login")}
              >
                Login
              </button>
            </div>

            {authMode === "apikey" ? (
              <form
                onSubmit={handleApiKeySubmit}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div className="panel-label">API Key</div>
                <input
                  type="password"
                  placeholder="Paste your admin API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  className="primary-button"
                  style={{ width: "100%" }}
                >
                  Connect
                </button>
              </form>
            ) : (
              <form
                onSubmit={handleLogin}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div className="panel-label">Login</div>
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
            )}
          </div>
        </div>
      )}

      {/* Quick stats when connected */}
      {connected && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          <div className="kpi-card">
            <div className="kpi-label">API</div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>
              {health.data?.version || "-"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
