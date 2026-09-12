// Minimal service worker.
// Its only job here is to satisfy the browser's requirement that a page
// have a registered service worker before it will offer to be "installed"
// (added to the home screen). It intentionally does NOT handle "fetch" -
// that would intercept every network request on the page (including
// things like the mic recording upload), which we don't want. Modern
// browsers no longer require a fetch handler for installability, just
// a registered service worker.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});
