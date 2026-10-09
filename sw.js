// BhashaTranscribe Service Worker
// Cache-first strategy with stale-while-revalidate for dynamic content

const CACHE_NAME = 'bhasha-transcribe-v4.1';
const CDN_CACHE = 'bhasha-cdn-v3';
const STATIC_CACHE = 'bhasha-static-v4';
const DYNAMIC_CACHE = 'bhasha-dynamic-v3';
const IMAGE_CACHE = 'bhasha-images-v3';

// Core app shell assets - cached on install
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// CDN assets that should be cached
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        return caches.open(CDN_CACHE);
      })
      .then((cache) => {
        console.log('[SW] Caching CDN assets');
        // Use no-cors for CDN assets to handle opaque responses
        const cdnRequests = CDN_ASSETS.map(url => 
          fetch(url, { mode: 'no-cors' }).catch(() => null)
        );
        return Promise.all(cdnRequests).then(responses => {
          const validResponses = responses.filter(r => r !== null);
          const validUrls = CDN_ASSETS.filter((_, i) => responses[i] !== null);
          return Promise.all(
            validUrls.map((url, i) => cache.put(url, validResponses[i]))
          );
        });
      })
      .then(() => {
        console.log('[SW] Core assets cached successfully');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Install failed:', err);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return name.startsWith('bhasha-') && 
                name !== STATIC_CACHE && 
                name !== CDN_CACHE &&
                name !== DYNAMIC_CACHE &&
                name !== IMAGE_CACHE;
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Never intercept server API calls (STT health/transcribe must always hit the network)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip chrome-extension and other non-http schemes
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Strategy for CDN assets (jsPDF, docx)
  if (CDN_ASSETS.some(cdnUrl => request.url.includes(cdnUrl))) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version immediately, then update in background
            fetch(request, { mode: 'no-cors' })
              .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                  caches.open(CDN_CACHE).then((cache) => {
                    cache.put(request, networkResponse.clone());
                  });
                }
              })
              .catch(() => {});
            return cachedResponse;
          }
          // Not in cache, fetch and cache
          return fetch(request, { mode: 'no-cors' })
            .then((networkResponse) => {
              if (networkResponse) {
                const responseClone = networkResponse.clone();
                caches.open(CDN_CACHE).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
              return networkResponse;
            });
        })
    );
    return;
  }

  // Strategy for static assets (HTML, CSS, JS in same origin)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Stale-while-revalidate: return cached, update in background
            fetch(request)
              .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                  caches.open(STATIC_CACHE).then((cache) => {
                    cache.put(request, networkResponse.clone());
                  });
                }
              })
              .catch(() => {});
            return cachedResponse;
          }
          // Not in cache, fetch and cache
          return fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(STATIC_CACHE).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // If it's a navigation request, return the cached index.html
              if (request.mode === 'navigate') {
                return caches.match('/index.html');
              }
              return new Response('Offline - Resource not available', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' }
              });
            });
        })
    );
    return;
  }

  // For other cross-origin requests (fonts, etc.) - network first, cache fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Background sync for offline form submissions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transcriptions') {
    event.waitUntil(syncTranscriptions());
  }
});

async function syncTranscriptions() {
  // Placeholder for future background sync implementation
  console.log('[SW] Background sync triggered');
}

// Push notification support (future enhancement)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'BhashaTranscribe', {
        body: data.body || 'New notification',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        tag: data.tag || 'default',
        requireInteraction: false
      })
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

// Message handler from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
