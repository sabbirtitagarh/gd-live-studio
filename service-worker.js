/* GD LIVE STUDIO — service worker.
 * Strategy: precache the static app shell; network-first for HTML/JS/CSS (so updates arrive) with cache fallback offline;
 * cache-first for images. NEVER caches the backend API, Google/Meta endpoints or any POST request.
 * Bump CACHE_VERSION on every release to trigger the in-app "update available" prompt.
 */
const CACHE_VERSION = 'gdls-v1.0.2';
const SHELL = [
  './', 'index.html', 'privacy.html', 'terms.html', 'css/legal.css', 'manifest.json', 'favicon.ico',
  'css/style.css', 'css/dashboard.css', 'css/responsive.css',
  'js/theme-boot.js', 'js/crypto.js', 'js/app.js', 'js/config.js', 'js/ui.js', 'js/state.js', 'js/theme.js', 'js/gis.js', 'js/storage.js', 'js/api.js', 'js/auth.js',
  'js/camera.js', 'js/overlays.js', 'js/recording.js', 'js/platforms.js', 'js/streaming.js', 'js/scheduler.js', 'js/diagnostics.js', 'js/admin.js',
  'js/views-core.js', 'js/views-misc.js',
  'pages/login.html', 'pages/dashboard.html', 'pages/camera.html', 'pages/record.html', 'pages/golive.html', 'pages/studio.html', 'pages/platforms.html',
  'pages/overlays.html', 'pages/schedule.html', 'pages/recordings.html', 'pages/history.html', 'pages/devices.html', 'pages/storage.html',
  'pages/diagnostics.html', 'pages/help.html', 'pages/profile.html', 'pages/about.html', 'pages/admin.html',
  'assets/logo/gd-tech-academy-logo.png', 'assets/logo/gd-mark.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png', 'assets/icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll is all-or-nothing; add individually so one missing optional file cannot break installation.
    await Promise.all(SHELL.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gdls-') && k !== CACHE_VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Apps Script, Google, Meta, gateway traffic
  if (req.headers.has('range')) return;            // let media range requests go straight to the network

  const isImage = /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    if (isImage) {
      const hit = await cache.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res; } catch { return new Response('', { status: 504 }); }
    }
    try {
      const res = await fetch(req); if (res.ok) cache.put(req, res.clone()); return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true }); if (hit) return hit;
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      return new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
