// Minimal "network-only" service worker for development.
// Does not cache anything: always goes to the network.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Cleanup any old caches from previous SW versions.
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

