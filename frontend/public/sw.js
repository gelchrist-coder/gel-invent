const SHELL_CACHE = "gel-invent-shell-v15";
const ASSET_CACHE = "gel-invent-assets-v15";
const APP_SHELL_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => ![SHELL_CACHE, ASSET_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Navigations always go to the network so the freshly-deployed index.html (with
// the current asset hashes) is used. We deliberately do NOT cache or serve a
// stale index.html: after a deploy its hashed JS/CSS no longer exist on the CDN,
// so a stale shell would 404 its own chunks and show a blank page until the user
// refreshes several times. A short retry absorbs brief blips; a real outage
// falls back to offline.html.
async function handleNavigation(request) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(request, { cache: "no-store" });
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match("/offline.html")) || Response.error();
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {
          // Ignore cache write failures.
        });
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Only ever handle real http(s) requests. blob:/data: URLs (e.g. the temporary
  // object URLs used while compressing an uploaded image) are page-scoped and
  // cannot be fetched from the worker — intercepting them yields ERR_ACCESS_DENIED
  // and breaks image uploads. Let the browser load them natively.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (["image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
