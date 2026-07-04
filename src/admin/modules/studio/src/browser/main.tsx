import React from "react";
import ReactDOM from "react-dom/client";
import {PaymentFlowBrowser} from "./PaymentFlowBrowser";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root container");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <PaymentFlowBrowser />
  </React.StrictMode>,
);
