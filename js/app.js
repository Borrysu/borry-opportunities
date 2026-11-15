// 機會雷達主程式：狀態、畫面、事件。只透過 adapter.js 取得與寫入資料。
import { createAdapter, CONFIG, AdapterError, hasKey, keyTag, tokenFrom, saveKey } from './adapter.js';
import { esc, H, D, URGENT_DAYS, fmtDate, fmtClock, fmtLeft, shortLeft, softBreak, splitAmount } from './util.js';

const $ = s => document.querySelector(s);
const BASKETS = [
  { k: 'company', n: '公司案', d: '標案、品牌案、機關宣傳片' },
  { k: 'personal', n: '個人案', d: '自由導演、編劇、詞曲名義接的' },
  { k: 'other', n: '其他', d: 'AI 能代做、非本業、匿名接' },
  { k: 'funding', n: '創作資金', d: '補助、影展、比賽' },
  { k: 'achievement', n: '成就機會', d: '合作、評審、展演' },
];
const BN = Object.fromEntries(BASKETS.map(b => [b.k, b.n]));
const HOLD_HOUR = 8;      // 暫存後，隔天幾點提醒（由集集傳訊息，不是瀏覽器）
const IC = {
  trash: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  bm: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  dive: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v5M12 17.5v.5"/></svg>',
};

// ---------------- 狀態 ----------------
const S = {
  items: new Map(),
  net: 'loading',      // loading | ok | offline | auth | nokey
  hadData: false,      // 畫面上是不是已經有資料可看（快照或網路）
  slow: false, lastOk: null, rt: false, firstNet: false,
  tab: 'company', sheet: false, drawer: null,   // drawer = {id, view:'preview'|'full'}
  detail: new Map(),   // id → {st:'loading'|'fail'|'none', err, t0}
  textOpen: new Set(), fresh: new Set(),
};
let api, lastFocus = null, sigLast = '', depth = 0, ignorePop = false;
const locks = new Set(), mutDone = {};
let OFF = 0;                                   // 伺服器時間與本機時間的差，倒數用校正後的時間
const tnow = () => Date.now() + OFF;

const items = () => [...S.items.values()];
const get = id => S.items.get(id);

// ---------------- 倒數（只做顯示；真正收走看資料庫的 status 與 expires_at） ----------------
function target(it) {
  if (it.deadline && (!it.expiresAt || it.deadline <= it.expiresAt)) return { kind: 'dl', at: it.deadline };
  if (it.expiresAt) return { kind: 'ttl', at: it.expiresAt };
  return { kind: 'none', at: Infinity };
}
const vanishAt = it => target(it).at;
function lvOf(it) {
  const t = target(it), m = t.at - tnow();
  if (t.kind === 'dl') return m < URGENT_DAYS * D ? 'hot' : m < 7 * D ? 'warm' : 'calm';   // 紅色只給真的截止日
  if (t.kind === 'ttl') return m < D ? 'warm' : 'calm';
  return 'calm';
}
function cdShort(it) {
  const t = target(it), m = t.at - tnow();
  if (t.kind === 'none') return '<span class="nodl">沒寫截止日</span>';
  if (t.kind === 'dl') return '<b>' + (m <= 0 ? '時間到' : shortLeft(m)) + '</b>' + (m <= 0 ? '' : ' 截止');
  return '<b>' + (m <= 0 ? '即將' : shortLeft(m)) + '</b> ' + (m <= 0 ? '收走' : '後收走');
}
function cdFull(it) {
  const t = target(it), m = t.at - tnow();
  if (t.kind === 'none') return '沒寫';
  return m <= 0 ? (t.kind === 'dl' ? '時間到' : '即將收走') : fmtLeft(m);
}
function cdLine(it) {            // 待決區用：「剩 6 天 5 小時 截止」
  const t = target(it), m = t.at - tnow();
  if (t.kind === 'none') return '沒寫截止日';
  if (t.kind === 'dl') return m <= 0 ? '截止時間到了' : '剩 <b>' + fmtLeft(m) + '</b> 截止';
  return m <= 0 ? '即將收走' : '<b>' + fmtLeft(m) + '</b> 後收走';
}
function tick() {
  document.querySelectorAll('[data-cd]').forEach(e => {
    const it = get(e.dataset.cd); if (!it) return;
    const mode = e.dataset.mode;
    if (mode === 'short') e.innerHTML = cdShort(it); else if (mode === 'line') e.innerHTML = cdLine(it); else e.textContent = cdFull(it);
    e.dataset.lvl = lvOf(it);
    const card = e.closest('.card'); if (card) card.dataset.lvl = lvOf(it);
  });
  document.querySelectorAll('[data-elapsed]').forEach(e => {
    const d = S.detail.get(e.dataset.elapsed); if (!d) return;
    const sec = Math.floor((tnow() - d.t0) / 1000);
    e.textContent = sec;
    const hint = e.parentNode && e.parentNode.querySelector('[data-elapsed-hint]');
    if (hint) hint.textContent = crawlHint(sec);
  });
  renderSummary();
}

