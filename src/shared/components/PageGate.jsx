import React from "react";

export default function PageGate({
  loading = false,
  error = "",
  empty = false,
  loadingText = "Loading...",
  emptyText = "No data.",
  children,
}) {
  if (loading) return <div className="loading">{loadingText}</div>;
  if (error) return <div className="error">{error}</div>;
  if (empty) return <div className="minor-text">{emptyText}</div>;
  return children;
}
