const NICK={'Gig Gig':'集集','Kim Kim':'金金','Tom Tom':'通通','PixPix':'皮皮'};
const nick=(n)=>NICK[n]||n;
// =====================================================================
// 資料轉接層：整個前端只有這個檔案知道後端長什麼樣（規格見 ../BACKEND.md）。
// 有金鑰就連真後端（Supabase RPC）；沒有金鑰時退回示範模式（假資料，不連網路）。
//
// 提供給 app.js 的介面（兩種模式相同）：
//   const api = await createAdapter();
//   api.mode                      'live' 或 'mock'
//   await api.list()              → { items: [正規化卡片], serverTime: ms|null }（含待看、暫存、要做、剛收走）
//   await api.get(id)             → 單張卡，含 detailText（opp_get）
//   await api.act(id, action, o)  → 更新後的卡。action：dive｜stash｜unstash｜deleted｜skipped｜restore｜build
//   api.subscribe(onPing, onState)→ 取消函式；onPing() 代表「有變動，請重抓」，onState(bool) 代表即時連線狀態
//   api.setKey(k)                 存新金鑰（示範模式下按「貼上金鑰」用）
// =====================================================================

export const CONFIG = {
  SUPABASE_URL: 'https://wbfdpuytffyaetghqkbl.supabase.co',
  // 公開的 publishable key（BACKEND.md：可以寫進網頁）。私鑰絕不寫在這裡，只從網址 ?k=、# 或 localStorage 來。
  SUPABASE_ANON_KEY: 'sb_publishable_yXl1iCBorFdHNsTl1A4UPg_MQLMYukO',
  KEY_STORAGE: 'opp_key',
  SNAPSHOT_KEY: 'opp.snapshot.v2',
  POLL_MS: 15000,          // 輪詢備援
  FAST_POLL_MS: 3000,      // 有「讀全文中」或「建資料夾中」時加快
  TIMEOUT_MS: 15000,       // 一般請求逾時
  SLOW_MS: 3000,           // 超過這麼久還沒回來，就顯示「載入比較久」
  GONE_HOURS: 72,
  RPC: { list: 'opp_list', get: 'opp_get', topic: 'get_opp_realtime_topic',
         dive: 'opp_dive', stash: 'opp_stash', unstash: 'opp_unstash', drop: 'opp_drop', restore: 'opp_restore', build: 'opp_build' },
};

export class AdapterError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
}

const qs = new URLSearchParams(location.search);

