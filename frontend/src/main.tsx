import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {
          // Ignore cleanup failures.
        });
      });
    });

    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).catch(() => {
          // Ignore cleanup failures.
        });
      });
    }).catch(() => {
      // Ignore cleanup failures.
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
