// Service worker for 一丹活动 radar — Web Push only (no fetch handler, no caching, so it can never serve stale pages).
// Scope = /seattle-events/ (the folder it is served from).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const ROOT = new URL('./', self.location).href;

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
