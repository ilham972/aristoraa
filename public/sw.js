// aristora service worker — native-feel caching (perf phase 1, 2026-06-12)
//
// Strategies by request type (GET, same-origin only):
//   1. /_next/static/*  — CACHE-FIRST. Next.js content-hashes these filenames,
//      so a cached copy can never be stale. This is what makes reopening the
//      app instant instead of waiting on a network round trip per file.
//   2. Page navigations — NETWORK-FIRST with cache fallback: fresh HTML when
//      online, last-seen HTML when offline/flaky so the shell still opens.
//   3. Everything else (icons, manifest, fonts) — STALE-WHILE-REVALIDATE:
//      serve cached instantly, refresh the cache in the background.
// Cross-origin requests (Clerk, Convex) are NOT intercepted — auth and live
// data must never be served from a cache.
//
// CACHE_NAME must be bumped on any strategy change; activate() deletes all
// older caches so phones can't get stuck on a stale worker's world.

const CACHE_NAME = 'aristora-v12';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache a successful response. Only `ok` responses are stored — a cached 404
// or 500 would otherwise be served forever by cache-first.
async function putInCache(request, response) {
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

const OFFLINE_FALLBACK = () =>
  new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });

// NEVER resolve respondWith with `undefined` — caches.match returns undefined
// on a miss and respondWith(undefined) turns the request into a hard error.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    return await putInCache(request, await fetch(request));
  } catch {
    return OFFLINE_FALLBACK();
  }
}

async function networkFirst(request) {
  try {
    return await putInCache(request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort for navigations: any cached page shell beats a dead screen.
    const home = await caches.match('/');
    if (home) return home;
    return OFFLINE_FALLBACK();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then((response) => putInCache(request, response))
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await refresh;
  return fresh || OFFLINE_FALLBACK();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // Never intercept Clerk/Convex/etc. — auth + live data stay cache-free.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
