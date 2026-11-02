// Service worker for 一丹活动 radar — Web Push, plus network-first documents.
// Scope = /seattle-events/ (the folder it is served from).
// Navigation and index.html are always re-fetched with cache:'no-store'. The Cache API
// is an offline fallback only — never cache-first — so a published page is not served stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const ROOT = new URL('./', self.location).href;
const HTML_CACHE = 'html-offline';

// Documents only. Scripts, icons, and the manifest keep the browser's normal fetch
// so this worker cannot answer them from an old Cache API entry.
function isDocumentGet(req) {
  if (req.method !== 'GET') return false;
  let url;
  try { url = new URL(req.url); } catch { return false; }
  if (url.origin !== self.location.origin) return false;
  if (req.mode === 'navigate' || req.destination === 'document') return true;
  const path = url.pathname;
  return path.endsWith('/index.html') || path.endsWith('/');
}

self.addEventListener('fetch', event => {
  if (!isDocumentGet(event.request)) return;
  event.respondWith(networkFirstDocument(event.request));
});

async function networkFirstDocument(request) {
  try {
    // Fetch by URL (not the original Request) so cache:'no-store' is actually applied
    // and a conditional 304 cannot be returned as the page.
    const fresh = await fetch(request.url, { cache: 'no-store', credentials: 'same-origin' });
    if (fresh && fresh.ok) {
      try {
        const body = await fresh.clone().blob();
        const copy = new Response(body, { status: fresh.status, statusText: fresh.statusText, headers: fresh.headers });
        const cache = await caches.open(HTML_CACHE);
        await cache.put(ROOT, copy);
      } catch { /* offline copy is best-effort; never block the network response */ }
    }
    return fresh;
  } catch (err) {
    try {
      const cached = await (await caches.open(HTML_CACHE)).match(ROOT);
      if (cached) return cached;
    } catch {}
    throw err;
  }
}

// Accept both declarative-format payloads ({web_push:8030, notification:{...}}) and a plain {title, body, url}.
function parse(event) {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: event.data ? event.data.text() : '新活动' }; }
  const n = d.notification || d;
  return {
    title: n.title || '新活动',
    body: n.body || '',
    url: n.navigate || n.url || (d.data && d.data.url) || ROOT,
    tag: n.tag || d.tag
  };
}

// iOS/Safari: every push MUST show a notification (no silent push), otherwise permission gets revoked.
self.addEventListener('push', event => {
  const n = parse(event);
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: n.tag,
    lang: 'zh-CN',
    data: { url: n.url }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || ROOT, ROOT).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.startsWith(ROOT)) {           // app already open: focus it and tell the page which event to show
        c.postMessage({ type: 'open-event', url });
        try { await c.focus(); } catch {}
        return;
      }
    }
    await self.clients.openWindow(url);       // app closed: launch it straight at the deep link
  })());
});
