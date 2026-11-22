/* Mosa minimal PWA service worker — enables 1-click Desktop App install without stale-cache traps */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__mosa_clip/') || url.pathname.startsWith('/__mosa_native/')) {
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
  }
});