// ---------- 金鑰：照記帳面板，網址 ?k= 帶進來（也收 #k=），存 localStorage，並留在網址上 ----------
export function tokenFrom(s) {
  s = String(s || '').trim(); if (!s) return '';
  let m = s.match(/\/k\/([A-Za-z0-9_-]{20,})/); if (m) return m[1];
  m = s.match(/[?&#]k=([^&#\s]+)/); if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
  m = s.match(/#([A-Za-z0-9_-]{20,})/); if (m) return m[1];
  m = s.match(/^[A-Za-z0-9_-]{20,}$/); return m ? m[0] : '';
}
const LS = { get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
let KEY = '';
(function initKey() {
  // 金鑰來源順序：網址 ?k=、網址 #k=（相容舊做法）、localStorage。
  // 照記帳面板：金鑰留在網址上（改成 ?k=金鑰、拿掉 #），這樣 iPhone 加到主畫面時網址帶著金鑰，獨立 App 第一次開也有。
  const fromUrl = tokenFrom(location.search) || tokenFrom(location.hash);
  if (fromUrl.length >= 20) { KEY = fromUrl; LS.set(CONFIG.KEY_STORAGE, KEY); } else KEY = LS.get(CONFIG.KEY_STORAGE);
  if (KEY.length >= 20) {
    try { const u = new URL(location.href); u.hash = ''; u.searchParams.set('k', KEY); history.replaceState(null, '', u.pathname + u.search); } catch (e) {}
  }
})();
export const hasKey = () => KEY.length >= 20;
export function saveKey(k) { KEY = k; LS.set(CONFIG.KEY_STORAGE, k); try { const u = new URL(location.href); u.hash = ''; u.searchParams.set('k', k); history.replaceState(null, '', u.pathname + u.search); } catch (e) {} }  // 網址也一起換，不然重新整理會讀回舊的 ?k=
export const keyTag = () => KEY.slice(0, 6);        // 快照用，不是完整金鑰

export async function createAdapter() {
  const mockFlag = qs.get('mock');
  const forceMock = mockFlag !== null && mockFlag !== '0';
  if (hasKey() && !forceMock && CONFIG.SUPABASE_URL.startsWith('http')) return liveAdapter();
  const { mockAdapter } = await import('./mock.js');
  return mockAdapter(forceMock ? mockFlag : '');
}

// ---------- 正規化：後端欄位 → 前端欄位 ----------
const BASKET = { company: 'company', personal: 'personal', other: 'other', fund: 'funding', honor: 'achievement', funding: 'funding', achievement: 'achievement' };
const ts = v => { if (!v) return null; const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : null; };
const arr = v => Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : (typeof v === 'string' && v ? [v] : []);
const str = v => (v == null ? '' : String(v));
const web = v => { v = str(v).trim(); return /^https?:\/\//i.test(v) ? v : ''; };   // 連結只收 http(s)，擋 javascript: 等

export function normalize(r) {
  return {
    id: str(r.id), title: str(r.title), shortTitle: str(r.short_title), org: str(r.org),
    basket: BASKET[r.basket] || 'other',
    status: r.status === 'stashed' ? 'snoozed' : (['new', 'doing', 'dropped', 'expired'].includes(r.status) ? r.status : 'new'),
    amountLabel: str(r.amount_label), currency: str(r.currency), amountDisplay: str(r.amount_display),
    deadline: ts(r.deadline), deadlineText: str(r.deadline_text), deadlineApprox: !!r.deadline_approx,
    expiresAt: ts(r.expire_at), snoozeUntil: ts(r.remind_at), stashDueAt: ts(r.stash_due_at),
    sourceUrl: web(r.source_url), sourceSite: str(r.source_site), foundBy: nick(str(r.found_by)), foundAt: ts(r.created_at), isDemo: !!r.is_demo,
    why: str(r.why), quick: arr(r.quick), facts: arr(r.facts), warn: arr(r.warn), firstStep: str(r.first_step), fit: str(r.fit), honor: str(r.honor),
    crawlStatus: str(r.crawl_status) || 'none', crawlError: str(r.crawl_error), hasFullText: !!r.has_full_text,
    detailText: str(r.full_text), attachments: Array.isArray(r.attachments) ? r.attachments.filter(a => a && web(a.url)) : [],
    folderStatus: str(r.folder_status) || 'none', folderError: str(r.folder_error), folderName: str(r.folder_name), folderPath: str(r.folder_path), notionUrl: web(r.notion_url),
    dropReason: str(r.drop_reason),
  };
}

// ---------- 真後端（Supabase REST + Realtime） ----------
function liveAdapter() {
  const base = CONFIG.SUPABASE_URL.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY };
  async function rpc(name, body, timeout) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout || CONFIG.TIMEOUT_MS);
    let res;
    try { res = await fetch(base + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify({ p_key: KEY, ...body }), signal: ac.signal, cache: 'no-store' }); }
    catch (e) { throw new AdapterError(ac.signal.aborted ? 'timeout' : (navigator.onLine === false ? 'offline' : 'network'), ac.signal.aborted ? '連線逾時' : '連不上伺服器'); }
    finally { clearTimeout(t); }
    let data = null; const txt = await res.text();
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!res.ok) {
      const msg = String((data && (data.message || data.error || data.hint)) || ('HTTP ' + res.status));
      if (res.status === 401 || res.status === 403) { LS.del(CONFIG.SNAPSHOT_KEY + ':' + keyTag()); LS.del(CONFIG.KEY_STORAGE); KEY = ''; throw new AdapterError('auth', msg, res.status); }
      throw new AdapterError(res.status === 400 || res.status === 422 ? 'state' : 'server', msg, res.status);
    }
    return data;
  }
  const card = d => { d = Array.isArray(d) ? d[0] : d; return d && typeof d === 'object' && d.id ? normalize(d) : null; };
  const R = CONFIG.RPC;
  return {
    mode: 'live',
    async list() {
      const d = await rpc(R.list, { p_gone_hours: CONFIG.GONE_HOURS });
      if (!d || !Array.isArray(d.items)) throw new AdapterError('server', '回傳格式不對');
      const all = [].concat(d.items, d.doing || [], d.gone || []).map(normalize);
      return { items: all, serverTime: ts(d.server_time) };
    },
    async get(id) { return card(await rpc(R.get, { p_id: id })); },
    async act(id, action, o = {}) {
      switch (action) {
        case 'dive': return card(await rpc(R.dive, { p_id: id, ...(o.force ? { p_force: true } : {}) }));
        case 'stash': return card(await rpc(R.stash, { p_id: id }));
        case 'unstash': return card(await rpc(R.unstash, { p_id: id }));
        case 'deleted': case 'skipped': return card(await rpc(R.drop, { p_id: id, p_reason: action }));
        case 'restore': return card(await rpc(R.restore, { p_id: id }));
        case 'build': return card(await rpc(R.build, { p_id: id }));
      }
      throw new AdapterError('server', '未知動作');
    },
    subscribe(onPing, onState) {
      let stopFn = () => {}, dead = false;
      rpc(R.topic, {}).then(t => { if (!dead && typeof t === 'string' && t) stopFn = realtime(base, t, onPing, onState); else onState(false); }).catch(() => onState(false));
      return () => { dead = true; stopFn(); };
    },
    setKey(k) { KEY = k; LS.set(CONFIG.KEY_STORAGE, k); },
  };
}

// Supabase Realtime（Phoenix 協定）。只聽 broadcast；任何訊息都只當成「請重抓」，不信任內容。
function realtime(base, channel, onPing, onState) {
  const url = base.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(CONFIG.SUPABASE_ANON_KEY) + '&vsn=1.0.0';
  const topic = 'realtime:' + channel;
  let ws, hb, rt, n = 0, stop = false, tries = 0;
  const send = o => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  function open() {
    if (stop) return;
    try { ws = new WebSocket(url); } catch (e) { onState(false); return; }
    ws.onopen = () => {
      send({ topic, event: 'phx_join', ref: String(++n), payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: CONFIG.SUPABASE_ANON_KEY } });
      hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++n) }), 25000);
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply') { if (m.payload && m.payload.status === 'ok') { if (tries) onPing(); tries = 0; onState(true); } else onState(false); }
      else if (m.event === 'broadcast') onPing();
      else if (m.event === 'phx_error' || m.event === 'phx_close') onState(false);
    };
    ws.onclose = () => { clearInterval(hb); onState(false); if (!stop) rt = setTimeout(open, Math.min(30000, 1500 * 2 ** tries++)); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  const vis = () => { if (!document.hidden && (!ws || ws.readyState > 1)) { clearTimeout(rt); open(); } };
  document.addEventListener('visibilitychange', vis);
  open();
  return () => { stop = true; clearTimeout(rt); clearInterval(hb); document.removeEventListener('visibilitychange', vis); try { ws.close(); } catch (e) {} };
}
