import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";

if (typeof window !== "undefined" && navigator.onLine) {
  // Start the backend wake-up path as early as possible without blocking the UI.
  void fetch(`/api/health?ts=${Date.now()}`, { cache: "no-store" }).catch(() => {
    // Ignore warm-up failures. Normal request paths still handle retries/errors.
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swVersion = "20260606-2";
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register(`/sw.js?v=${swVersion}`).then((registration) => {
      void registration.update();

      if (registration.waiting && hadController) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) {
          return;
        }

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && hadController) {
            installing.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    }).catch(() => {
      // Ignore registration failures. The app still works online without the PWA shell.
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
