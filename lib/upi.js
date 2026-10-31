// UPI deep-link build / parse / validate (NPCI upi://pay format)
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/;
function validVpa(v) { return VPA_RE.test(String(v || '').trim()); }
function buildUpiUri({ vpa, name, amount, note, ref }) {
  if (!validVpa(vpa)) throw new Error('UPI ID galat hai (jaise naam@okaxis)');
  const q = [['pa', vpa.trim()], ['pn', (name || '').trim()]];
  if (amount != null && amount !== '') {
    const a = Number(amount);
    if (!(a > 0) || a > 100000) throw new Error('Amount 1 se 1,00,000 ke beech ho');
    q.push(['am', a.toFixed(2)]);
  }
  q.push(['cu', 'INR']);
  if (note) q.push(['tn', String(note).slice(0, 80)]);
  if (ref) q.push(['tr', String(ref).slice(0, 35)]);
  return 'upi://pay?' + q.filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
function parseUpiUri(s) {
  const str = String(s || '').trim();
  const m = /^upi:\/\/pay\?(.*)$/i.exec(str);
  if (!m) return { ok: false, error: 'Ye UPI QR nahi lagta (upi://pay nahi mila)' };
  const params = {};
  for (const kv of m[1].split('&')) { const i = kv.indexOf('='); if (i < 0) continue; try { params[kv.slice(0, i).toLowerCase()] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch { params[kv.slice(0, i).toLowerCase()] = kv.slice(i + 1); } }
  if (!validVpa(params.pa)) return { ok: false, error: 'QR mein valid UPI ID (pa) nahi hai', params };
  return { ok: true, vpa: params.pa, name: params.pn || '', amount: params.am ? Number(params.am) : null, note: params.tn || '', merchant: !!params.mc && params.mc !== '0000', params };
}
module.exports = { validVpa, buildUpiUri, parseUpiUri };