// ---------------- 小積木 ----------------
const chip = it => '<span class="chip b-' + it.basket + '"><i></i>' + BN[it.basket] + '</span>';
const demo = it => it.isDemo ? '<span class="demo-badge">示意資料</span>' : '';
const orgLine = it => it.org && !it.title.includes(it.org) && !it.isDemo ? '<p class="dt-org">' + esc(it.org) + '</p>' : '';
function amt(it) {
  const lab = it.amountLabel ? '<em>' + esc(it.amountLabel) + '</em>' : '';
  const a = splitAmount(it.amountDisplay);
  if (a.num) {
    const long = a.num.length > 7 ? ' long' : '';
    return '<span class="amt' + long + '">' + lab + (it.currency ? '<i>' + esc(it.currency) + '</i>' : '') + '<b>' + esc(a.num) + '</b>' + (a.unit ? '<u>' + esc(a.unit) + '</u>' : '') + '</span>';
  }
  const t = a.text || '沒寫金額';
  return '<span class="amt noamt">' + (t.includes(it.amountLabel) ? '' : lab) + '<b>' + esc(t) + '</b></span>';
}
const link = it => it.sourceUrl ? '<a href="' + esc(it.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + (it.sourceSite ? '開啟原始連結（' + esc(it.sourceSite) + '）' : '開啟原始連結') + '</a>' : '';
const para = s => esc(s).split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>')).join('<br><br>');

// ---------------- 畫面：頂端 ----------------
function renderLive() {
  const el = $('#live'); let dot = '', txt = '';
  const mock = api && api.mode === 'mock';
  if (S.net === 'loading') { dot = 'idle'; txt = S.hadData ? '更新中，先顯示上次的內容' : '載入中'; }
  else if (S.net === 'offline') { dot = 'off'; txt = S.lastOk ? '離線中，顯示 ' + fmtClock(S.lastOk) + ' 的內容' : '連不上伺服器'; }
  else if (S.net === 'auth') { dot = 'off'; txt = '金鑰失效'; }
  else { dot = S.rt ? '' : 'idle'; txt = (mock ? '示範資料，' : S.rt ? '即時更新，' : '每 15 秒更新，') + fmtClock(S.lastOk) + ' 更新'; }
  el.innerHTML = '<span class="dot ' + dot + '"></span><span>' + txt + '</span>';
}
function renderSummary() {
  const live = items().filter(i => i.status === 'new');
  const now = tnow();
  const hot = items().filter(i => (i.status === 'new' || i.status === 'snoozed') && i.deadline && i.deadline > now && i.deadline - now < URGENT_DAYS * D).length;
  $('#sum').innerHTML = S.hadData ? '<b>' + live.length + '</b> 筆待看' + (hot ? '<br><span class="hotn">' + hot + ' 筆</span> ' + URGENT_DAYS + ' 天內截止' : '') : '';
}
function renderNotice() {
  const el = $('#notice'); let html = '', cls = 'notice';
  if (api && api.mode === 'mock' && !hasKey()) {
    html = '<span class="txt">沒有金鑰，現在看到的是示範資料。要看真的機會，請用 Borry 專屬網址開啟。</span><button type="button" data-act="paste-key">貼上金鑰</button>';
  } else if (S.net === 'offline') {
    cls += ' off';
    html = '<span class="txt">' + (S.lastOk ? '連不到伺服器，畫面是 ' + fmtClock(S.lastOk) + ' 的內容。恢復連線後會自動更新。' : '連不到伺服器，也沒有上次的內容可以顯示。') + '</span><button type="button" data-act="retry">重試</button>';
  } else if (S.net === 'loading' && S.slow) {
    html = '<span class="spin"></span><span class="txt">' + (S.hadData ? '連線比較慢，先顯示上次的內容，等一下會自動更新。' : '載入比較久，網路可能很慢，請稍等。') + '</span>';
  } else if (S.net === 'ok' && S.slow) {
    html = '<span class="spin"></span><span class="txt">正在更新…</span>';
  }
  el.className = cls; el.hidden = !html; el.innerHTML = html;
}

// ---------------- 畫面：看板 ----------------
function sortList(l) { return l.sort((a, b) => vanishAt(a) - vanishAt(b) || (b.foundAt || 0) - (a.foundAt || 0)); }
const inbox = () => items().filter(i => i.status === 'new');

function card(it) {
  const lv = lvOf(it);
  return '<article class="card b-' + it.basket + (S.fresh.has(it.id) ? ' fresh' : '') + '" data-id="' + esc(it.id) + '" data-lvl="' + lv + '" tabindex="0" aria-label="' + esc(it.title) + '">' +
    '<div class="c1"><span class="tm" data-cd="' + esc(it.id) + '" data-mode="short" data-lvl="' + lv + '">' + cdShort(it) + '</span>' + demo(it) + '</div>' +
    '<h3 class="sb">' + softBreak(it.title) + '</h3><div class="c3">' + amt(it) + '</div>' +
    '<div class="ca"><button class="del" data-act="del" data-id="' + esc(it.id) + '" type="button">' + IC.trash + '<span>刪掉</span></button>' +
    '<button data-act="hold" data-id="' + esc(it.id) + '" type="button">' + IC.bm + '<span>暫存</span></button>' +
    '<button class="go" data-act="dive" data-id="' + esc(it.id) + '" type="button">' + IC.dive + '<span>深入了解</span></button></div></article>';
}
const skel = () => '<div class="card skel"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>';

function renderBoard() {
  const lanes = $('#lanes'), board = $('#board');
  const keep = {}; lanes.querySelectorAll('.lane').forEach(l => { keep[l.dataset.l] = l.querySelector('.lbody').scrollTop; });
  const left = lanes.scrollLeft;
  let msg = $('#boardmsg'); if (!msg) { msg = document.createElement('div'); msg.id = 'boardmsg'; msg.className = 'board-msg'; msg.hidden = true; board.appendChild(msg); }
  const all = inbox(), loadingEmpty = !S.hadData && S.net === 'loading';
  const holdN = holdItems().length;
  // 整個面板的三種特殊狀態
  let m = null;
  if (S.net === 'auth') m = { ic: IC.warn, t: '金鑰失效', p: '請重新開 Borry 專屬網址。', btn: '<button class="btn btn-primary" data-act="paste-key" type="button">貼上金鑰</button>' };
  else if (S.net === 'offline' && !S.hadData) m = { ic: IC.warn, t: '載入失敗', p: '連不到伺服器，也沒有上次的內容可以顯示。請確認網路後再試。', btn: '<button class="btn btn-primary" data-act="retry" type="button">再試一次</button>' };
  else if (S.hadData && !all.length && S.net !== 'loading') m = { ic: IC.inbox, t: '現在沒有新的機會', p: holdN ? '待決區還有 ' + holdN + ' 筆等你決定。集集和金金找到新的，會自動出現在這裡。' : '集集和金金找到新的，會自動出現在這裡，不用重新整理。', btn: holdN ? '<button class="btn btn-ghost" data-act="open-hold" type="button">看待決區</button>' : '' };
  msg.hidden = !m; lanes.hidden = !!m;
  if (m) msg.innerHTML = m.ic + '<h2>' + m.t + '</h2><p>' + m.p + '</p>' + m.btn;

  $('#tabs').innerHTML = BASKETS.map(b => '<button class="tab b-' + b.k + '" type="button" role="tab" data-tab="' + b.k + '" aria-selected="' + (S.tab === b.k) + '">' +
    (loadingEmpty ? '<b class="sk-n sk"></b>' : '<b>' + all.filter(i => i.basket === b.k).length + '</b>') + b.n + '</button>').join('');
  $('#tabs').hidden = !!m;
  if (!m) lanes.innerHTML = BASKETS.map(b => {
    const list = sortList(all.filter(i => i.basket === b.k));
    const body = loadingEmpty ? skel() + skel() + skel()
      : list.length ? list.map(card).join('')
      : '<div class="zero">' + IC.inbox + '<b>這一籃目前是空的</b><span>集集和金金找到新的，會自動出現在這裡。</span></div>';
    return '<section class="lane b-' + b.k + (S.tab === b.k ? ' cur' : '') + '" data-l="' + b.k + '"><div class="lh"><h2><i class="ld"></i>' + b.n + '' + (loadingEmpty ? '' : '<em>' + list.length + '</em>') + '</h2><p>' + b.d + '</p></div><div class="lbody">' + body + '</div></section>';
  }).join('');
  lanes.querySelectorAll('.lane').forEach(l => { const b = l.querySelector('.lbody'); if (keep[l.dataset.l]) b.scrollTop = keep[l.dataset.l]; });
  lanes.scrollLeft = left;
  S.fresh.clear();
  edgeFade();
}
function edgeFade() {
  const l = $('#lanes'), b = $('#board'); if (!l) return;
  b.classList.toggle('sl', l.scrollLeft > 8);
  b.classList.toggle('sr', l.scrollWidth - l.clientWidth - l.scrollLeft > 8);
}

// ---------------- 畫面：待決區 ----------------
const holdItems = () => sortList(items().filter(i => i.status === 'snoozed'));
const doingItems = () => items().filter(i => i.status === 'doing').sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));
const goneItems = () => items().filter(i => i.status === 'dropped' || i.status === 'expired').slice(0, 50);

