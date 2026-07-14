const CACHE_NAME = 'mood-orbit-v6';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=6.0.0',
  './app.js?v=6.0.0',
  './manifest.json',
  './icons/icon.svg',
  './assets/device.png',
  './assets/dome_joy.png',
  './assets/dome_sad.png',
  './assets/dome_anger.png',
  './assets/dome_surprise.png',
  './assets/dome_peace.png',
  './assets/dome_flutter.png',
  './assets/dome_irritation.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
