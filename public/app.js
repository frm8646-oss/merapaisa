'use strict';
// ===== MERA PAISA AI — frontend (no secrets here; all logic & keys on server) =====
const $ = s => document.querySelector(s);
const S = { token: localStorage.mp_token || '', lang: localStorage.mp_lang || 'hi', theme: localStorage.mp_theme || 'light', tab: 'home', cats: [] };
const T = {
  home: ['Home', 'होम'], history: ['History', 'हिसाब'], qr: ['Scan & QR', 'स्कैन & QR'], wallet: ['Wallet', 'वॉलेट'], profile: ['Profile', 'प्रोफ़ाइल'],
  ledger: ['Wallet ledger balance', 'वॉलेट लेजर बैलेंस'], bank: ['Bank balance', 'बैंक बैलेंस'], today: ['Today', 'आज'], month: ['This month', 'इस महीने'],
  income: ['Income', 'आमदनी'], expense: ['Expense', 'खर्च'], net: ['Net savings', 'कुल बचत'], recent: ['Recent', 'हाल के लेन-देन'], bills: ['Upcoming bills', 'आने वाले बिल'],
  insights: ['AI insights', 'AI सलाह'], add: ['Add entry', 'एंट्री जोड़ें'], save: ['Save', 'सेव करें'], cancel: ['Cancel', 'रद्द'],
  speak: ['Bolkar likhein', 'बोलकर लिखें'], check: ['Check entries', 'एंट्री जाँचें'], khata: ['Smart Khata', 'स्मार्ट खाता'], budget: ['Budget', 'बजट'],
};
const t = k => (T[k] || [k, k])[S.lang === 'hi' ? 1 : 0];
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { Vegetables: '🥔', Fruits: '🍌', Groceries: '🛒', Milk: '🥛', Electricity: '💡', Rent: '🏠', Petrol: '⛽', Transport: '🛺', Medical: '💊', Shopping: '🛍️', Food: '🍛', Bills: '🧾', Subscriptions: '📺', Salary: '💼', Income: '💰', Other: '📦' };
const ST = { demo: ['Demo', 'डेमो'], pending: ['Pending', 'पेंडिंग'], manual: ['Manually confirmed', 'खुद कन्फर्म'], verified: ['Verified', 'वेरिफाइड'], cancelled: ['Cancelled', 'रद्द'] };
const badge = s => `<span class="badge b-${s}">${(ST[s] || [s, s])[S.lang === 'hi' ? 1 : 0]}</span>`;
const fmtTs = ts => { const d = ts.slice(0, 10).split('-'); return `${d[2]}/${d[1]} ${ts.slice(11, 16)}`; };
const nowIST = () => { const d = new Date(Date.now() + 330 * 60000); return d.toISOString().slice(0, 19) + '+05:30'; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2800); }
document.documentElement.classList.toggle('dark', S.theme === 'dark');

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (r.status === 401 && !path.startsWith('/auth')) { S.token = ''; localStorage.removeItem('mp_token'); render(); throw new Error('Login karein'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new Error(data.error || 'Error');
  return data;
}
async function blobUrl(path) { const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + S.token } }); return URL.createObjectURL(await r.blob()); }
async function download(path, name) { const a = document.createElement('a'); a.href = await blobUrl(path); a.download = name; a.click(); }
const qrUrl = data => blobUrl('/qr.svg?data=' + encodeURIComponent(data));

// ---------- offline queue ----------
const Q = { get: () => JSON.parse(localStorage.mp_queue || '[]'), set: v => localStorage.mp_queue = JSON.stringify(v) };
async function saveTx(list) {
  list = list.map(e => ({ ...e, client_id: e.client_id || uid() }));
  try { return await api('/transactions', { body: list }); }
  catch (e) { if (navigator.onLine && !/Failed to fetch|NetworkError|Load failed/.test(e.message)) throw e; Q.set(Q.get().concat(list.map(x => ({ ...x, source: 'offline-sync' })))); toast('Offline: entry phone mein save, net aane par sync hogi'); return { queued: true }; }
}
async function syncQueue() {
  const q = Q.get(); if (!q.length || !S.token) return;
  try { await api('/transactions', { body: q }); Q.set([]); toast(`${q.length} offline entry sync ho gayi ✅`); if (S.tab === 'home') render(); } catch { }
}
addEventListener('online', syncQueue);

// ---------- shell ----------
function shell(inner) {
  const nav = [['home', '🏠'], ['history', '📜'], ['qr', '▦'], ['wallet', '👛'], ['profile', '👤']];
  return `${inner}${!navigator.onLine || Q.get().length ? `<div class="offline">${!navigator.onLine ? 'Offline mode' : ''} ${Q.get().length ? `· ${Q.get().length} entry sync baaki` : ''}</div>` : ''}
  <button class="fab" onclick="quickEntry()" aria-label="add">＋</button>
  <nav class="bot">${nav.map(([k, i]) => `<a href="#${k}" class="${k === 'qr' ? 'qr ' : ''}${S.tab === k ? 'on' : ''}"><b>${i}</b>${t(k)}</a>`).join('')}</nav>`;
}
addEventListener('hashchange', () => { S.tab = location.hash.slice(1) || 'home'; render(); });

async function render() {
  const app = $('#app');
  if (!S.token) return renderLogin();
  S.tab = location.hash.slice(1) || 'home';
  try {
    if (!S.cats.length) S.cats = await api('/categories');
    app.innerHTML = shell(await ({ home: viewHome, history: viewHistory, qr: viewQR, wallet: viewWallet, profile: viewProfile }[S.tab] || viewHome)());
    (after[S.tab] || (() => { }))();
    window.scrollTo(0, 0);
  } catch (e) { if (S.token) app.innerHTML = shell(`<div class="card">⚠️ ${esc(e.message)}<br><button class="sm" onclick="render()">Retry</button></div>`); }
}
const after = {};