function pcard(it) {
  const lv = lvOf(it), id = esc(it.id);
  const rem = it.snoozeUntil;
  const remTxt = rem ? (rem > tnow() ? '提醒時間：' + fmtDate(rem) + '，由集集傳訊息給你' : '已到提醒時間，請決定要不要做') : '';
  return '<article class="pc" data-id="' + id + '" data-lvl="' + lv + '">' + '<div class="dt-tags" style="margin:0">' + chip(it) + demo(it) + '</div>' +
    '<h3 class="sb">' + softBreak(it.title) + '</h3><p class="st">' + (remTxt ? remTxt + '<br>' : '') + '<span data-cd="' + id + '" data-mode="line" data-lvl="' + lv + '">' + cdLine(it) + '</span></p>' +
    '<div class="pa"><button class="pd" data-act="del" data-id="' + id + '" type="button">刪掉</button><button class="pg" data-act="dive" data-id="' + id + '" type="button">深入了解</button><button class="pu" data-act="unstash" data-id="' + id + '" type="button">取消暫存</button></div></article>';
}
const folderState = it => it.folderStatus === 'done' ? 'done' : it.folderStatus === 'failed' ? 'failed' : 'wait';
function dcard(it) {
  const id = esc(it.id), fs = folderState(it);
  const st = fs === 'done' ? '工作資料夾建好了' : fs === 'failed' ? '資料夾沒建成，請找通通' : '<span class="spin"></span>' + (it.folderStatus === 'building' ? '正在建立工作資料夾' : '已排隊，等 Mac 接工作');
  return '<article class="pc' + (fs === 'done' ? ' done' : '') + '" data-id="' + id + '">' + '<div class="dt-tags" style="margin:0">' + chip(it) + demo(it) + '</div><h3 class="sb">' + softBreak(it.title) + '</h3>' +
    '<p class="st">' + st + '</p><div class="pa"><button class="pg" data-act="open-folder" data-id="' + id + '" type="button">' + (fs === 'done' ? '看資料夾位置' : '看進度') + '</button></div></article>';
}
const goneWhy = it => it.dropReason === 'deleted' ? '你刪掉的' : it.dropReason === 'skipped' ? '你決定不做的' : '時間到，自動收走';
function gcard(it) {
  const id = esc(it.id);
  return '<article class="pc" data-id="' + id + '"><h3 class="sb">' + softBreak(it.title) + '</h3><p class="st">' + goneWhy(it) + '</p>' +
    '<div class="pa"><button data-act="restore" data-id="' + id + '" type="button">救回來</button></div></article>';
}
function renderSheet() {
  const h = holdItems(), d = doingItems(), g = goneItems();
  $('#hpill').hidden = $('#holdbtn').hidden = S.net === 'auth';
  $('#holdbtn').innerHTML = '待決區<b>' + h.length + '</b>';
  $('#hpill').innerHTML = '待決區<b>' + h.length + '</b>';
  const sh = $('#sheet'); const sc = sh.querySelector('.db') ? sh.querySelector('.db').scrollTop : 0;
  let body = '';
  if (!h.length && !d.length) body += '<div class="zero"><b>待決區是空的</b><span>按「暫存」的機會會放在這裡，到時候集集會傳訊息提醒你。</span></div>';
  if (h.length) body += '<p class="grp">暫存中，' + h.length + ' 筆</p>' + h.map(pcard).join('');
  if (d.length) body += '<p class="grp">你說要做，' + d.length + ' 筆</p>' + d.map(dcard).join('');
  if (g.length) body += '<details class="gone"><summary>剛收走的，' + g.length + ' 筆，72 小時內可以救回來</summary>' + g.map(gcard).join('') + '</details>';
  body += '<p class="sheet-note">提醒由集集傳訊息給你，網頁自己不會跳通知。</p>';
  sh.innerHTML = '<div class="dh"><span>待決區</span><button class="xb" data-act="close-hold" type="button" aria-label="關閉待決區">×</button></div><div class="db">' + body + '</div>';
  sh.querySelector('.db').scrollTop = sc;
  sh.classList.toggle('show', S.sheet);
}

