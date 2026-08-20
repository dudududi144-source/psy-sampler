// PSY Sampler Service Worker
//
// Caches the app shell for offline use. Sample WAVs are cached on first
// access (cache-first strategy). This makes the app installable as a PWA.

const CACHE_NAME = "psy-sampler-v1";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/logo.svg",
  "/samples/manifest.json",
];

// Install: cache the app shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for samples + app shell, network-first for everything else.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don't cache POST/PUT requests.
  if (event.request.method !== "GET") return;

  // Cache-first for samples (WAV files).
  if (url.pathname.startsWith("/samples/") && url.pathname.endsWith(".wav")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for everything else (with cache fallback).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET responses.
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails.
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // If navigating to a page and offline, serve the app shell.
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503 });
        });
      })
  );
});