// ---------- login ----------
async function renderLogin() {
  let st; try { st = await api('/auth/status'); } catch { $('#app').innerHTML = '<div class="card">Server se connect nahi ho pa raha</div>'; return; }
  $('#app').innerHTML = `<div style="padding-top:12vh;text-align:center"><img src="/icon.svg" width="84"><h1 style="margin:10px 0 0">MERA PAISA AI</h1><p class="mu">Aapka paisa, aapka hisaab · Demo ledger</p></div>
  <div class="card">${st.setup ? '' : `<label>Aapka naam</label><input id="nm" placeholder="Fazlur">`}
  <label>${st.setup ? 'PIN daalein' : 'Naya PIN banayein (4-6 ank)'}</label><input id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autofocus>
  <button class="full" style="margin-top:14px" id="go">${st.setup ? 'Login' : 'Account banayein'}</button>
  <div class="note">🔒 Ye app kabhi UPI PIN, bank password ya OTP nahi maangta.</div></div>`;
  const go = async () => {
    try { const r = await api(st.setup ? '/auth/login' : '/auth/setup', { body: { pin: $('#pin').value, name: $('#nm')?.value } }); S.token = r.token; localStorage.mp_token = r.token; S.cats = []; syncQueue(); render(); }
    catch (e) { toast(e.message); }
  };
  $('#go').onclick = go; $('#pin').onkeydown = e => e.key === 'Enter' && go();
}

// ---------- home ----------
function txRow(x) {
  return `<div class="tx" onclick="editTx(${x.id})"><div class="ic">${ICON[x.category] || '📦'}</div><div class="mid"><div class="nm">${esc(x.item)}</div><div class="mu">${esc(x.category)} · ${fmtTs(x.ts)} · ${esc(x.method)} ${badge(x.status)}</div></div>
  <div class="amt ${x.type === 'income' ? 'in' : 'out'}">${x.type === 'income' ? '+' : '−'}${inr(x.amount)}</div></div>`;
}
async function viewHome() {
  const s = await api('/summary'); S.sum = s;
  return `<header class="top"><div><div class="sub">Namaste,</div><h1>${esc(s.user.name)} 👋</h1></div><span class="badge">SANDBOX</span></header>
  <div class="card hero"><div class="lbl">${t('ledger')} <span class="badge">Demo / Ledger</span></div><div class="big">${inr(s.ledgerBalance)}</div>
  <div class="lbl" style="margin-top:6px">Ye app ka andar ka hisaab hai, bank balance nahi.</div></div>
  <div class="card" style="padding:12px 16px"><div class="row"><div><div class="mu">🏦 ${t('bank')}</div><b>Bank link nahi hai</b><div class="mu">Phase 3: Account Aggregator se aayega · Last sync: —</div></div></div></div>
  <div class="grid2"><div class="mini"><div class="l">${t('today')} ${t('income')}</div><div class="v in">${inr(s.today.income)}</div></div><div class="mini"><div class="l">${t('today')} ${t('expense')}</div><div class="v out">${inr(s.today.expense)}</div></div>
  <div class="mini"><div class="l">${t('month')} ${t('income')}</div><div class="v in">${inr(s.month.income)}</div></div><div class="mini"><div class="l">${t('month')} ${t('expense')}</div><div class="v out">${inr(s.month.expense)}</div></div></div>
  <div class="card"><div class="row"><div><div class="mu">${t('net')} (${t('month')})</div><div style="font-size:24px;font-weight:800" class="${s.month.net >= 0 ? 'in' : 'out'}">${inr(s.month.net)}</div></div>
  ${s.pendingRequests.count ? `<div style="text-align:right"><a href="#qr" class="mu">⏳ ${s.pendingRequests.count} QR request pending<br><b>${inr(s.pendingRequests.amount)}</b></a></div>` : ''}</div></div>
  <div class="card"><h2>🧠 ${t('insights')}</h2>${s.insights.map(i => `<div class="ins"><span>${i.icon}</span><span>${esc(S.lang === 'hi' ? i.hi : i.en)}</span></div>`).join('')}</div>
  ${s.budgets.filter(b => b.level).map(b => `<div class="card" style="border-color:${b.level >= 100 ? 'var(--out)' : 'var(--warn)'}">🚨 <b>${b.period} budget${b.category ? ' · ' + esc(b.category) : ''}: ${b.pct}%</b> (${inr(b.spent)} / ${inr(b.limit)})</div>`).join('')}
  <div class="card"><h2>${t('recent')} <a href="#history" class="mu">Sab dekhein →</a></h2>${s.recent.length ? s.recent.map(txRow).join('') : '<p class="mu">Abhi koi entry nahi. Neeche ＋ dabaiye ya bolkar likhiye.</p>'}</div>
  <div class="card"><h2>🧾 ${t('bills')} <button class="sm sec" onclick="addBill()">＋ Bill</button></h2>${s.bills.length ? s.bills.map(b => `<div class="tx"><div class="ic">🧾</div><div class="mid"><div class="nm">${esc(b.name)}</div><div class="mu">Due ${b.due}</div></div><div class="amt">${inr(b.amount)}<br><button class="sm" onclick="payBill(${b.id})">Paid ✓</button></div></div>`).join('') : '<p class="mu">Koi bill nahi</p>'}</div>`;
}
function addBill() {
  sheet(`<h2>Naya bill</h2><label>Naam</label><input id="bn" placeholder="Bijli bill"><label>Amount ₹</label><input id="ba" type="number" inputmode="decimal"><label>Due date</label><input id="bd" type="date" value="${nowIST().slice(0, 10)}"><br><br><button class="full" id="bs">${t('save')}</button>`);
  $('#bs').onclick = async () => { try { await api('/bills', { body: { name: $('#bn').value, amount: $('#ba').value, due: $('#bd').value } }); closeSheet(); render(); } catch (e) { toast(e.message); } };
}
async function payBill(id) { await api(`/bills/${id}/pay`, { body: {} }); toast('Bill paid — kharche mein jud gaya'); render(); }