// ---------------- 畫面：詳細資料抽屜 ----------------
function viewOf() {
  const it = S.drawer && get(S.drawer.id); if (!it) return null;
  return it.status === 'doing' ? 'folder' : S.drawer.view;
}
function statBlock(it) {
  const t = target(it), lv = lvOf(it);
  const lab = t.kind === 'dl' ? '距離截止' : t.kind === 'ttl' ? '沒處理就收走' : '截止日';
  const dtx = it.deadlineText || (it.deadline ? fmtDate(it.deadline) : '');
  const small = t.kind === 'dl' ? dtx : t.kind === 'ttl' ? (it.deadline ? '截止 ' + dtx : (dtx || '預計 ' + fmtDate(it.expiresAt) + ' 收走')) : '來源沒寫';
  return '<div class="dt-stats"><div class="dt-stat">' + amt(it) + '</div><div class="dt-stat"><em>' + lab + '</em><span class="dt-cd" data-cd="' + esc(it.id) + '" data-lvl="' + lv + '">' + cdFull(it) + '</span><small>' + small + '</small></div></div>';
}
function head(it) { return '<header><div class="dt-tags">' + chip(it) + demo(it) + '</div><h2 class="sb">' + softBreak(it.title) + '</h2>' + orgLine(it) + '</header>'; }
const warnBox = (w, n) => w.length ? '<section class="dt-warn"><h3>要注意</h3><ul>' + w.slice(0, n || 9).map(x => '<li class="sbp">' + softBreak(x) + '</li>').join('') + '</ul></section>' : '';
const firstBox = it => it.firstStep ? '<section class="dt-first"><h3>第一步</h3><p class="sbp">' + softBreak(it.firstStep) + '</p></section>' : '';
const metaLine = it => '<p class="dt-meta">' + (it.foundBy ? '由 ' + esc(it.foundBy) + ' 找到' : '') + (it.sourceSite ? (it.foundBy ? '，' : '') + '來源 ' + esc(it.sourceSite) : '') + (it.foundAt ? '，' + fmtClock(it.foundAt) + ' 進來' : '') + '</p>';

