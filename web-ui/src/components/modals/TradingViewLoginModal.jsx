import React, { useState } from "react";

export default function TradingViewLoginModal({ isOpen, onClose, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onLogin(username, password);
      onClose();
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={overlayStyle}>
      <div className="modal-content" style={contentStyle}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0 }}>TradingView Login</h3>
          <button onClick={onClose} style={closeButtonStyle}>&times;</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
          This will log in on the server to enable high-quality snapshots with your private indicators.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={inputGroupStyle}>
            <label style={labelStyle}>Username / Email</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              placeholder="TradingView username"
              required
              autoFocus
            />
          </div>
          <div style={inputGroupStyle}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="Your password"
              required
            />
          </div>
          {error && <div style={errorStyle}>{error}</div>}
          <div style={footerStyle}>
            <button
              type="button"
              onClick={onClose}
              className="secondary-button"
              style={{ marginRight: 8 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={loading}
              style={{ minWidth: 80 }}
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  backdropFilter: "blur(4px)",
};

const contentStyle = {
  backgroundColor: "#0d1117",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 24,
  width: "100%",
  maxWidth: 400,
  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const closeButtonStyle = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  fontSize: 24,
  cursor: "pointer",
  lineHeight: 1,
};

const inputGroupStyle = {
  marginBottom: 16,
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 4,
  color: "#8b949e",
};

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  backgroundColor: "#161b22",
  color: "#c9d1d9",
  fontSize: 14,
  outline: "none",
};

const footerStyle = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 24,
};

const errorStyle = {
  color: "#f85149",
  fontSize: 12,
  marginBottom: 16,
  padding: "8px",
  backgroundColor: "rgba(248, 81, 73, 0.1)",
  borderRadius: 4,
  border: "1px solid rgba(248, 81, 73, 0.2)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};