// ---------- sheet ----------
function sheet(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.classList.remove('hidden'); m.onclick = e => { if (e.target === m) closeSheet(); }; }
function closeSheet() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; stopCam(); }

// ---------- AI quick entry ----------
function quickEntry(prefill = '') {
  sheet(`<h2>✨ AI Quick Entry <button class="sm sec" onclick="closeSheet()">✕</button></h2>
  <p class="mu">Hindi, Hinglish ya English mein likhiye ya bolye. Jaise: "Aaj 40 rupaye aloo liya aur 30 rupaye tamatar"</p>
  <textarea id="qt" placeholder="500 rupaye petrol mein kharch hue">${esc(prefill)}</textarea>
  <div class="chips" style="margin:8px 0">${['Aaj 40 rupaye aloo liya aur 30 rupaye tamatar.', '500 rupaye petrol mein kharch hue.', 'Mujhe 1000 rupaye mile.'].map(x => `<button class="chip" onclick="$('#qt').value=this.textContent">${x}</button>`).join('')}</div>
  <div class="row"><button class="sec mic" id="mic">🎤 ${t('speak')}</button><button id="qp">${t('check')} →</button></div>
  <div id="qres"></div><hr style="border:0;border-top:1px solid var(--br);margin:16px 0"><button class="sec full" onclick="manualEntry()">✍️ Form se entry</button>`);
  $('#qp').onclick = async () => { try { const r = await api('/parse', { body: { text: $('#qt').value } }); showParsed(r.entries); } catch (e) { toast(e.message); } };
  $('#mic').onclick = voice;
}
function voice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Is browser mein voice nahi chalta. Chrome use karein.');
  const r = new SR(); r.lang = S.lang === 'hi' ? 'hi-IN' : 'en-IN'; r.interimResults = true;
  $('#mic').classList.add('rec');
  r.onresult = e => { $('#qt').value = [...e.results].map(x => x[0].transcript).join(' '); };
  r.onend = () => { $('#mic')?.classList.remove('rec'); if ($('#qt')?.value) $('#qp').click(); };
  r.onerror = e => toast('Mic: ' + e.error); r.start();
}
function catOpts(sel) { return S.cats.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join(''); }
function showParsed(list) {
  S.parsed = list;
  if (!list.length) return $('#qres').innerHTML = '<div class="note">Koi amount nahi mila. Jaise likhein: "50 rupaye doodh"</div>';
  $('#qres').innerHTML = `<h2 style="margin-top:14px">${list.length} entry mili — check karein</h2>` + list.map((e, i) => `<div class="ent ${e.uncertain ? 'unc' : ''}">
    ${e.uncertain ? `<div class="mu">⚠️ Pakka nahi: ${esc(e.issues.join(', '))} — sahi karke save karein</div>` : ''}
    <div class="row"><input data-i="${i}" data-k="item" value="${esc(e.item)}"><input data-i="${i}" data-k="amount" type="number" inputmode="decimal" value="${e.amount}" style="max-width:110px"></div>
    <div class="row" style="margin-top:6px"><select data-i="${i}" data-k="type"><option value="expense" ${e.type === 'expense' ? 'selected' : ''}>− ${t('expense')}</option><option value="income" ${e.type === 'income' ? 'selected' : ''}>+ ${t('income')}</option></select>
    <select data-i="${i}" data-k="category">${catOpts(e.category)}</select></div>
    <div class="row" style="margin-top:6px"><select data-i="${i}" data-k="method">${['Cash', 'UPI', 'Card', 'Bank'].map(m => `<option ${m === e.method ? 'selected' : ''}>${m}</option>`).join('')}</select><span class="mu">🕒 ${fmtTs(e.ts)} IST</span>
    <label style="flex:0;white-space:nowrap"><input type="checkbox" data-i="${i}" data-k="keep" checked style="width:auto;min-height:auto"> rakhein</label></div></div>`).join('') +
    `<button class="full" id="qs">✅ ${t('save')} (${list.length})</button><div class="note">Ye entries Demo ledger mein jayengi (status: Demo).</div>`;
  $('#qs').onclick = async () => {
    document.querySelectorAll('#qres [data-k]').forEach(el => { const e = S.parsed[el.dataset.i]; e[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
    const keep = S.parsed.filter(e => e.keep !== false).map(({ item, amount, type, category, method, ts }) => ({ item, amount: Number(amount), type, category, method, ts }));
    try { const r = await saveTx(keep); closeSheet(); toast(r.queued ? 'Offline save' : `${keep.length} entry save ho gayi ✅`); render(); } catch (e) { toast(e.message); }
  };
}
function manualEntry(x = {}) {
  const ts = (x.ts || nowIST()).slice(0, 16);
  sheet(`<h2>${x.id ? 'Entry badlein' : t('add')} <button class="sm sec" onclick="closeSheet()">✕</button></h2>
  ${x.id ? `<div>${badge(x.status)} <span class="mu">${esc(x.source || '')} ${x.upi_ref ? '· UPI ref ' + esc(x.upi_ref) : ''}</span></div>` : ''}
  <div class="tabs"><button id="te" class="${x.type !== 'income' ? 'on' : ''}">− ${t('expense')}</button><button id="ti" class="${x.type === 'income' ? 'on' : ''}">+ ${t('income')}</button></div>
  <label>Item</label><input id="mi" value="${esc(x.item || '')}"><label>Amount ₹</label><input id="ma" type="number" inputmode="decimal" value="${x.amount || ''}">
  <div class="row"><div><label>Category</label><select id="mc">${catOpts(x.category || 'Other')}</select></div><div><label>Method</label><select id="mm">${['Cash', 'UPI', 'Card', 'Bank'].map(m => `<option ${m === x.method ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
  <label>Date & time (IST)</label><input id="mt" type="datetime-local" value="${ts}"><label>Note</label><input id="mn" value="${esc(x.note || '')}"><br><br>
  <div class="row">${x.id ? `<button class="dang" id="md">🗑 Delete</button>` : ''}<button id="ms">${t('save')}</button></div>`);
  let type = x.type || 'expense';
  $('#te').onclick = () => { type = 'expense'; $('#te').classList.add('on'); $('#ti').classList.remove('on'); };
  $('#ti').onclick = () => { type = 'income'; $('#ti').classList.add('on'); $('#te').classList.remove('on'); };
  $('#ms').onclick = async () => {
    const b = { type, item: $('#mi').value, amount: Number($('#ma').value), category: $('#mc').value, method: $('#mm').value, ts: $('#mt').value + ':00+05:30', note: $('#mn').value };
    try { if (x.id) await api('/transactions/' + x.id, { method: 'PUT', body: b }); else await saveTx([b]); closeSheet(); toast('Save ✅'); render(); } catch (e) { toast(e.message); }
  };
  if (x.id) $('#md').onclick = async () => { if (confirm('Delete karein?')) { await api('/transactions/' + x.id, { method: 'DELETE' }); closeSheet(); toast('Delete ho gaya'); render(); } };
}
async function editTx(id) { const list = await api('/transactions?limit=5000'); const x = list.find(v => v.id === id); if (x) manualEntry(x); }

// ---------- history ----------
S.f = { q: '', type: '', category: '', status: '', view: 'list', month: nowIST().slice(0, 7), day: '' };
async function viewHistory() {
  const f = S.f; const p = new URLSearchParams();
  ['q', 'type', 'category', 'status'].forEach(k => f[k] && p.set(k, f[k]));
  if (f.view === 'cal') { p.set('from', f.month + '-01'); p.set('to', f.month + '-31'); }
  if (f.day) { p.set('from', f.day); p.set('to', f.day); }
  const list = await api('/transactions?' + p); S.hist = list;
  const tin = list.filter(x => x.type === 'income' && x.status !== 'pending').reduce((a, x) => a + x.amount, 0), tout = list.filter(x => x.type === 'expense' && x.status !== 'pending').reduce((a, x) => a + x.amount, 0);
  let cal = '';
  if (f.view === 'cal') {
    const [y, m] = f.month.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const all = await api(`/transactions?from=${f.month}-01&to=${f.month}-31`); const by = {};
    all.forEach(x => { const d = +x.ts.slice(8, 10); by[d] = by[d] || { i: 0, o: 0 }; x.status !== 'pending' && (by[d][x.type === 'income' ? 'i' : 'o'] += x.amount); });
    cal = `<div class="card"><div class="row"><button class="sm sec" onclick="calMove(-1)">◀</button><b style="text-align:center">${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><button class="sm sec" onclick="calMove(1)">▶</button></div><br>
    <div class="cal">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="mu">${d}</div>`).join('')}${'<div></div>'.repeat(first)}${Array.from({ length: days }, (_, i) => { const d = i + 1, ds = `${f.month}-${String(d).padStart(2, '0')}`, v = by[d]; return `<div class="d ${f.day === ds ? 'sel' : ''}" onclick="S.f.day=S.f.day==='${ds}'?'':'${ds}';render()"><b>${d}</b>${v ? `${v.i ? `<small class="in">+${Math.round(v.i)}</small>` : ''}${v.o ? `<small class="out">-${Math.round(v.o)}</small>` : ''}` : ''}</div>`; }).join('')}</div></div>`;
  }
  return `<header class="top"><h1>📜 ${t('history')}</h1><div class="row" style="flex:0"><button class="sm sec" onclick="exportFile('csv')">CSV</button><button class="sm sec" onclick="exportFile('pdf')">PDF</button></div></header>
  <input id="hs" placeholder="🔍 Search: aloo, petrol..." value="${esc(f.q)}">
  <div class="tabs"><button class="${f.view === 'list' ? 'on' : ''}" onclick="S.f.view='list';S.f.day='';render()">📋 List</button><button class="${f.view === 'cal' ? 'on' : ''}" onclick="S.f.view='cal';render()">📅 Calendar</button></div>
  <div class="chips">${[['', 'Sab'], ['income', '+ Income'], ['expense', '− Kharcha']].map(([v, l]) => `<button class="chip ${f.type === v ? 'on' : ''}" onclick="S.f.type='${v}';render()">${l}</button>`).join('')}
  ${['demo', 'pending', 'manual', 'verified'].map(v => `<button class="chip ${f.status === v ? 'on' : ''}" onclick="S.f.status=S.f.status==='${v}'?'':'${v}';render()">${ST[v][S.lang === 'hi' ? 1 : 0]}</button>`).join('')}</div>
  <select id="hc" style="margin-top:8px"><option value="">Sab category</option>${S.cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  ${cal}<div class="card"><div class="row"><span class="in">+${inr(tin)}</span><span class="out" style="text-align:right">−${inr(tout)}</span></div>
  ${list.length ? list.map(txRow).join('') : '<p class="mu">Kuch nahi mila</p>'}</div>`;
}
after.history = () => {
  $('#hs').onchange = e => { S.f.q = e.target.value; render(); };
  $('#hc').onchange = e => { S.f.category = e.target.value; render(); };
};
function calMove(n) { const [y, m] = S.f.month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); S.f.month = d.toISOString().slice(0, 7); S.f.day = ''; render(); }
function exportFile(kind) { const p = S.f.view === 'cal' ? `?from=${S.f.month}-01&to=${S.f.month}-31` : ''; download(`/export.${kind}${p}`, `mera-paisa.${kind}`); }

// ---------- Scan & QR ----------
S.qtab = 'my';
async function viewQR() {
  const prof = await api('/upi/profile'); S.prof = prof;
  const tabs = `<div class="tabs">${[['my', '▦ Mera QR'], ['req', '₹ Paisa maango'], ['scan', '📷 Scan & Pay']].map(([k, l]) => `<button class="${S.qtab === k ? 'on' : ''}" onclick="S.qtab='${k}';render()">${l}</button>`).join('')}</div>`;
  let body = '';
  if (S.qtab === 'my') {
    body = prof ? `<div class="card"><div class="qrbox"><div style="font-weight:800">${esc(prof.name || 'Mera QR')}</div><img id="myqr" alt="QR"><div style="font-size:14px">${esc(prof.vpa)}</div><div style="font-size:11px;color:#666">UPI · Scan karke kisi bhi UPI app se pay karein</div></div>
      <div class="row" style="margin-top:12px"><button class="sec" onclick="dlQR()">⬇️ Download</button><button class="sec" onclick="shareLink()">🔗 Pay link</button></div>
      <div class="note">✅ Ye aapka <b>asli UPI QR</b> hai (${prof.source === 'uploaded-qr' ? 'aapke upload kiye QR se' : 'aapki UPI ID se'}). Is par aaya paisa seedha aapke bank mein jayega. App use verify nahi kar sakta — "Paisa maango" se request banayein aur paisa aane par "Paisa mila" dabayein.</div></div>
      <div class="card"><h2>Badlein</h2>${upiForm(prof)}</div>` : `<div class="card"><h2>Apna QR jodiye</h2><p class="mu">Do tarike: apni UPI ID daalein, ya apne QR ki photo upload karein.</p>${upiForm({})}</div>`;
  } else if (S.qtab === 'req') {
    const reqs = await api('/pay-requests');
    body = prof ? `<div class="card"><h2>Amount wala QR banayein</h2><label>Amount ₹</label><input id="ra" type="number" inputmode="decimal" placeholder="500"><label>Kisse? (optional)</label><input id="rp" placeholder="Ramesh"><label>Note</label><input id="rn" placeholder="Doodh ka hisaab">
      <button class="full" style="margin-top:12px" id="rc">QR banayein</button><div id="rout"></div></div>
      <div class="card"><h2>Payment requests</h2>${reqs.length ? reqs.map(r => `<div class="tx"><div class="ic">${r.status === 'pending' ? '⏳' : r.status === 'cancelled' ? '✖️' : '✅'}</div><div class="mid"><div class="nm">${inr(r.amount)} ${r.payer ? '· ' + esc(r.payer) : ''}</div><div class="mu">${fmtTs(r.created)} · ${esc(r.ref)} ${badge(r.status)}</div></div>
      ${r.status === 'pending' ? `<div style="display:flex;flex-direction:column;gap:4px"><button class="sm" onclick="confirmReq(${r.id})">Paisa mila ✓</button><button class="sm sec" onclick="cancelReq(${r.id})">Cancel</button></div>` : ''}</div>`).join('') : '<p class="mu">Abhi koi request nahi</p>'}
      <div class="note">⏳ Pending = ledger mein nahi juda. "Paisa mila" dabane se pehle apne bank/UPI app mein zaroor check karein. Entry "Manually confirmed" banegi, "Verified" nahi.</div></div>` : '<div class="card">Pehle "Mera QR" mein apni UPI ID jodiye.</div>';
  } else {
    body = `<div class="card"><h2>📷 Scan & Pay</h2><video id="cam" playsinline muted class="hidden"></video><canvas id="cv" class="hidden"></canvas>
      <div class="row"><button id="cs">📷 Camera kholein</button><label class="btn sec" style="text-align:center;margin:0;color:var(--tx);display:flex;align-items:center;justify-content:center">🖼 Photo se<input type="file" accept="image/*" id="sf" class="hidden"></label></div><div id="sres"></div>
      <div class="note">Scan karke aapka UPI app (GPay/PhonePe/Paytm) khulega. UPI PIN sirf aapke UPI app mein daalein — ye app kabhi PIN nahi maangta.</div></div>`;
  }
  return `<header class="top"><h1>▦ ${t('qr')}</h1><span class="badge">Real UPI · Bank direct</span></header>${tabs}${body}`;
}
function upiForm(p) {
  return `<label>UPI ID</label><input id="uv" placeholder="naam@okaxis" value="${esc(p.vpa || '')}" autocapitalize="off"><label>Naam (QR par dikhega)</label><input id="un" placeholder="Fazlur Rahman Ansari" value="${esc(p.name || '')}">
  <button class="full" style="margin-top:10px" onclick="saveUpi()">✅ UPI ID se QR banayein</button>
  <div style="text-align:center;margin:10px 0" class="mu">— ya —</div>
  <label class="btn sec" style="display:block;text-align:center;color:var(--tx)">🖼 Apna purana QR upload karein<input type="file" accept="image/*" class="hidden" onchange="uploadQR(this.files[0])"></label>`;
}
after.qr = async () => {
  if (S.qtab === 'my' && S.prof) { S.myUri = (await api('/upi/link', { body: {} })).uri; $('#myqr').src = await qrUrl(S.myUri); }
  if (S.qtab === 'req' && $('#rc')) $('#rc').onclick = async () => {
    try { const r = await api('/pay-requests', { body: { amount: $('#ra').value, payer: $('#rp').value, note: $('#rn').value } }); S.lastReq = r;
      $('#rout').innerHTML = `<div class="qrbox" style="margin-top:12px"><b>${inr(r.amount)}</b><img id="rq"><div style="font-size:12px">${esc(S.prof.vpa)} · Ref ${esc(r.ref)}</div></div><div class="row" style="margin-top:8px"><button class="sec" onclick="shareText(S.lastReq.uri)">🔗 Share link</button><button onclick="render()">Ho gaya</button></div><div class="note">Status: ⏳ Pending</div>`;
      $('#rq').src = await qrUrl(r.uri);
    } catch (e) { toast(e.message); }
  };
  if (S.qtab === 'scan') { $('#cs').onclick = startCam; $('#sf').onchange = e => decodeFile(e.target.files[0], handleScan); }
};
async function saveUpi() { try { await api('/upi/profile', { body: { vpa: $('#uv').value, name: $('#un').value } }); toast('QR ready ✅'); render(); } catch (e) { toast(e.message); } }
function decodeFile(file, cb) {
  if (!file) return; const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); const sc = Math.min(1, 1400 / Math.max(img.width, img.height)); c.width = img.width * sc; c.height = img.height * sc;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height); const d = g.getImageData(0, 0, c.width, c.height);
    const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' }); cb(r ? r.data : null);
  };
  img.src = URL.createObjectURL(file);
}
function uploadQR(file) {
  decodeFile(file, async data => {
    if (!data) return toast('QR padh nahi paaye. Saaf photo / screenshot try karein.');
    try { const p = await api('/upi/decode', { body: { text: data } }); if (!p.ok) return toast(p.error);
      if (!confirm(`Ye QR mila:\nUPI ID: ${p.vpa}\nNaam: ${p.name || '-'}\n\nIse apna QR banayein?`)) return;
      await api('/upi/profile', { body: { raw: data, name: $('#un')?.value || p.name } }); toast('Aapka QR jud gaya ✅'); S.qtab = 'my'; render();
    } catch (e) { toast(e.message); }
  });
}
async function dlQR() { const a = document.createElement('a'); a.href = await blobUrl('/qr.png?data=' + encodeURIComponent(S.myUri)); a.download = 'mera-upi-qr.png'; a.click(); }
function shareText(text) { if (navigator.share) navigator.share({ title: 'UPI Pay', text }).catch(() => { }); else navigator.clipboard.writeText(text).then(() => toast('Link copy ho gaya')); }
function shareLink() { shareText(S.myUri); }
async function confirmReq(id) {
  const ref = prompt('Bank/UPI app mein paisa aa gaya? UPI reference number (12 ank) daalein — optional, duplicate rokne ke liye:');
  if (ref === null) return;
  try { await api(`/pay-requests/${id}/confirm`, { body: { upi_ref: ref || null } }); toast('Income jud gayi (Manually confirmed) ✅'); render(); } catch (e) { toast(e.message); }
}
async function cancelReq(id) { await api(`/pay-requests/${id}/cancel`, { body: {} }); render(); }
let stream, raf;
async function startCam() {
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { return toast('Camera permission nahi mili'); }
  const v = $('#cam'), c = $('#cv'); v.classList.remove('hidden'); v.srcObject = stream; await v.play();
  const tick = () => { if (!stream) return; if (v.readyState >= 2) { c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d'); g.drawImage(v, 0, 0); const r = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height); if (r) { stopCam(); return handleScan(r.data); } } raf = requestAnimationFrame(tick); };
  tick();
}
function stopCam() { if (stream) { stream.getTracks().forEach(x => x.stop()); stream = null; cancelAnimationFrame(raf); } }
async function handleScan(data) {
  if (!data) return toast('QR nahi mila');
  const p = await api('/upi/decode', { body: { text: data } });
  if (!p.ok) return $('#sres').innerHTML = `<div class="note">⚠️ ${esc(p.error)}<br><small>${esc(data.slice(0, 120))}</small></div>`;
  S.scan = p;
  $('#sres').innerHTML = `<div class="card"><b>${esc(p.name || 'UPI')}</b><div class="mu">${esc(p.vpa)}</div>${p.amount ? `<div style="font-size:24px;font-weight:800">${inr(p.amount)}</div>` : `<label>Amount ₹</label><input id="sa" type="number" inputmode="decimal">`}
  <label>Item / kis liye</label><input id="si" placeholder="Sabzi"><button class="full" style="margin-top:10px" id="sp">UPI app se Pay karein →</button>
  <div class="note">Pay hone ke baad wapas aakar "Pay ho gaya" dabayein to kharcha jud jayega.</div><button class="sec full" style="margin-top:8px" id="sd">✓ Pay ho gaya — kharche mein jodein</button></div>`;
  const amt = () => p.amount || Number($('#sa').value);
  $('#sp').onclick = () => { const a = amt(); const u = new URLSearchParams({ pa: p.vpa, pn: p.name || '', cu: 'INR' }); if (a) u.set('am', a.toFixed(2)); if (p.note) u.set('tn', p.note); location.href = 'upi://pay?' + u.toString().replace(/\+/g, '%20'); };
  $('#sd').onclick = async () => { const a = amt(); if (!(a > 0)) return toast('Amount daalein'); const item = $('#si').value || p.name || p.vpa; const r = await api('/parse', { body: { text: item } }); await saveTx([{ type: 'expense', item, amount: a, category: r.entries[0]?.category || 'Other', method: 'UPI', ts: nowIST(), note: 'Paid to ' + p.vpa }]); toast('Kharcha jud gaya ✅'); location.hash = 'home'; };
}

// ---------- wallet ----------
async function viewWallet() {
  const [s, k, b] = await Promise.all([api('/summary'), api('/khata'), api('/budgets')]);
  return `<header class="top"><h1>👛 ${t('wallet')}</h1><span class="badge">Demo / Ledger</span></header>
  <div class="card hero"><div class="lbl">Total money overview</div><div class="big">${inr(s.ledgerBalance)}</div><div class="lbl">Ledger balance (Demo) · Bank: link nahi hai</div></div>
  <div class="grid2"><div class="mini"><div class="l">Money received</div><div class="v in">${inr(s.totals.received)}</div></div><div class="mini"><div class="l">Money sent / spent</div><div class="v out">${inr(s.totals.sent)}</div></div></div>
  <div class="card"><div class="row"><button class="sec" onclick="ledgerMove('income')">＋ Add money</button><button class="sec" onclick="ledgerMove('expense')">− Withdraw</button></div>
  <div class="note">Add/Withdraw sirf Demo ledger mein entry hai. Asli wallet (stored value) sirf RBI-authorised PPI/bank partner aur KYC ke baad (Phase 4).</div></div>
  <div class="card"><h2>📒 ${t('khata')} <button class="sm" onclick="addPerson()">＋ Vyakti</button></h2>
  <div class="grid2"><div class="mini"><div class="l">Mujhe lene hain</div><div class="v in">${inr(k.toGet)}</div></div><div class="mini"><div class="l">Mujhe dene hain</div><div class="v out">${inr(k.toGive)}</div></div></div>
  ${k.people.map(p => `<div class="tx" onclick="openPerson(${p.id})"><div class="ic">👤</div><div class="mid"><div class="nm">${esc(p.name)}</div><div class="mu">${p.balance > 0 ? 'Aapko dega' : p.balance < 0 ? 'Aapko dena hai' : 'Hisaab barabar ✓'}</div></div><div class="amt ${p.balance > 0 ? 'in' : p.balance < 0 ? 'out' : ''}">${inr(Math.abs(p.balance))}</div></div>`).join('') || '<p class="mu">Udhaar ka hisaab yahan rakhein</p>'}</div>
  <div class="card"><h2>🎯 ${t('budget')} <button class="sm" onclick="addBudget()">＋ Budget</button></h2>
  ${b.map(x => `<div style="margin:10px 0"><div class="row"><b>${x.period}${x.category ? ' · ' + esc(x.category) : ' · Total'}</b><span style="text-align:right" class="mu">${inr(x.spent)} / ${inr(x.limit)} <a onclick="delBudget(${x.id})">✕</a></span></div><div class="bar"><i class="${x.pct >= 100 ? 'w100' : x.pct >= 80 ? 'w80' : ''}" style="width:${Math.min(100, x.pct)}%"></i></div>${x.level ? `<div class="mu" style="color:${x.level >= 100 ? 'var(--out)' : 'var(--warn)'}">⚠️ ${x.pct}% kharch ho gaya</div>` : ''}</div>`).join('') || '<p class="mu">Roz/hafte/mahine ka budget set karein — 80%, 90%, 100% par alert milega</p>'}</div>`;
}
function ledgerMove(type) {
  sheet(`<h2>${type === 'income' ? 'Add money (Demo)' : 'Withdraw (Demo)'}</h2><label>Amount ₹</label><input id="la" type="number" inputmode="decimal"><label>Note</label><input id="ln" placeholder="${type === 'income' ? 'Cash jama' : 'Cash nikala'}"><br><br><button class="full" id="ls">${t('save')}</button>`);
  $('#ls').onclick = async () => { try { await saveTx([{ type, item: $('#ln').value || (type === 'income' ? 'Add money' : 'Withdraw'), amount: Number($('#la').value), category: type === 'income' ? 'Income' : 'Other', method: 'Cash', ts: nowIST() }]); closeSheet(); render(); } catch (e) { toast(e.message); } };
}
function addPerson() { const n = prompt('Naam?'); if (n) api('/khata/people', { body: { name: n } }).then(p => openPerson(p.id)).catch(e => toast(e.message)); }
async function openPerson(id) {
  const p = await api('/khata/people/' + id);
  const K = { lent: ['Maine diya (udhaar)', 'out'], borrowed: ['Maine liya (udhaar)', 'in'], got_back: ['Wapas mila', 'in'], paid_back: ['Maine lautaya', 'out'] };
  sheet(`<h2>👤 ${esc(p.name)} <button class="sm sec" onclick="closeSheet();render()">✕</button></h2>
  <div class="card hero" style="margin-top:0"><div class="lbl">${p.balance > 0 ? 'Aapko dega' : p.balance < 0 ? 'Aapko dena hai' : 'Hisaab barabar'}</div><div class="big">${inr(Math.abs(p.balance))}</div></div>
  <label>Amount ₹</label><input id="ka" type="number" inputmode="decimal"><label>Note</label><input id="kn">
  <div class="grid2" style="margin-top:10px">${Object.entries(K).map(([k, [l]]) => `<button class="${k === 'lent' || k === 'borrowed' ? '' : 'sec'}" onclick="khataAdd(${id},'${k}')">${l}</button>`).join('')}</div>
  <h2 style="margin-top:16px">Settlement history</h2>${p.entries.map(e => `<div class="tx"><div class="mid"><div class="nm">${K[e.kind][0]}</div><div class="mu">${fmtTs(e.ts)} ${esc(e.note || '')}</div></div><div class="amt ${K[e.kind][1]}">${inr(e.amount)}</div></div>`).join('') || '<p class="mu">Koi entry nahi</p>'}
  <button class="dang sm" style="margin-top:12px" onclick="if(confirm('${esc(p.name)} ka poora khata delete?'))api('/khata/people/${id}',{method:'DELETE'}).then(()=>{closeSheet();render()})">Delete khata</button>`);
}
async function khataAdd(id, kind) { try { const r = await api('/khata/entries', { body: { person_id: id, kind, amount: Number($('#ka').value), note: $('#kn').value } }); if (r.settled) toast('🎉 Hisaab barabar!'); openPerson(id); } catch (e) { toast(e.message); } }
function addBudget() {
  sheet(`<h2>🎯 Budget</h2><label>Period</label><select id="bp"><option value="daily">Daily (roz)</option><option value="weekly">Weekly (hafta)</option><option value="monthly" selected>Monthly (mahina)</option></select>
  <label>Category</label><select id="bc"><option value="">Total (sab kharcha)</option>${catOpts('')}</select><label>Limit ₹</label><input id="bl" type="number" inputmode="decimal"><br><br><button class="full" id="bs">${t('save')}</button>`);
  $('#bs').onclick = async () => { try { await api('/budgets', { body: { period: $('#bp').value, category: $('#bc').value || null, amount: Number($('#bl').value) } }); closeSheet(); render(); } catch (e) { toast(e.message); } };
}
async function delBudget(id) { await api('/budgets/' + id, { method: 'DELETE' }); render(); }

// ---------- profile ----------
async function viewProfile() {
  const s = S.sum || await api('/summary');
  return `<header class="top"><h1>👤 ${t('profile')}</h1></header>
  <div class="card"><b>${esc(s.user.name)}</b><div class="mu">Mode: SANDBOX · Asia/Kolkata · INR</div></div>
  <div class="card"><h2>Settings</h2>
  <div class="row"><span>Bhasha / Language</span><div class="tabs" style="flex:0 0 170px"><button class="${S.lang === 'hi' ? 'on' : ''}" onclick="setLang('hi')">हिंदी</button><button class="${S.lang === 'en' ? 'on' : ''}" onclick="setLang('en')">English</button></div></div>
  <div class="row"><span>Theme</span><div class="tabs" style="flex:0 0 170px"><button class="${S.theme === 'light' ? 'on' : ''}" onclick="setTheme('light')">☀️</button><button class="${S.theme === 'dark' ? 'on' : ''}" onclick="setTheme('dark')">🌙</button></div></div></div>
  <div class="card"><h2>Categories</h2><div class="chips" style="flex-wrap:wrap">${S.cats.map(c => `<span class="chip">${ICON[c] || '🏷️'} ${esc(c)}</span>`).join('')}</div><div class="row" style="margin-top:10px"><input id="nc" placeholder="Nayi category"><button style="flex:0" onclick="addCat()">＋</button></div></div>
  <div class="card"><h2>Backup & Security</h2><div class="grid2"><button class="sec" onclick="download('/backup','mera-paisa-backup.json')">⬇️ Backup</button><label class="btn sec" style="text-align:center;color:var(--tx);margin:0">⬆️ Restore<input type="file" accept=".json" class="hidden" onchange="restore(this.files[0])"></label>
  <button class="sec" onclick="changePin()">🔑 PIN badlein</button><button class="sec" onclick="showAudit()">🧾 Audit log</button></div>
  <div class="note">🔒 PIN server par hashed (scrypt) save hota hai. App kabhi UPI PIN / bank password / OTP nahi maangta. Secret keys sirf server par.</div></div>
  <div class="card"><h2>Status ka matlab</h2><div class="mu">${badge('demo')} App ke andar ka hisaab<br>${badge('pending')} QR request — paisa abhi confirm nahi<br>${badge('manual')} Aapne khud "Paisa mila" dabaya<br>${badge('verified')} Sirf licensed payment provider ke webhook se (abhi band, Phase 2)</div></div>
  <button class="dang full" onclick="logout()">Logout</button><p class="mu" style="text-align:center">MERA PAISA AI · Phase 1 · v1.0</p>`;
}
function setLang(l) { S.lang = localStorage.mp_lang = l; render(); }
function setTheme(x) { S.theme = localStorage.mp_theme = x; document.documentElement.classList.toggle('dark', x === 'dark'); render(); }
async function addCat() { const n = $('#nc').value.trim(); if (!n) return; await api('/categories', { body: { name: n } }); S.cats = []; render(); }
function restore(file) { if (!file || !confirm('Abhi ka sara data backup se badal jayega. Pakka?')) return; file.text().then(tx => api('/restore', { body: JSON.parse(tx) })).then(r => { toast(`Restore ho gaya: ${r.txns} entries`); render(); }).catch(e => toast(e.message)); }
async function changePin() { const old = prompt('Purana PIN'); if (!old) return; const pin = prompt('Naya PIN (4-6 ank)'); if (!pin) return; try { await api('/auth/change-pin', { body: { old, pin } }); toast('PIN badal gaya'); } catch (e) { toast(e.message); } }
async function showAudit() { const a = await api('/audit'); sheet(`<h2>🧾 Audit log <button class="sm sec" onclick="closeSheet()">✕</button></h2>${a.map(x => `<div class="tx"><div class="mid"><div class="nm">${esc(x.action)}</div><div class="mu">${fmtTs(x.ts)}</div></div></div>`).join('')}`); }
async function logout() { try { await api('/auth/logout', { body: {} }); } catch { } S.token = ''; localStorage.removeItem('mp_token'); render(); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
render(); syncQueue();