function previewHTML(it) {
  const rem = it.status === 'snoozed' ? it.snoozeUntil : null;
  return '<div class="dt">' + head(it) + statBlock(it) +
    (it.why ? '<p class="dt-why sbp">' + softBreak(it.why) + '</p>' : '') +
    (it.quick.length ? '<ul class="pv-list">' + it.quick.map(x => '<li class="sbp">' + softBreak(x) + '</li>').join('') + '</ul>' : '') +
    warnBox(it.warn, 1) + firstBox(it) +
    (rem ? '<p class="dt-meta">暫存中，' + (rem > tnow() ? fmtDate(rem) + ' 集集會傳訊息提醒你' : '已到提醒時間') + '</p>' : '') + metaLine(it) + '</div>';
}
function crawlHTML(it) {
  const id = esc(it.id);
  if (it.detailText) {
    const open = S.textOpen.has(it.id);
    const att = it.attachments.length ? '<div class="att"><h3>附件</h3><ul>' + it.attachments.map(a => '<li><a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.name || a.url) + '</a></li>').join('') + '</ul></div>' : '';
    return '<section class="dt-sec dt-text"><h3>公告全文</h3><div class="txt' + (open ? ' open' : '') + '">' + para(it.detailText) + '</div>' +
      '<button class="more" data-act="toggle-text" data-id="' + id + '" type="button">' + (open ? '收合全文' : '展開全文') + '</button>' + att + '</section>';
  }
  const d = S.detail.get(it.id), st = it.crawlStatus;
  if (d && d.timedOut && !d.busy) {
    return '<section class="dt-crawl fail"><div><b>讀全文逾時</b><small>已經等超過 60 秒，還沒讀完。上面的條件還可以看。要全文的話，可以再讀一次' + (it.sourceUrl ? '，或開原始連結' : '') + '。</small></div><div class="acts">' +
      '<button class="btn btn-primary" data-act="retry-detail" data-id="' + id + '" type="button">再讀一次</button>' +
      (it.sourceUrl ? '<a class="btn btn-ghost" href="' + esc(it.sourceUrl) + '" target="_blank" rel="noopener noreferrer">開原始連結</a>' : '') + '</div></section>';
  }
  if (st === 'failed' && !(d && d.busy)) {
    return '<section class="dt-crawl fail"><div><b>抓取失敗，開原始連結</b><small>' + esc(it.crawlError || '沒有抓到全文') + (it.sourceUrl ? '。上面的條件是集集和金金整理的，全文要自己開連結看。' : '。') + '</small></div><div class="acts">' +
      (it.sourceUrl ? '<a class="btn btn-primary" href="' + esc(it.sourceUrl) + '" target="_blank" rel="noopener noreferrer">開原始連結</a>' : '') +
      '<button class="btn btn-ghost" data-act="retry-detail" data-id="' + id + '" type="button">再讀一次</button></div></section>';
  }
  const t0 = d && d.t0 || tnow();
  const sec = Math.floor((tnow() - t0) / 1000);
  return '<section class="dt-crawl wait" aria-live="polite"><div class="row"><span class="spin" aria-hidden="true"></span><div><b>正在讀全文</b><small>已等 <span data-elapsed="' + id + '">' + sec + '</span> 秒，<span data-elapsed-hint="' + id + '">' + crawlHint(sec) + '</span></small></div></div><div class="crawl-sk" aria-hidden="true"><i class="sk"></i><i class="sk"></i><i class="sk"></i></div></section>';
}
function crawlHint(sec) {
  return sec > 10
    ? '比平常久，再等一下；超過 60 秒會停止。讀完會自動出現在這裡，你也可以先看上面的條件。'
    : '通常 2 到 10 秒。讀完會自動出現在這裡，你也可以先看上面的條件。';
}
function fullHTML(it) {
  const facts = it.facts.length ? '<section class="dt-sec"><h3>完整條件</h3><ul class="dt-list">' + it.facts.map(f => {
    const m = f.match(/^([^：]{1,14})：([\s\S]+)$/);
    return m ? '<li><b>' + esc(m[1]) + '</b><span class="sbp">' + softBreak(m[2]) + '</span></li>' : '<li><span class="sbp">' + softBreak(f) + '</span></li>';
  }).join('') + '</ul></section>' : '';
  return '<div class="dt">' + head(it) + statBlock(it) +
    (it.why ? '<div><p class="dt-why sbp">' + softBreak(it.why) + '</p>' + (it.fit || it.honor ? '<p class="dt-fit">' + (it.fit ? '契合度 <b>' + esc(it.fit) + '</b>' : '') + (it.honor ? '導演地位 <b>' + esc(it.honor) + '</b>' : '') + '</p>' : '') + '</div>' : '') +
    warnBox(it.warn) + crawlHTML(it) + firstBox(it) + facts +
    '<section class="dt-sec dt-src"><h3>來源</h3>' + metaLine(it) + link(it) + '</section></div>';
}
function folderHTML(it) {
  const fs = folderState(it), name = it.folderName ? '「' + esc(it.folderName) + '」' : '';
  if (fs === 'failed') return '<div class="fold"><p class="fold-t"><span class="ok-ic bad" aria-hidden="true">!</span>資料夾沒建成</p><p>' + esc(it.folderError || '原因不明') + '</p><p>請跟通通說，他會處理。這張卡已經記成「要做」，不會不見。</p></div>';
  if (fs !== 'done') return '<div class="fold"><p class="fold-t"><span class="spin"></span>' + (it.folderStatus === 'building' ? '正在建立工作資料夾' : '已排隊，等 Mac 接工作') + '</p><p>Mac 每分鐘接一次工作，通常 1 到 2 分鐘內建好，附件多會久一點。你可以先回到面板，不用等。</p></div>';
  const p = it.folderPath, real = /^\//.test(p);
  return '<div class="fold"><p class="fold-t"><span class="ok-ic" aria-hidden="true">✓</span>' + (real ? '工作資料夾建好了' : '這張是示意卡') + '</p><p>' + (real ? '「' + esc(it.title) + '」的工作都放在這個資料夾。' : '示意卡按「要做」不會真的建資料夾，其他流程跟真的一樣。') + '</p>' +
    '<div class="path">' + esc(p || it.folderName) + '</div><div class="acts">' +
    (real ? '<button class="btn btn-primary" data-act="copy-path" data-id="' + esc(it.id) + '" type="button">複製位置</button>' : '') +
    (it.notionUrl ? '<a class="btn btn-ghost" href="' + esc(it.notionUrl) + '" target="_blank" rel="noopener noreferrer">開啟 Notion 頁面</a>' : '') + '</div></div>';
}
function renderDrawer() {
  const dr = $('#drawer'), it = S.drawer && get(S.drawer.id), view = viewOf();
  if (!it || !view) { dr.classList.remove('show'); return; }
  const sc = dr.querySelector('.db') && dr.dataset.key === it.id + view ? dr.querySelector('.db').scrollTop : 0;
  const id = esc(it.id); let label, body, foot = '';
  if (view === 'folder') {
    label = folderState(it) === 'done' ? '已建資料夾' : '建立資料夾';
    body = folderHTML(it);
    foot = '<div class="df"><button class="btn btn-primary" data-act="close-drawer" type="button">回到面板</button></div>';
  } else if (view === 'full') {
    label = '完整內容'; body = fullHTML(it);
    foot = '<div class="df"><button class="btn btn-ghost del" data-act="no" data-id="' + id + '" type="button">不做</button><button class="btn btn-primary" data-act="yes" data-id="' + id + '" type="button">要做，建立工作資料夾</button></div>';
  } else {
    label = '快速預覽'; body = previewHTML(it);
    foot = '<div class="df"><button class="btn btn-ghost del" data-act="del" data-id="' + id + '" type="button">刪掉</button>' +
      (it.status === 'snoozed' ? '' : '<button class="btn btn-ghost hold" data-act="hold" data-id="' + id + '" type="button">暫存</button>') +
      '<button class="btn btn-primary" data-act="dive" data-id="' + id + '" type="button">深入了解</button></div>';
  }
  dr.innerHTML = '<div class="dh"><span>' + label + '</span><button class="xb" data-act="close-drawer" type="button" aria-label="關閉">×</button></div><div class="db">' + body + '</div>' + foot;
  dr.dataset.key = it.id + view;
  dr.querySelector('.db').scrollTop = sc;
  dr.classList.add('show');
}

function renderAll() {
  renderLive(); renderNotice(); renderSummary(); renderBoard(); renderSheet();
  if (S.drawer) { if (!get(S.drawer.id)) closeDrawer(true); else renderDrawer(); }
  syncOverlay();
}

// ---------------- 疊層開關 ----------------
function syncOverlay() {
  const any = S.sheet || !!S.drawer;
  $('#scrim').classList.toggle('show', any);
  $('#app').inert = any; $('#hpill').inert = any;
  $('#app').setAttribute('aria-hidden', any ? 'true' : 'false');
  const want = (S.drawer ? 1 : 0) + (S.sheet ? 1 : 0);
  if (want && !depth) { history.pushState({ opp: 1 }, ''); }
  if (!want && depth) { ignorePop = true; history.back(); }
  depth = want ? 1 : 0;
}
function openDrawer(id, view) {
  if (!get(id)) return;
  if (!S.drawer) lastFocus = document.activeElement;
  S.drawer = { id, view: view || 'preview' };
  if (view === 'full') ensureDetail(id);
  renderDrawer(); syncOverlay();
  const dr = $('#drawer'); if (!dr.contains(document.activeElement)) dr.querySelector('.xb')?.focus({ preventScroll: true });
}
function closeDrawer(silent) {
  S.drawer = null; $('#drawer').classList.remove('show'); syncOverlay();
  if (!silent) restoreFocus();
}
function openSheet() { if (!S.sheet) lastFocus = document.activeElement; S.sheet = true; renderSheet(); syncOverlay(); $('#sheet .xb')?.focus({ preventScroll: true }); }
function closeSheet() { S.sheet = false; $('#sheet').classList.remove('show'); syncOverlay(); restoreFocus(); }
function restoreFocus() { if (!S.sheet && !S.drawer && lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} } }

