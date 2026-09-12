// Minimal service worker.
// Its only job here is to satisfy the browser's requirement that a page
// have a registered service worker before it will offer to be "installed"
// (added to the home screen). It doesn't cache anything yet.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Pass every request straight through to the network.
  event.respondWith(fetch(event.request));
});
