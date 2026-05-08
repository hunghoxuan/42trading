import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { getApiUrl, setApiUrl } from "./api";
import HomePage from "./pages/HomePage";

const queryClient = new QueryClient();

export default function App() {
  const [apiUrl, setApiUrlState] = useState(getApiUrl());

  return (
    <QueryClientProvider client={queryClient}>
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
            padding: "12px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            Antigravity v3
          </h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={apiUrl}
              onChange={(e) => {
                setApiUrlState(e.target.value);
                setApiUrl(e.target.value);
              }}
              placeholder="API URL"
              style={{
                padding: "4px 8px",
                fontSize: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                width: 280,
              }}
            />
          </div>
        </header>
        <main style={{ padding: 20 }}>
          <HomePage />
        </main>
      </div>
    </QueryClientProvider>
  );
}