// ---------------- toast ----------------
let toastT;
function toast(msg, opt = {}) {
  const t = $('#toast'); clearTimeout(toastT);
  t.className = opt.bad ? 'bad' : '';
  t.innerHTML = '<span class="sbp">' + softBreak(msg) + '</span>' + (opt.undo ? '<button type="button" id="toast-undo">復原</button>' : '');
  void t.offsetWidth; t.classList.add('show');
  if (opt.undo) $('#toast-undo').onclick = () => { t.classList.remove('show'); opt.undo(); };
  toastT = setTimeout(() => t.classList.remove('show'), opt.bad ? 7000 : 6000);
}

// ---------------- 寫入：樂觀更新，失敗就還原 ----------------
const nextRemind = () => { const d = new Date(tnow()); d.setDate(d.getDate() + 1); d.setHours(HOLD_HOUR, 0, 0, 0); return d.getTime(); };
const reason = e => {
  if (!(e instanceof AdapterError)) return '發生錯誤';
  if (e.kind === 'state') return /deadline/i.test(e.message) ? '截止日已經過了，救不回來' : '這張卡的狀態已經變了，已重新同步';
  return { timeout: '連線逾時', network: '連不上伺服器', offline: '目前沒有網路', auth: '金鑰失效，請重新開 Borry 專屬網址' }[e.kind] || e.message;
};
const short = t => t.length > 14 ? t.slice(0, 14) + '…' : t;
const nm = it => short(it.shortTitle || it.title);
const NEXT = { stash: 'snoozed', unstash: 'new', deleted: 'dropped', skipped: 'dropped', restore: 'new', build: 'doing' };
const mergeCard = (old, res) => ({ ...res, detailText: res.detailText || (old ? old.detailText : ''), attachments: res.attachments.length ? res.attachments : (old ? old.attachments : []) });

