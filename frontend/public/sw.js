/* Minimal service worker for offline app shell caching.
   - First online load caches app assets as they are fetched.
   - Subsequent loads can work offline (for previously visited routes/assets).
*/

const CACHE_NAME = "gel-invent-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Cache the app shell entrypoints.
      await cache.addAll(["/", "/index.html"]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old caches.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only cache GET requests.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Don't cache cross-origin requests (e.g., API requests to Railway).
  if (url.origin !== self.location.origin) return;

  // SPA navigation: serve cached index.html when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("/index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match("/index.html");
          return cached || new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first, then network.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })(),
  );
});
