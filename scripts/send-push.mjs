// scripts/send-push.mjs — parse DATA out of index.html, dedupe vs sent.json, send Web Push (VAPID) to the single subscriber.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_SUBSCRIPTION (JSON)
//      MODE = normal | seed | test     DRY_RUN=1 (print only)    INDEX=path/to/index.html   STATE=path/to/sent.json
//      SITE=https://sunny-xia-ada.github.io/seattle-events/    TODAY=YYYY-MM-DD (override, for testing)
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import webpush from 'web-push';

const MODE = process.env.MODE || 'normal';
const DRY = process.env.DRY_RUN === '1';
const INDEX = process.env.INDEX || 'index.html';
const STATE = process.env.STATE || 'sent.json';
const SITE = process.env.SITE || 'https://sunny-xia-ada.github.io/seattle-events/';
const MAX_INDIVIDUAL = 5;                               // more than this in one run -> N individual + 1 summary push

// ---- preference filter (the page's own "verdict" already encodes Yidan's taste) ----
const VERDICTS = new Set((process.env.PUSH_VERDICTS || '首选,推荐').split(','));
const SKIP_TITLE = /固定课/;                              // her regular classes recur weekly; never push those
const wanted = d => VERDICTS.has(d.verdict) && !d.clash && !d.booked && d.cat !== '可以略过'
  && d.days?.length > 0 && !SKIP_TITLE.test(d.title);

// ---- parse index.html (contract: DATES and DATA are declared between `const DAYS=` and `let S=`) ----
const html = fs.readFileSync(INDEX, 'utf8');
// The data block sits between `const DAYS=` and `let S=` in the inline script; evaluate just that slice in an empty VM context.
const i0 = html.indexOf('const DAYS='), i1 = html.indexOf('let S=');
if (i0 < 0 || i1 < i0) throw new Error(`cannot locate data block (const DAYS= ... let S=) in ${INDEX}`);
const { DATES, DATA } = vm.runInNewContext(html.slice(i0, i1) + ';({DATES,DATA})');
if (!Array.isArray(DATA) || !Array.isArray(DATES)) throw new Error('DATA/DATES not arrays');

// Stable dedupe key: ids like "pr-sun-adv" are reused week to week, so key on title+dates+start+venue instead.
const norm = s => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const keyOf = d => crypto.createHash('sha1')
  .update([norm(d.title), d.days.map(i => DATES[i]).join(','), d.start || '', norm((d.place || '').split('，')[0])].join('|'))
  .digest('hex').slice(0, 16);

// today in Pacific time, to skip events already past
const today = process.env.TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const [ty, tm, td] = today.split('-').map(Number);
const dateOf = md => { const [m, dd] = md.split('/').map(Number); const y = (m < tm - 6) ? ty + 1 : ty; return new Date(Date.UTC(y, m - 1, dd)); };
const notPast = d => d.days.some(i => dateOf(DATES[i]) >= new Date(Date.UTC(ty, tm - 1, td)));

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { sent: {} };
state.sent ||= {};

const cands = DATA.filter(wanted).filter(notPast).map(d => ({ d, key: keyOf(d) }));
const fresh = cands.filter(c => !state.sent[c.key])
  .sort((a, b) => dateOf(DATES[a.d.days[0]]) - dateOf(DATES[b.d.days[0]]) || (a.d.start || '').localeCompare(b.d.start || ''));
console.log(`events=${DATA.length} wanted=${cands.length} new=${fresh.length} mode=${MODE}${DRY ? ' (dry-run)' : ''}`);

const dayLabel = d => { const i = d.days[0]; return `${DATES[i]}${d.days.length > 1 ? '起' : ''}`; };
const payload = (title, body, id) => JSON.stringify({           // declarative-web-push format (iOS 18.4+); sw.js also understands it on 16.4–18.3
  web_push: 8030,
  notification: { title, body, lang: 'zh-CN', dir: 'ltr', silent: false, navigate: SITE + (id ? '#ev-' + encodeURIComponent(id) : '') }
});
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const bodyOf = d => { const t = (d.time || '').split('；')[0]; const hasDate = /[周\/]/.test(t);   // some entries already carry the weekday/date in `time`
  return clip(`${hasDate ? '' : dayLabel(d) + ' '}${t} · ${(d.place || '').split('，')[0]}`.trim(), 90); };

let msgs;
if (MODE === 'test') {
  const d = DATA.find(wanted) || DATA[0];
  msgs = [{ title: '【测试】' + d.title, body: bodyOf(d), id: d.id, keys: [] }];
} else {
  const indiv = fresh.slice(0, MAX_INDIVIDUAL).map(c => ({ title: c.d.title, body: bodyOf(c.d), id: c.d.id, keys: [c.key] }));
  const rest = fresh.slice(MAX_INDIVIDUAL);
  msgs = indiv;
  if (rest.length) msgs.push({ title: `另有 ${rest.length} 个新活动`, body: rest.slice(0, 3).map(c => c.d.title).join('、') + '…', id: null, keys: rest.map(c => c.key) });
}

if (MODE === 'seed') {                                           // baseline: remember everything currently on the page, send nothing
  for (const c of cands) state.sent[c.key] ||= { id: c.d.id, title: c.d.title, at: new Date().toISOString(), seeded: true };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log(`seeded ${cands.length} keys`); process.exit(0);
}
if (!msgs.length) { console.log('nothing new'); process.exit(0); }
if (DRY) { msgs.forEach(m => console.log('WOULD SEND', JSON.stringify(JSON.parse(payload(m.title, m.body, m.id)), null, 1))); process.exit(0); }

webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
const sub = JSON.parse(process.env.PUSH_SUBSCRIPTION);
let failed = 0;
for (const m of msgs) {
  try {
    const r = await webpush.sendNotification(sub, payload(m.title, m.body, m.id), { TTL: 86400, urgency: 'normal' });
    console.log(`sent "${m.title}" -> ${r.statusCode}`);
    for (const k of m.keys) state.sent[k] = { id: m.id, title: m.title, at: new Date().toISOString() };
  } catch (e) {
    failed++;
    console.error(`FAILED "${m.title}": ${e.statusCode || ''} ${e.body || e.message}`);
    if (e.statusCode === 404 || e.statusCode === 410) console.error('::error::Subscription expired — open the app on the iPhone, re-copy the 订阅码 and update the PUSH_SUBSCRIPTION secret.');
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
}
process.exit(failed ? 1 : 0);