async function mutate(id, action, msg, undo) {
  const it = get(id); if (!it || locks.has(id)) return false;
  const prev = { ...it };
  locks.add(id);
  const next = { ...it, status: NEXT[action] };
  if (action === 'stash') next.snoozeUntil = nextRemind();
  if (action === 'unstash' || action === 'restore') next.snoozeUntil = null;
  if (action === 'deleted' || action === 'skipped') next.dropReason = action;
  if (action === 'build') next.folderStatus = 'queued';
  S.items.set(id, next);
  renderAll();
  if (msg) toast(msg, { undo: undo ? () => undo(prev) : null });
  try {
    const res = await api.act(id, action);
    mutDone[id] = tnow();
    if (res && S.items.has(id)) S.items.set(id, mergeCard(get(id), res));
    saveSnapshot();
    return true;
  } catch (e) {
    S.items.set(id, prev);
    if (e instanceof AdapterError && e.kind === 'auth') { S.net = 'auth'; }
    toast('沒有成功，已經還原：' + reason(e) + (e.kind === 'auth' ? '' : '。'), { bad: true });
    if (e instanceof AdapterError && e.kind === 'state') refresh();
    return false;
  } finally { locks.delete(id); renderAll(); if (action === 'build') kickPoll(); }
}
function leave(id, kind, then) {
  const c = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
  if (!c) return then();
  c.classList.add('leave'); if (kind === 'hold') c.classList.add('r');
  setTimeout(then, 300);
}
// 刪掉與不做都可以復原：呼叫 opp_restore，原本是暫存的再暫存回去
const undoDrop = prev => mutate(prev.id, 'restore', '已復原').then(ok => { if (ok && prev.status === 'snoozed') mutate(prev.id, 'stash'); });
function actDrop(id, why, msg) {
  const it = get(id); if (!it) return;
  if (S.drawer && S.drawer.id === id) closeDrawer(true);
  leave(id, 'del', () => mutate(id, why, msg(it), undoDrop));
}
const actDel = id => actDrop(id, 'deleted', it => '已刪掉「' + nm(it) + '」');
const actNo = id => actDrop(id, 'skipped', it => '不做「' + nm(it) + '」，已收走');
function actHold(id) {
  const it = get(id); if (!it) return;
  if (S.drawer && S.drawer.id === id) closeDrawer(true);
  leave(id, 'hold', () => mutate(id, 'stash', '「' + nm(it) + '」放進待決區，明天 ' + String(HOLD_HOUR).padStart(2, '0') + ':00 集集會傳訊息提醒你', () => mutate(id, 'unstash', '已復原')));
}
function actUnstash(id) {
  const it = get(id); if (!it) return;
  if (S.drawer && S.drawer.id === id) closeDrawer(true);
  mutate(id, 'unstash', '「' + nm(it) + '」已取消暫存，回到待看', () => mutate(id, 'stash', '已復原'));
}

// ---------------- 深入了解：資料庫端讀全文，前端等結果 ----------------
const wait = ms => new Promise(r => setTimeout(r, ms));
const redrawDrawer = id => { if (S.drawer && S.drawer.id === id) renderDrawer(); };
function put(c) { if (c && S.items.has(c.id)) S.items.set(c.id, mergeCard(get(c.id), c)); }
async function ensureDetail(id, force) {
  const it = get(id); if (!it) return;
  if (it.detailText && !force) return;
  const cur = S.detail.get(id); if (cur && cur.busy) return;
  S.detail.set(id, { busy: true, t0: tnow() });
  redrawDrawer(id);
  try {
    let c = it;
    if (force || it.crawlStatus === 'none' || it.crawlStatus === 'failed') c = (await api.act(id, 'dive', { force })) || it;
    else if (it.crawlStatus === 'done' || it.hasFullText) c = (await api.get(id)) || it;
    put(c); redrawDrawer(id);
    const t0 = tnow();
    while (c.crawlStatus === 'crawling' && tnow() - t0 < 60000) { await wait(2000); c = (await api.get(id)) || c; put(c); redrawDrawer(id); }
    if (c.crawlStatus === 'crawling') {
      S.detail.set(id, { busy: false, timedOut: true, t0: (S.detail.get(id) && S.detail.get(id).t0) || t0 });
      saveSnapshot();
      return;
    }
    if (c.crawlStatus === 'done' && !c.detailText) { c = (await api.get(id)) || c; put(c); }
    saveSnapshot();
  } catch (e) {
    if (e instanceof AdapterError && e.kind === 'auth') S.net = 'auth';
    toast('讀全文沒有成功：' + reason(e), { bad: true });
  } finally {
    const d = S.detail.get(id);
    if (!(d && d.timedOut)) S.detail.delete(id);
    renderAll();
  }
}

// ---------------- 讀取：快照、逾時、輪詢、即時 ----------------
const snapKey = () => CONFIG.SNAPSHOT_KEY + ':' + (api.mode === 'mock' ? 'mock' : keyTag());
function loadSnapshot() {
  try { const s = JSON.parse(localStorage.getItem(snapKey()) || 'null'); if (s && Array.isArray(s.items) && s.items.length) { s.items.forEach(i => S.items.set(i.id, i)); S.lastOk = s.at; S.hadData = true; return true; } } catch (e) {}
  return false;
}
function saveSnapshot() {
  try { localStorage.setItem(snapKey(), JSON.stringify({ at: S.lastOk || tnow(), items: items().map(i => ({ ...i, detailText: i.detailText.slice(0, 30000) })) })); } catch (e) {}
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new AdapterError('timeout', '連線逾時')), ms))]);
const sig = () => JSON.stringify(items().map(i => [i.id, i.status, i.snoozeUntil, i.deadline, i.expiresAt, i.title, i.folderStatus, i.folderPath, i.crawlStatus, i.crawlError, i.detailText.length, i.amountDisplay, i.why]));

