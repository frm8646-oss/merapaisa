const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const QRCode = require('qrcode'); const jsQR = require('jsqr');
const { parse } = require('../lib/parser');
const { buildUpiUri, parseUpiUri, validVpa } = require('../lib/upi');
const { createApp } = require('../lib/app');
const { SandboxProvider } = require('../lib/provider');

test('parser: multi-entry Hinglish', () => {
  const r = parse('Aaj 40 rupaye aloo liya aur 30 rupaye tamatar.');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(e => [e.item, e.amount, e.type, e.category]), [['aloo', 40, 'expense', 'Vegetables'], ['tamatar', 30, 'expense', 'Vegetables']]);
  assert.match(r[0].ts, /\+05:30$/);
});
test('parser: petrol expense', () => { const [e] = parse('500 rupaye petrol mein kharch hue.'); assert.equal(e.amount, 500); assert.equal(e.type, 'expense'); assert.equal(e.category, 'Petrol'); assert.equal(e.uncertain, false); });
test('parser: income', () => { const r = parse('Mujhe 1000 rupaye mile.'); assert.equal(r.length, 1); assert.equal(r[0].type, 'income'); assert.equal(r[0].amount, 1000); });
test('parser: devanagari, hazar, kal, upi, uncertain', () => {
  assert.equal(parse('आज 50 रुपये दूध लिया')[0].category, 'Milk');
  const r = parse('kal 2 hazar salary aayi, 60 ka doodh liya gpay se');
  assert.equal(r[0].amount, 2000); assert.equal(r[0].type, 'income'); assert.equal(r[1].method, 'UPI');
  assert.equal(parse('xyz 70')[0].uncertain, true);
  assert.equal(parse('koi amount nahi').length, 0);
});
test('upi: build/parse/validate', () => {
  const u = buildUpiUri({ vpa: 'fazlur@okaxis', name: 'Fazlur Rahman', amount: 250, note: 'Doodh' });
  assert.equal(u, 'upi://pay?pa=fazlur%40okaxis&pn=Fazlur%20Rahman&am=250.00&cu=INR&tn=Doodh');
  const p = parseUpiUri(u); assert.ok(p.ok); assert.equal(p.vpa, 'fazlur@okaxis'); assert.equal(p.amount, 250);
  assert.ok(!validVpa('abc')); assert.throws(() => buildUpiUri({ vpa: 'bad' }));
  assert.ok(!parseUpiUri('https://evil.com').ok);
});
test('QR: generate then decode round-trip (jsQR)', () => {
  const uri = buildUpiUri({ vpa: '9876543210@ybl', name: 'Mera Paisa', amount: 99.5 });
  const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' }); const n = qr.modules.size, sc = 6, m = 4, W = (n + 2 * m) * sc;
  const px = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((y + m) * sc + dy) * W + (x + m) * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  const d = jsQR(px, W, W); assert.ok(d); assert.equal(d.data, uri); assert.equal(parseUpiUri(d.data).vpa, '9876543210@ybl');
});

