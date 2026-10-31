const express = require('express');
const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { openDb } = require('./db');
const { parse, CATS } = require('./parser');
const { istISO, istDate, addDays } = require('./time');
const { validVpa, buildUpiUri, parseUpiUri } = require('./upi');
const { getProvider } = require('./provider');

const P = r => Math.round(Number(r) * 100); // rupees -> paise
const R = p => p / 100;
const DEFAULT_CATS = ['Vegetables','Fruits','Groceries','Milk','Electricity','Rent','Petrol','Transport','Medical','Shopping','Food','Bills','Subscriptions','Salary','Income','Other'];

function createApp(dbFile) {
  const db = openDb(dbFile);
  const q = (sql) => db.prepare(sql);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); next(); });
  // raw body for webhook signature
  app.use('/api/provider', express.raw({ type: '*/*', limit: '200kb' }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));

  const audit = (uid, action, detail) => q('INSERT INTO audit(user_id,action,detail,ts) VALUES(?,?,?,?)').run(uid, action, JSON.stringify(detail ?? null), istISO());
  const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const err = (res, code, msg) => res.status(code).json({ error: msg });

  // ---------- auth ----------
  app.get('/api/auth/status', (req, res) => res.json({ setup: !!q('SELECT id FROM users LIMIT 1').get() }));
  app.post('/api/auth/setup', (req, res) => {
    if (q('SELECT id FROM users LIMIT 1').get()) return err(res, 400, 'Account pehle se bana hai');
    const { name, pin } = req.body || {};
    if (!/^\d{4,6}$/.test(String(pin || ''))) return err(res, 400, 'PIN 4-6 ank ka ho');
    const salt = crypto.randomBytes(16).toString('hex');
    const r = q('INSERT INTO users(name,pin_hash,salt,created) VALUES(?,?,?,?)').run(String(name || 'User').slice(0, 40), hash(pin, salt), salt, istISO());
    const uid = Number(r.lastInsertRowid);
    for (const c of DEFAULT_CATS) q('INSERT OR IGNORE INTO categories(user_id,name) VALUES(?,?)').run(uid, c);
    audit(uid, 'setup', { name });
    const token = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO sessions VALUES(?,?,?)').run(token, uid, Date.now());
    res.json({ token });
  });
  app.post('/api/auth/login', (req, res) => {
    const u = q('SELECT * FROM users LIMIT 1').get();
    if (!u) return err(res, 400, 'Pehle account banayein');
    if (u.locked_until > Date.now()) return err(res, 429, 'Bahut galat PIN. 5 minute baad try karein');
    const ok = crypto.timingSafeEqual(Buffer.from(hash(req.body?.pin ?? '', u.salt), 'hex'), Buffer.from(u.pin_hash, 'hex'));
    if (!ok) {
      const f = u.fails + 1;
      q('UPDATE users SET fails=?, locked_until=? WHERE id=?').run(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 300000 : 0, u.id);
      audit(u.id, 'login_fail', null);
      return err(res, 401, 'PIN galat hai');
    }
    q('UPDATE users SET fails=0 WHERE id=?').run(u.id);
    const token = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO sessions VALUES(?,?,?)').run(token, u.id, Date.now());
    audit(u.id, 'login', null);
    res.json({ token });
  });
  const auth = (req, res, next) => {
    const t = (req.get('authorization') || '').replace(/^Bearer /, '');
    const s = t && q('SELECT * FROM sessions WHERE token=?').get(t);
    if (!s || Date.now() - s.created > 30 * 86400000) return err(res, 401, 'Login karein');
    req.user = q('SELECT id,name,role FROM users WHERE id=?').get(s.user_id);
    req.token = t; next();
  };
  app.post('/api/auth/logout', auth, (req, res) => { q('DELETE FROM sessions WHERE token=?').run(req.token); res.json({ ok: true }); });
  app.post('/api/auth/change-pin', auth, (req, res) => {
    const u = q('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (hash(req.body.old ?? '', u.salt) !== u.pin_hash) return err(res, 401, 'Purana PIN galat');
    if (!/^\d{4,6}$/.test(String(req.body.pin || ''))) return err(res, 400, 'PIN 4-6 ank ka ho');
    q('UPDATE users SET pin_hash=? WHERE id=?').run(hash(req.body.pin, u.salt), u.id);
    audit(u.id, 'change_pin', null); res.json({ ok: true });
  });

  // ---------- parser ----------
  app.post('/api/parse', auth, (req, res) => res.json({ entries: parse(req.body?.text || '') }));

  // ---------- transactions ----------
  const txOut = t => ({ ...t, amount: R(t.amount) });
  function insertTx(uid, b, source = 'manual-entry') {
    const amount = P(b.amount);
    if (!(amount > 0)) throw new Error('Amount sahi daalein');
    if (!['income', 'expense'].includes(b.type)) throw new Error('Type galat');
    let status = b.status || 'demo';
    if (status === 'verified' && source !== 'provider-live') status = 'demo'; // only live provider may verify
    if (!['demo', 'pending', 'manual', 'verified'].includes(status)) status = 'demo';
    if (b.client_id) { const ex = q('SELECT * FROM txns WHERE user_id=? AND client_id=?').get(uid, b.client_id); if (ex) return { tx: ex, duplicate: true }; }
    const now = istISO();
    const r = q('INSERT INTO txns(user_id,type,item,amount,category,method,status,ts,note,source,upi_ref,client_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(uid, b.type, String(b.item || '').slice(0, 80) || (b.type === 'income' ? 'Income' : 'Kharcha'), amount, b.category || 'Other', b.method || 'Cash', status, b.ts || now, b.note || null, source, b.upi_ref || null, b.client_id || null, now, now);
    const tx = q('SELECT * FROM txns WHERE id=?').get(r.lastInsertRowid);
    audit(uid, 'txn_add', { id: tx.id, amount: b.amount, type: b.type, source });
    return { tx, duplicate: false };
  }
  app.post('/api/transactions', auth, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : [req.body];
    try {
      db.exec('BEGIN');
      const out = list.map(b => { const r = insertTx(req.user.id, b, b.source === 'offline-sync' ? 'offline-sync' : 'manual-entry'); return { ...txOut(r.tx), duplicate: r.duplicate }; });
      db.exec('COMMIT');
      res.json({ saved: out });
    } catch (e) { db.exec('ROLLBACK'); err(res, 400, e.message); }
  });
  app.get('/api/transactions', auth, (req, res) => {
    const { q: s, type, category, status, from, to, method } = req.query;
    let sql = 'SELECT * FROM txns WHERE user_id=? AND deleted=0'; const a = [req.user.id];
    if (s) { sql += ' AND (item LIKE ? OR note LIKE ? OR category LIKE ?)'; a.push(`%${s}%`, `%${s}%`, `%${s}%`); }
    if (type) { sql += ' AND type=?'; a.push(type); }
    if (category) { sql += ' AND category=?'; a.push(category); }
    if (status) { sql += ' AND status=?'; a.push(status); }
    if (method) { sql += ' AND method=?'; a.push(method); }
    if (from) { sql += ' AND substr(ts,1,10)>=?'; a.push(from); }
    if (to) { sql += ' AND substr(ts,1,10)<=?'; a.push(to); }
    sql += ' ORDER BY ts DESC, id DESC LIMIT ' + Math.min(Number(req.query.limit) || 500, 5000);
    res.json(q(sql).all(...a).map(txOut));
  });
  app.put('/api/transactions/:id', auth, (req, res) => {
    const t = q('SELECT * FROM txns WHERE id=? AND user_id=? AND deleted=0').get(req.params.id, req.user.id);
    if (!t) return err(res, 404, 'Nahi mila');
    if (t.status === 'verified') return err(res, 400, 'Verified entry badal nahi sakte');
    const b = req.body; const amount = b.amount != null ? P(b.amount) : t.amount;
    if (!(amount > 0)) return err(res, 400, 'Amount sahi daalein');
    q('UPDATE txns SET type=?,item=?,amount=?,category=?,method=?,ts=?,note=?,updated=? WHERE id=?').run(
      ['income', 'expense'].includes(b.type) ? b.type : t.type, b.item ?? t.item, amount, b.category ?? t.category, b.method ?? t.method, b.ts ?? t.ts, b.note ?? t.note, istISO(), t.id);
    audit(req.user.id, 'txn_edit', { id: t.id, before: txOut(t) });
    res.json(txOut(q('SELECT * FROM txns WHERE id=?').get(t.id)));
  });
  app.delete('/api/transactions/:id', auth, (req, res) => {
    const t = q('SELECT * FROM txns WHERE id=? AND user_id=? AND deleted=0').get(req.params.id, req.user.id);
    if (!t) return err(res, 404, 'Nahi mila');
    q('UPDATE txns SET deleted=1, updated=? WHERE id=?').run(istISO(), t.id);
    audit(req.user.id, 'txn_delete', txOut(t)); res.json({ ok: true });
  });

  // ---------- summary / ledger ----------
  function ledger(uid) {
    // counted: demo + manually confirmed + verified ; pending never counted
    const r = q(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) bal FROM txns WHERE user_id=? AND deleted=0 AND status IN('demo','manual','verified')`).get(uid);
    return R(r.bal);
  }
  function sums(uid, from, to) {
    const r = q(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) exp FROM txns WHERE user_id=? AND deleted=0 AND status!='pending' AND substr(ts,1,10) BETWEEN ? AND ?`).get(uid, from, to);
    return { income: R(r.inc), expense: R(r.exp) };
  }
  function weekStart(d) { const day = new Date(d + 'T00:00:00Z').getUTCDay(); return istDate(addDays(new Date(d + 'T12:00:00+05:30'), -((day + 6) % 7))); }
  function budgetStatus(uid) {
    const today = istDate();
    const ranges = { daily: [today, today], weekly: [weekStart(today), today], monthly: [today.slice(0, 8) + '01', today] };
    return q('SELECT * FROM budgets WHERE user_id=?').all(uid).map(b => {
      const [f, t] = ranges[b.period];
      const s = q(`SELECT COALESCE(SUM(amount),0) s FROM txns WHERE user_id=? AND deleted=0 AND status!='pending' AND type='expense' AND substr(ts,1,10) BETWEEN ? AND ?` + (b.category ? ' AND category=?' : '')).get(...[uid, f, t].concat(b.category ? [b.category] : [])).s;
      const pct = b.amount ? Math.round(s / b.amount * 100) : 0;
      return { id: b.id, period: b.period, category: b.category, limit: R(b.amount), spent: R(s), pct, level: pct >= 100 ? 100 : pct >= 90 ? 90 : pct >= 80 ? 80 : 0 };
    });
  }
  function insights(uid) {
    const out = []; const today = istDate();
    const m0 = today.slice(0, 8) + '01';
    const cats = q(`SELECT category, SUM(amount) s FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending' AND substr(ts,1,10)>=? GROUP BY category ORDER BY s DESC`).all(uid, m0);
    const tot = cats.reduce((a, c) => a + c.s, 0);
    if (tot) out.push({ icon: '📊', en: `Most spending this month: ${cats[0].category} (${Math.round(cats[0].s / tot * 100)}%)`, hi: `Is mahine sabse zyada kharcha: ${cats[0].category} (${Math.round(cats[0].s / tot * 100)}%)` });
    const d30 = istDate(addDays(new Date(), -29));
    const days = q(`SELECT COUNT(DISTINCT substr(ts,1,10)) d, COALESCE(SUM(amount),0) s FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending' AND substr(ts,1,10)>=?`).get(uid, d30);
    if (days.d >= 2) out.push({ icon: '📅', en: `Average daily spend (days with spending, last 30 days): ₹${Math.round(R(days.s) / days.d)}`, hi: `Pichhle 30 din ka ausat roz ka kharcha (jin dino kharcha hua): ₹${Math.round(R(days.s) / days.d)}` });
    const avg = q(`SELECT AVG(amount) a, COUNT(*) n FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending'`).get(uid);
    if (avg.n >= 5) { const big = q(`SELECT * FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending' AND amount>? AND substr(ts,1,10)>=? ORDER BY amount DESC LIMIT 1`).get(uid, avg.a * 3, d30); if (big) out.push({ icon: '⚠️', en: `Unusual expense: ${big.item} ₹${R(big.amount)} (3x your average)`, hi: `Asaamanya kharcha: ${big.item} ₹${R(big.amount)} (aapke ausat se 3 guna)` }); }
    const rep = q(`SELECT lower(item) it, COUNT(*) n, SUM(amount) s FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending' AND substr(ts,1,10)>=? GROUP BY lower(item) HAVING n>=3 ORDER BY n DESC LIMIT 1`).get(uid, d30);
    if (rep) out.push({ icon: '🔁', en: `Repeated purchase: ${rep.it} ${rep.n} times (₹${R(rep.s)}) in 30 days`, hi: `Baar-baar kharid: ${rep.it} ${rep.n} baar (₹${R(rep.s)}) 30 din mein` });
    // vegetable price change: compare last two entries of same item (amount only — quantity not tracked)
    const veg = q(`SELECT lower(item) it, amount, ts FROM txns WHERE user_id=? AND deleted=0 AND category IN('Vegetables','Fruits','Milk') AND type='expense' ORDER BY ts DESC`).all(uid);
    const seen = {}; for (const v of veg) { (seen[v.it] ||= []).push(v.amount); }
    for (const [it, arr] of Object.entries(seen)) if (arr.length >= 2 && arr[0] !== arr[1]) { const ch = Math.round((arr[0] - arr[1]) / arr[1] * 100); if (Math.abs(ch) >= 15) { out.push({ icon: ch > 0 ? '📈' : '📉', en: `${it}: last purchase ${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}% vs previous (amount, not per-kg)`, hi: `${it}: pichhli khareed se ${Math.abs(ch)}% ${ch > 0 ? 'zyada' : 'kam'} kharcha (amount, per-kg nahi)` }); break; } }
    const m = sums(uid, m0, today);
    if (m.income > 0) { const rate = Math.round((m.income - m.expense) / m.income * 100); out.push({ icon: rate >= 20 ? '✅' : '💡', en: rate >= 20 ? `Savings rate this month: ${rate}% — good` : `Savings rate this month: ${rate}%. Try saving at least 20% of income.`, hi: rate >= 20 ? `Is mahine bachat: ${rate}% — badhiya` : `Is mahine bachat: ${rate}%. Kam se kam 20% bachane ki koshish karein.` }); }
    for (const b of budgetStatus(uid)) if (b.level) out.push({ icon: '🚨', en: `${b.period} budget${b.category ? ' (' + b.category + ')' : ''}: ${b.pct}% used`, hi: `${b.period} budget${b.category ? ' (' + b.category + ')' : ''}: ${b.pct}% use ho gaya` });
    if (!out.length) out.push({ icon: '👋', en: 'Add a few entries to see insights', hi: 'Kuch entries daalein, fir insights dikhenge' });
    return out;
  }
  app.get('/api/summary', auth, (req, res) => {
    const uid = req.user.id; const today = istDate(); const m0 = today.slice(0, 8) + '01';
    const t = sums(uid, today, today); const m = sums(uid, m0, today);
    const pending = q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM pay_requests WHERE user_id=? AND status='pending'`).get(uid);
    const flows = q(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) inc, COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) exp FROM txns WHERE user_id=? AND deleted=0 AND status!='pending'`).get(uid);
    res.json({
      user: req.user, now: istISO(), mode: 'sandbox',
      bank: { linked: false, balance: null, lastSync: null, message: 'Bank link nahi hai (Phase 3: Account Aggregator)' },
      ledgerBalance: ledger(uid), today: t, month: { ...m, net: Math.round((m.income - m.expense) * 100) / 100 },
      totals: { received: R(flows.inc), sent: R(flows.exp) },
      pendingRequests: { count: pending.n, amount: R(pending.s) },
      recent: q('SELECT * FROM txns WHERE user_id=? AND deleted=0 ORDER BY ts DESC, id DESC LIMIT 6').all(uid).map(txOut),
      bills: q('SELECT * FROM bills WHERE user_id=? AND paid=0 ORDER BY due LIMIT 5').all(uid).map(b => ({ ...b, amount: R(b.amount) })),
      budgets: budgetStatus(uid), insights: insights(uid),
      byCategory: q(`SELECT category, SUM(amount)/100.0 s FROM txns WHERE user_id=? AND deleted=0 AND type='expense' AND status!='pending' AND substr(ts,1,10)>=? GROUP BY category ORDER BY s DESC`).all(uid, m0),
    });
  });

  // ---------- categories / budgets / bills ----------
  app.get('/api/categories', auth, (req, res) => res.json(q('SELECT name FROM categories WHERE user_id=? ORDER BY id').all(req.user.id).map(r => r.name)));
  app.post('/api/categories', auth, (req, res) => { const n = String(req.body.name || '').trim().slice(0, 30); if (!n) return err(res, 400, 'Naam daalein'); q('INSERT OR IGNORE INTO categories(user_id,name) VALUES(?,?)').run(req.user.id, n); audit(req.user.id, 'cat_add', n); res.json({ ok: true }); });
  app.delete('/api/categories/:name', auth, (req, res) => { q('DELETE FROM categories WHERE user_id=? AND name=?').run(req.user.id, req.params.name); res.json({ ok: true }); });
  app.get('/api/budgets', auth, (req, res) => res.json(budgetStatus(req.user.id)));
  app.post('/api/budgets', auth, (req, res) => {
    const { period, category, amount } = req.body;
    if (!['daily', 'weekly', 'monthly'].includes(period) || !(P(amount) > 0)) return err(res, 400, 'Budget sahi daalein');
    q('INSERT INTO budgets(user_id,period,category,amount) VALUES(?,?,?,?) ON CONFLICT(user_id,period,category) DO UPDATE SET amount=excluded.amount').run(req.user.id, period, category || null, P(amount));
    audit(req.user.id, 'budget_set', req.body); res.json(budgetStatus(req.user.id));
  });
  app.delete('/api/budgets/:id', auth, (req, res) => { q('DELETE FROM budgets WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });
  app.get('/api/bills', auth, (req, res) => res.json(q('SELECT * FROM bills WHERE user_id=? ORDER BY paid, due').all(req.user.id).map(b => ({ ...b, amount: R(b.amount) }))));
  app.post('/api/bills', auth, (req, res) => { const { name, amount, due } = req.body; if (!name || !(P(amount) > 0) || !/^\d{4}-\d\d-\d\d$/.test(due || '')) return err(res, 400, 'Bill ki jaankari poori daalein'); q('INSERT INTO bills(user_id,name,amount,due) VALUES(?,?,?,?)').run(req.user.id, name, P(amount), due); audit(req.user.id, 'bill_add', req.body); res.json({ ok: true }); });
  app.post('/api/bills/:id/pay', auth, (req, res) => {
    const b = q('SELECT * FROM bills WHERE id=? AND user_id=? AND paid=0').get(req.params.id, req.user.id); if (!b) return err(res, 404, 'Nahi mila');
    q('UPDATE bills SET paid=1 WHERE id=?').run(b.id);
    insertTx(req.user.id, { type: 'expense', item: b.name, amount: R(b.amount), category: 'Bills', method: req.body.method || 'UPI' }, 'bill');
    res.json({ ok: true });
  });
  app.delete('/api/bills/:id', auth, (req, res) => { q('DELETE FROM bills WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

  // ---------- khata ----------
  function personBalance(pid) {
    const r = q(`SELECT COALESCE(SUM(CASE kind WHEN 'lent' THEN amount WHEN 'paid_back' THEN amount WHEN 'borrowed' THEN -amount WHEN 'got_back' THEN -amount END),0) b FROM khata WHERE person_id=?`).get(pid);
    return R(r.b); // + => person owes me ; - => I owe person
  }
  app.get('/api/khata', auth, (req, res) => {
    const people = q('SELECT * FROM people WHERE user_id=? ORDER BY name').all(req.user.id).map(p => ({ ...p, balance: personBalance(p.id), last: q('SELECT ts FROM khata WHERE person_id=? ORDER BY ts DESC LIMIT 1').get(p.id)?.ts || null }));
    res.json({ people, toGet: people.filter(p => p.balance > 0).reduce((a, p) => a + p.balance, 0), toGive: -people.filter(p => p.balance < 0).reduce((a, p) => a + p.balance, 0) });
  });
  app.post('/api/khata/people', auth, (req, res) => { const n = String(req.body.name || '').trim().slice(0, 40); if (!n) return err(res, 400, 'Naam daalein'); q('INSERT OR IGNORE INTO people(user_id,name,phone) VALUES(?,?,?)').run(req.user.id, n, req.body.phone || null); res.json(q('SELECT * FROM people WHERE user_id=? AND name=?').get(req.user.id, n)); });
  app.get('/api/khata/people/:id', auth, (req, res) => { const p = q('SELECT * FROM people WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!p) return err(res, 404, 'Nahi mila'); res.json({ ...p, balance: personBalance(p.id), entries: q('SELECT * FROM khata WHERE person_id=? ORDER BY ts DESC, id DESC').all(p.id).map(e => ({ ...e, amount: R(e.amount) })) }); });
  app.delete('/api/khata/people/:id', auth, (req, res) => { q('DELETE FROM people WHERE id=? AND user_id=?').run(req.params.id, req.user.id); audit(req.user.id, 'person_delete', req.params.id); res.json({ ok: true }); });
  app.post('/api/khata/entries', auth, (req, res) => {
    const { person_id, kind, amount, note, due } = req.body;
    const p = q('SELECT * FROM people WHERE id=? AND user_id=?').get(person_id, req.user.id); if (!p) return err(res, 404, 'Vyakti nahi mila');
    if (!['lent', 'borrowed', 'got_back', 'paid_back'].includes(kind) || !(P(amount) > 0)) return err(res, 400, 'Entry sahi daalein');
    const bal = personBalance(p.id);
    if (kind === 'got_back' && P(amount) > P(bal)) return err(res, 400, `${p.name} par sirf ₹${Math.max(bal, 0)} baaki hai`);
    if (kind === 'paid_back' && P(amount) > P(-bal)) return err(res, 400, `Aap par sirf ₹${Math.max(-bal, 0)} baaki hai`);
    q('INSERT INTO khata(user_id,person_id,kind,amount,ts,note,due) VALUES(?,?,?,?,?,?,?)').run(req.user.id, p.id, kind, P(amount), istISO(), note || null, due || null);
    audit(req.user.id, 'khata_add', req.body);
    res.json({ balance: personBalance(p.id), settled: personBalance(p.id) === 0 });
  });

  // ---------- UPI / QR ----------
  app.get('/api/upi/profile', auth, (req, res) => res.json(q('SELECT * FROM upi_profile WHERE user_id=?').get(req.user.id) || null));
  app.post('/api/upi/profile', auth, (req, res) => {
    let { vpa, name, raw } = req.body; let source = 'manual';
    if (raw) { const p = parseUpiUri(raw); if (!p.ok) return err(res, 400, p.error); vpa = p.vpa; name = name || p.name; source = 'uploaded-qr'; }
    if (!validVpa(vpa)) return err(res, 400, 'UPI ID galat hai (jaise naam@okaxis)');
    q('INSERT INTO upi_profile VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET vpa=excluded.vpa,name=excluded.name,raw=excluded.raw,source=excluded.source,updated=excluded.updated').run(req.user.id, vpa.trim(), (name || '').trim(), raw || null, source, istISO());
    audit(req.user.id, 'upi_profile', { vpa, source });
    res.json(q('SELECT * FROM upi_profile WHERE user_id=?').get(req.user.id));
  });
  app.post('/api/upi/decode', auth, (req, res) => res.json(parseUpiUri(req.body.text)));
  app.post('/api/upi/link', auth, (req, res) => {
    const pr = q('SELECT * FROM upi_profile WHERE user_id=?').get(req.user.id);
    if (!pr) return err(res, 400, 'Pehle apni UPI ID / QR add karein');
    try { res.json({ uri: buildUpiUri({ vpa: pr.vpa, name: pr.name, amount: req.body.amount, note: req.body.note }) }); } catch (e) { err(res, 400, e.message); }
  });
  app.get('/api/qr.svg', auth, async (req, res) => {
    const data = String(req.query.data || ''); if (!data || data.length > 1000) return err(res, 400, 'data?');
    res.type('image/svg+xml').send(await QRCode.toString(data, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 600 }));
  });
  app.get('/api/qr.png', auth, async (req, res) => {
    const data = String(req.query.data || ''); if (!data || data.length > 1000) return err(res, 400, 'data?');
    res.type('image/png').send(await QRCode.toBuffer(data, { errorCorrectionLevel: 'M', margin: 2, width: 800 }));
  });
  // payment requests (to user's real QR) -> pending until user confirms
  app.get('/api/pay-requests', auth, (req, res) => res.json(q('SELECT * FROM pay_requests WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id).map(r => ({ ...r, amount: R(r.amount) }))));
  app.post('/api/pay-requests', auth, (req, res) => {
    const pr = q('SELECT * FROM upi_profile WHERE user_id=?').get(req.user.id);
    if (!pr) return err(res, 400, 'Pehle apni UPI ID / QR add karein');
    const ref = 'MP' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
    let uri; try { uri = buildUpiUri({ vpa: pr.vpa, name: pr.name, amount: req.body.amount, note: req.body.note || 'Mera Paisa', ref }); } catch (e) { return err(res, 400, e.message); }
    const now = istISO();
    const r = q('INSERT INTO pay_requests(user_id,amount,note,payer,uri,ref,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user.id, P(req.body.amount), req.body.note || null, req.body.payer || null, uri, ref, 'pending', now, now);
    audit(req.user.id, 'payreq_create', { id: Number(r.lastInsertRowid), amount: req.body.amount });
    const x = q('SELECT * FROM pay_requests WHERE id=?').get(r.lastInsertRowid); res.json({ ...x, amount: R(x.amount) });
  });
  app.post('/api/pay-requests/:id/confirm', auth, (req, res) => {
    const r = q('SELECT * FROM pay_requests WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!r) return err(res, 404, 'Nahi mila');
    if (r.status !== 'pending') return err(res, 409, 'Ye request pehle hi ' + r.status + ' hai');
    const upiRef = req.body.upi_ref ? String(req.body.upi_ref).trim().slice(0, 40) : null;
    if (upiRef && q('SELECT id FROM txns WHERE user_id=? AND upi_ref=?').get(req.user.id, upiRef)) return err(res, 409, 'Ye UPI reference pehle se darj hai (duplicate)');
    db.exec('BEGIN');
    try {
      const { tx } = insertTx(req.user.id, { type: 'income', item: r.payer ? `QR se: ${r.payer}` : 'QR payment', amount: R(r.amount), category: 'Income', method: 'UPI', status: 'manual', note: (r.note || '') + ' [Manually confirmed — bank se check karein]', upi_ref: upiRef }, 'qr-manual-confirm');
      q("UPDATE pay_requests SET status='manual', txn_id=?, updated=? WHERE id=?").run(tx.id, istISO(), r.id);
      db.exec('COMMIT');
      audit(req.user.id, 'payreq_confirm', { id: r.id, upiRef });
      res.json({ ok: true, txn: txOut(tx) });
    } catch (e) { db.exec('ROLLBACK'); err(res, 400, e.message); }
  });
  app.post('/api/pay-requests/:id/cancel', auth, (req, res) => {
    const r = q("SELECT * FROM pay_requests WHERE id=? AND user_id=? AND status='pending'").get(req.params.id, req.user.id); if (!r) return err(res, 404, 'Pending request nahi mili');
    q("UPDATE pay_requests SET status='cancelled', updated=? WHERE id=?").run(istISO(), r.id); audit(req.user.id, 'payreq_cancel', r.id); res.json({ ok: true });
  });

  // ---------- provider webhook (sandbox only) ----------
  app.post('/api/provider/:name/webhook', (req, res) => {
    let prov; try { prov = getProvider(); } catch (e) { return err(res, 503, e.message); }
    if (req.params.name !== prov.name) return err(res, 404, 'Unknown provider');
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!prov.verifySignature(raw, req.get('x-signature'))) return err(res, 401, 'Bad signature');
    let ev; try { ev = prov.parseEvent(JSON.parse(raw)); } catch { return err(res, 400, 'Bad JSON'); }
    if (!ev.eventId) return err(res, 400, 'event id missing');
    const seen = q('SELECT * FROM provider_events WHERE provider=? AND event_id=?').get(prov.name, ev.eventId);
    if (seen) return res.json({ ok: true, duplicate: true, result: JSON.parse(seen.result) });
    const u = q('SELECT id FROM users LIMIT 1').get();
    let result = { action: 'ignored' };
    if (u && ev.type === 'payment.captured' && ev.amount > 0) {
      if (ev.upiRef && q('SELECT id FROM txns WHERE user_id=? AND upi_ref=?').get(u.id, ev.upiRef)) result = { action: 'duplicate-upi-ref' };
      else {
        // SANDBOX: recorded as 'demo' — never 'verified'. A live provider adapter would use status 'verified'.
        const { tx } = insertTx(u.id, { type: 'income', item: 'Sandbox payment' + (ev.payer ? ` (${ev.payer})` : ''), amount: ev.amount, category: 'Income', method: 'UPI', status: prov.live ? 'verified' : 'demo', upi_ref: ev.upiRef, note: 'Sandbox webhook — asli paisa nahi', client_id: 'prov:' + ev.eventId }, prov.live ? 'provider-live' : 'provider-sandbox');
        if (ev.requestId) q("UPDATE pay_requests SET status=?, txn_id=?, updated=? WHERE id=? AND status='pending'").run(prov.live ? 'verified' : 'pending', tx.id, istISO(), ev.requestId);
        result = { action: 'recorded', txn_id: tx.id, status: tx.status };
      }
    }
    q('INSERT INTO provider_events(provider,event_id,payload,result,created) VALUES(?,?,?,?,?)').run(prov.name, ev.eventId, raw, JSON.stringify(result), istISO());
    res.json({ ok: true, duplicate: false, result });
  });

  // ---------- export / backup ----------
  function rowsFor(req) { return q('SELECT * FROM txns WHERE user_id=? AND deleted=0 AND substr(ts,1,10) BETWEEN ? AND ? ORDER BY ts').all(req.user.id, req.query.from || '0000', req.query.to || '9999').map(txOut); }
  const statusLabel = s => ({ demo: 'Demo', pending: 'Pending', manual: 'Manually confirmed', verified: 'Verified' }[s] || s);
  app.get('/api/export.csv', auth, (req, res) => {
    const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Date', 'Time (IST)', 'Type', 'Item', 'Amount (INR)', 'Category', 'Method', 'Status', 'UPI Ref', 'Note'].join(',')];
    for (const t of rowsFor(req)) lines.push([t.ts.slice(0, 10), t.ts.slice(11, 16), t.type, t.item, t.amount.toFixed(2), t.category, t.method, statusLabel(t.status), t.upi_ref, t.note].map(esc).join(','));
    audit(req.user.id, 'export_csv', null);
    res.set('Content-Disposition', 'attachment; filename="mera-paisa.csv"').type('text/csv').send('\ufeff' + lines.join('\n'));
  });
  app.get('/api/export.pdf', auth, (req, res) => {
    const rows = rowsFor(req);
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.set('Content-Disposition', 'attachment; filename="mera-paisa.pdf"').type('application/pdf');
    doc.pipe(res); doc.registerFont('H', path.join(__dirname, '..', 'fonts', 'Hind-Regular.ttf')); doc.font('H');
    doc.fontSize(18).text('MERA PAISA AI — Report'); doc.fontSize(9).fillColor('#555').text(`Generated ${istISO().replace('T', ' ').slice(0, 16)} IST · Demo ledger (not a bank statement)`); doc.moveDown();
    let inc = 0, exp = 0; const cols = [36, 100, 150, 290, 370, 450];
    doc.fillColor('#000').fontSize(10); ['Date', 'Type', 'Item', 'Category', 'Amount ₹', 'Status'].forEach((h, i) => doc.text(h, cols[i], doc.y, { continued: false, lineBreak: false })); doc.moveDown();
    for (const t of rows) {
      if (doc.y > 780) doc.addPage();
      const y = doc.y; t.type === 'income' ? inc += t.amount : t.status !== 'pending' && (exp += t.amount);
      [t.ts.slice(0, 10), t.type, t.item.slice(0, 24), t.category, (t.type === 'income' ? '+' : '-') + t.amount.toFixed(2), statusLabel(t.status)].forEach((v, i) => doc.text(v, cols[i], y, { lineBreak: false, width: (cols[i + 1] || 560) - cols[i] - 4 }));
      doc.moveDown(0.6);
    }
    doc.moveDown().fontSize(12).text(`Income: ₹${inc.toFixed(2)}   Expense: ₹${exp.toFixed(2)}   Net: ₹${(inc - exp).toFixed(2)}`, 36);
    audit(req.user.id, 'export_pdf', null); doc.end();
  });
  const TABLES = ['txns', 'categories', 'budgets', 'bills', 'people', 'khata', 'upi_profile', 'pay_requests'];
  app.get('/api/backup', auth, (req, res) => {
    const data = { app: 'mera-paisa-ai', version: 1, created: istISO() };
    for (const t of TABLES) data[t] = q(`SELECT * FROM ${t} WHERE user_id=?`).all(req.user.id);
    audit(req.user.id, 'backup', null);
    res.set('Content-Disposition', `attachment; filename="mera-paisa-backup-${istDate()}.json"`).json(data);
  });
  app.post('/api/restore', auth, (req, res) => {
    const d = req.body; if (d?.app !== 'mera-paisa-ai') return err(res, 400, 'Ye Mera Paisa backup file nahi hai');
    db.exec('BEGIN');
    try {
      for (const t of [...TABLES].reverse()) q(`DELETE FROM ${t} WHERE user_id=?`).run(req.user.id);
      for (const t of TABLES) for (const row of d[t] || []) {
        const r = { ...row, user_id: req.user.id }; const keys = Object.keys(r);
        q(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map(k => r[k]));
      }
      db.exec('COMMIT'); audit(req.user.id, 'restore', { txns: (d.txns || []).length }); res.json({ ok: true, txns: (d.txns || []).length });
    } catch (e) { db.exec('ROLLBACK'); err(res, 400, 'Restore fail: ' + e.message); }
  });
  app.get('/api/audit', auth, (req, res) => res.json(q('SELECT * FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'sandbox', time: istISO() }));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  app.locals.db = db;
  return app;
}
module.exports = { createApp };