let inflight = false, pollT, pingT;
async function refresh() {
  if (inflight) return; inflight = true;
  const t0 = tnow(), before = sig(), prevNet = S.net, hadSlow = S.slow;
  const slowT = setTimeout(() => { S.slow = true; renderNotice(); renderLive(); }, CONFIG.SLOW_MS);
  try {
    const r = await withTimeout(api.list(), CONFIG.TIMEOUT_MS);
    if (r.serverTime) OFF = r.serverTime - Date.now();
    const known = new Set(S.items.keys()), added = [], next = new Map();
    r.items.forEach(x => {
      const keepLocal = locks.has(x.id) || (mutDone[x.id] && mutDone[x.id] > t0);
      const old = S.items.get(x.id);
      next.set(x.id, keepLocal && old ? old : mergeCard(old, x));
      if (!known.has(x.id) && x.status === 'new') added.push(x);
    });
    locks.forEach(id => { if (!next.has(id) && S.items.has(id)) next.set(id, S.items.get(id)); });
    S.items = next; S.net = 'ok'; S.hadData = true; S.lastOk = tnow();
    if (S.firstNet && added.length) { added.forEach(a => S.fresh.add(a.id)); toast('新進 ' + added.length + ' 筆：「' + nm(added[0]) + '」' + (added.length > 1 ? ' 等' : '')); }
    S.firstNet = true; saveSnapshot();
    // 讀全文在別處完成了，而且正開著這張卡的詳細頁：把全文抓進來
    const dr = S.drawer && get(S.drawer.id);
    if (dr && viewOf() === 'full' && dr.crawlStatus === 'done' && !dr.detailText) ensureDetail(dr.id);
  } catch (e) {
    S.net = e instanceof AdapterError && e.kind === 'auth' ? 'auth' : 'offline';
  } finally {
    clearTimeout(slowT); S.slow = false; inflight = false;
    if (sig() !== before || S.net !== prevNet || hadSlow) renderAll(); else { renderLive(); renderNotice(); }
  }
}
const needFast = () => items().some(i => i.crawlStatus === 'crawling' || (i.status === 'doing' && folderState(i) === 'wait'));
function schedulePoll() { clearTimeout(pollT); pollT = setTimeout(async () => { if (!document.hidden) await refresh(); schedulePoll(); }, needFast() ? CONFIG.FAST_POLL_MS : CONFIG.POLL_MS); }
function kickPoll() { schedulePoll(); }
const ping = () => { clearTimeout(pingT); pingT = setTimeout(refresh, 150); };

// ---------------- 事件 ----------------
// 手機：在看板上左右滑動切到相鄰的籃子（橫向位移夠大且明顯比直向大才算）
let swX = null, swY = 0, swT = 0;
const board = document.getElementById('board');
board.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || window.innerWidth >= 960 || S.sheet || S.drawer) { swX = null; return; }
  swX = e.touches[0].clientX; swY = e.touches[0].clientY; swT = Date.now();
}, { passive: true });
board.addEventListener('touchend', e => {
  if (swX === null) return;
  const t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY; swX = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - swT > 800) return;
  const i = BASKETS.findIndex(b => b.k === S.tab), j = i + (dx < 0 ? 1 : -1);
  if (i < 0 || j < 0 || j >= BASKETS.length) return;
  S.tab = BASKETS[j].k; renderBoard();
  const cur = document.querySelector('.lane.cur'); if (cur) { cur.classList.add(dx < 0 ? 'sw-l' : 'sw-r'); cur.addEventListener('animationend', () => cur.classList.remove('sw-l', 'sw-r'), { once: true }); }
}, { passive: true });

document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]'), a = act && act.dataset.act, id = act && act.dataset.id;
  if (e.target.id === 'scrim') { S.drawer ? closeDrawer() : closeSheet(); return; }
  const tab = e.target.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; renderBoard(); return; }
  if (e.target.closest('#hpill,#holdbtn')) { openSheet(); return; }
  if (a) {
    switch (a) {
      case 'del': actDel(id); break;
      case 'hold': actHold(id); break;
      case 'unstash': actUnstash(id); break;
      case 'dive': openDrawer(id, 'full'); break;
      case 'no': actNo(id); break;
      case 'yes': mutate(id, 'build'); break;
      case 'open-folder': openDrawer(id, 'folder'); break;
      case 'restore': mutate(id, 'restore', '已救回來，放回待看'); break;
      case 'paste-key': pasteKey(); break;
      case 'retry': refresh(); break;
      case 'retry-detail': ensureDetail(id, true); break;
      case 'toggle-text': S.textOpen.has(id) ? S.textOpen.delete(id) : S.textOpen.add(id); renderDrawer(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'close-hold': closeSheet(); break;
      case 'open-hold': openSheet(); break;
      case 'copy-path': { const it = get(id); navigator.clipboard && it && navigator.clipboard.writeText(it.folderPath).then(() => toast('已複製位置'), () => toast('這個瀏覽器不讓複製，請長按路徑自己複製')); break; }
    }
    return;
  }
  const c = e.target.closest('.card:not(.skel), .pc[data-id]');
  if (c && !e.target.closest('summary,a')) {
    const it = get(c.dataset.id); if (!it || c.closest('.gone')) return;
    openDrawer(c.dataset.id, it.status === 'doing' ? 'folder' : 'preview');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (S.drawer) closeDrawer(); else if (S.sheet) closeSheet(); return; }
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('card')) openDrawer(e.target.dataset.id, 'preview');
  if (e.key === 'Tab' && (S.drawer || S.sheet)) {         // 焦點只在最上層的疊層內打轉
    const box = S.drawer ? $('#drawer') : $('#sheet');
    const f = [...box.querySelectorAll('button,a[href],summary,[tabindex="0"]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
    else if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (S.drawer || S.sheet) { depth = 0; S.drawer = null; S.sheet = false; $('#drawer').classList.remove('show'); $('#sheet').classList.remove('show'); syncOverlay(); renderAll(); }
});
$('#lanes').addEventListener('scroll', edgeFade, { passive: true });
window.addEventListener('resize', edgeFade);
window.addEventListener('online', () => refresh());
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

// ---------------- 啟動 ----------------
function pasteKey() {
  const v = window.prompt('貼上完整網址或金鑰（Borry 專屬網址）');
  const k = tokenFrom(v) || String(v || '').trim();
  if (k.length >= 20) { saveKey(k); location.reload(); } else if (v) toast('這不像金鑰，請貼完整網址', { bad: true });
}
(async function boot() {
  api = await createAdapter();
  loadSnapshot();                        // 先用快照立刻畫出來，不等網路
  S.net = 'loading'; renderAll();
  api.subscribe(ping, on => { S.rt = on; renderLive(); });
  await refresh();
  schedulePoll();
  setInterval(tick, 30000);
  setInterval(() => { if (document.querySelector('[data-elapsed]')) tick(); }, 1000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