test('API: ledger, khata, pay-requests, webhook idempotency', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')); const app = createApp(path.join(dir, 't.db'));
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api`;
  let token = '';
  const call = async (p, body, method) => { const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }; };
  try {
    assert.equal((await call('/summary')).s, 401);
    token = (await call('/auth/setup', { name: 'Fazlur', pin: '1234' })).j.token; assert.ok(token);
    assert.equal((await call('/auth/login', { pin: '0000' })).s, 401);
    // ledger
    const ents = (await call('/parse', { text: 'Mujhe 1000 rupaye mile. Aaj 40 rupaye aloo liya aur 30 rupaye tamatar.' })).j.entries;
    assert.equal(ents.length, 3);
    const saved = (await call('/transactions', ents.map((e, i) => ({ ...e, client_id: 'c' + i })))).j.saved; assert.equal(saved.length, 3);
    const again = (await call('/transactions', ents.map((e, i) => ({ ...e, client_id: 'c' + i })))).j.saved; assert.ok(again.every(x => x.duplicate)); // offline-sync idempotent
    let s = (await call('/summary')).j; assert.equal(s.ledgerBalance, 930); assert.equal(s.bank.linked, false); assert.equal(s.bank.balance, null);
    assert.equal((await call('/transactions', { type: 'income', amount: 5, status: 'verified' })).j.saved[0].status, 'demo'); // cannot fake verified
    const tid = saved[1].id; await call('/transactions/' + tid, { amount: 50 }, 'PUT'); await call('/transactions/' + saved[2].id, null, 'DELETE');
    s = (await call('/summary')).j; assert.equal(s.ledgerBalance, 1000 + 5 - 50);
    // budget alert
    await call('/budgets', { period: 'daily', category: 'Vegetables', amount: 55 }); const b = (await call('/budgets')).j[0]; assert.equal(b.level, 90);
    // khata
    const p = (await call('/khata/people', { name: 'Ramesh' })).j;
    await call('/khata/entries', { person_id: p.id, kind: 'lent', amount: 500 });
    assert.equal((await call('/khata/entries', { person_id: p.id, kind: 'got_back', amount: 200 })).j.balance, 300);
    assert.equal((await call('/khata/entries', { person_id: p.id, kind: 'got_back', amount: 400 })).s, 400); // over-repay blocked
    assert.equal((await call('/khata/entries', { person_id: p.id, kind: 'got_back', amount: 300 })).j.settled, true);
    const q2 = (await call('/khata/people', { name: 'Shop' })).j; await call('/khata/entries', { person_id: q2.id, kind: 'borrowed', amount: 100 });
    const k = (await call('/khata')).j; assert.equal(k.toGive, 100); assert.equal(k.toGet, 0);
    // QR profile + pay request
    assert.equal((await call('/pay-requests', { amount: 10 })).s, 400);
    assert.equal((await call('/upi/profile', { raw: 'upi://pay?pa=fazlur@okaxis&pn=Fazlur' })).j.vpa, 'fazlur@okaxis');
    const pr = (await call('/pay-requests', { amount: 300, payer: 'Ramesh' })).j; assert.equal(pr.status, 'pending'); assert.match(pr.uri, /am=300\.00/);
    s = (await call('/summary')).j; const before = s.ledgerBalance; assert.equal(s.pendingRequests.amount, 300);
    const c = (await call(`/pay-requests/${pr.id}/confirm`, { upi_ref: '123456789012' })).j; assert.equal(c.txn.status, 'manual');
    assert.equal((await call(`/pay-requests/${pr.id}/confirm`, {})).s, 409);
    const pr2 = (await call('/pay-requests', { amount: 50 })).j; assert.equal((await call(`/pay-requests/${pr2.id}/confirm`, { upi_ref: '123456789012' })).s, 409); // dup UPI ref
    assert.equal((await call('/summary')).j.ledgerBalance, before + 300);
    assert.ok((await call('/qr.svg?data=' + encodeURIComponent(pr.uri))).j.includes('<svg'));
    // webhook
    const prov = new SandboxProvider('sandbox-dev-secret');
    const body = JSON.stringify({ id: 'evt_1', event: 'payment.captured', amount: 75, upi_ref: 'R999' });
    const hook = (b, sig) => fetch(base + '/provider/sandbox/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body: b }).then(async r => ({ s: r.status, j: await r.json() }));
    assert.equal((await hook(body, 'bad')).s, 401);
    const h1 = await hook(body, prov.sign(body)); assert.equal(h1.j.duplicate, false); assert.equal(h1.j.result.status, 'demo');
    const h2 = await hook(body, prov.sign(body)); assert.equal(h2.j.duplicate, true);
    const body2 = JSON.stringify({ id: 'evt_2', event: 'payment.captured', amount: 75, upi_ref: 'R999' });
    assert.equal((await hook(body2, prov.sign(body2))).j.result.action, 'duplicate-upi-ref');
    assert.equal((await call('/transactions?q=Sandbox')).j.length, 1);
    // export + backup/restore
    assert.match((await call('/export.csv')).j, /Manually confirmed/);
    const bk = (await call('/backup')).j; const n = bk.txns.length;
    await call('/transactions', { type: 'expense', amount: 1, item: 'x' });
    assert.equal((await call('/restore', bk)).j.txns, n);
    assert.equal((await call('/transactions')).j.length, n - 1 /* one soft-deleted */);
    assert.ok((await call('/audit')).j.length > 10);
  } finally { srv.close(); }
});
