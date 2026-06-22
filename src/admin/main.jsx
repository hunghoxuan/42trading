import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "../shared/styles/admin.css";

const BASENAME = window.location.pathname.startsWith("/ui") ? "/ui" : "/";

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
