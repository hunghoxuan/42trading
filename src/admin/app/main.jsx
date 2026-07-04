import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/admin.css";

const BASENAME = window.location.pathname.startsWith("/ui") ? "/ui" : "/";

if (import.meta.env.DEV && typeof window !== "undefined") {
  const devtoolsBanner =
    "Download the React DevTools for a better development experience";
  const originalInfo = console.info;
  console.info = (...args) => {
    const firstArg = String(args?.[0] || "");
    if (firstArg.includes(devtoolsBanner)) return;
    originalInfo.apply(console, args);
  };
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter
      basename={BASENAME}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
