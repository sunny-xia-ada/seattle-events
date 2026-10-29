// push.js — client side of Web Push + deep-link highlight for 一丹活动 radar.
// Loaded with ONE line in index.html:  <script src="push.js" defer></script>
// Relies on globals defined by index.html's inline script: DATA, S, open, render, rs.
(() => {
  const VAPID_PUBLIC_KEY = 'BPL8x3rf_4k7hMzmoNXqKf0hisVp2umat2fOW_uhptvRrszKcJ_PTgscyJf211Lm7t7G6yU-SScDFwtjzh-Qz44';
  const SW_URL = 'sw.js';

  /* ---------- deep link: #ev-<id> (or #ev=<id>) ---------- */
  const evFromHash = h => { const m = /^#ev[-=](.+)$/.exec(decodeURIComponent(h || '')); return m ? m[1] : null; };
  function focusEvent(id) {
    if (!id) return;
    const d = DATA.find(x => x.id === id);
    if (!d) {                                   // page came from a stale cache: reload once, bypassing cache
      if (!sessionStorage.getItem('evReload')) { sessionStorage.setItem('evReload', '1'); location.replace(location.pathname + '?v=' + Date.now() + '#ev-' + encodeURIComponent(id)); }
      return;
    }
    sessionStorage.removeItem('evReload');
    rs.onclick();                                // clear every filter so the card is visible
    if (d.cat === '可以略过') { S.sk = true; sk.checked = true; }
    open.add(id); render();
    const el = [...document.querySelectorAll('.card')].find(c => c.dataset.id === id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 4000);
  }
  const css = document.createElement('style');
  css.textContent = `.card.hl{outline:3px solid #ff7aa8;box-shadow:0 0 0 6px rgba(255,122,168,.25);animation:hlp 1s ease-in-out 3}
@keyframes hlp{50%{box-shadow:0 0 0 12px rgba(255,122,168,.05)}}
#pushbar{margin:16px 0;padding:12px 14px;border-radius:14px;background:#fff0f5;font-size:15px}
#pushbar button{font:inherit;padding:6px 14px;border:0;border-radius:999px;background:#ff7aa8;color:#fff;margin-right:8px}
#pushbar textarea{width:100%;height:90px;margin-top:8px;font-size:12px}`;
  document.head.appendChild(css);
  window.addEventListener('hashchange', () => focusEvent(evFromHash(location.hash)));
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open-event') { const u = new URL(e.data.url); history.replaceState(null, '', u.hash || '#'); focusEvent(evFromHash(u.hash)); }
  });
  focusEvent(evFromHash(location.hash));

  /* ---------- enable-notifications UI ---------- */
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const bar = document.createElement('div'); bar.id = 'pushbar';
  const anchor = document.getElementById('cnt'); if (anchor) anchor.before(bar); else document.body.prepend(bar);
  const b64 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  async function showSubscription(sub) {
    const json = JSON.stringify(sub.toJSON());
    localStorage.setItem('pushEndpoint', sub.endpoint);
    bar.innerHTML = '🔔 已开启通知。<button id="pcopy">复制订阅码</button><button id="ptest">本地测试</button><textarea readonly></textarea>';
    bar.querySelector('textarea').value = json;
    bar.querySelector('#pcopy').onclick = async () => { try { await navigator.clipboard.writeText(json); bar.querySelector('#pcopy').textContent = '已复制 ✓'; } catch { bar.querySelector('textarea').select(); } };
    bar.querySelector('#ptest').onclick = async () => { const r = await navigator.serviceWorker.ready; r.showNotification('测试通知', { body: '这是本机测试，说明通知权限正常', icon: 'icon-192.png', data: { url: location.pathname } }); };
  }
  async function refresh() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      bar.textContent = standalone ? '此设备不支持网页推送（需要 iOS 16.4 以上）。' : '🔔 要收到新活动通知：先点 Safari 分享按钮 →「添加到主屏幕」，再从主屏幕图标打开本页。'; return; }
    await navigator.serviceWorker.register(SW_URL).catch(() => {});
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (Notification.permission === 'denied') { bar.textContent = '通知被拒绝了：到 设置 → 通知 → 活动radar 里打开。'; return; }
    if (sub && Notification.permission === 'granted') { await showSubscription(sub); return; }
    bar.innerHTML = '🔔 <button id="pon">开启新活动通知</button>';
    bar.querySelector('#pon').onclick = async () => {
      // Must run synchronously from the tap: ask permission first, then subscribe.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return refresh();
      try {
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
        await showSubscription(s);
      } catch (err) { bar.textContent = '订阅失败：' + err.message; }
    };
  }
  refresh();
})();
