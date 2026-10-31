// Asia/Kolkata helpers (IST = UTC+5:30, no DST)
const OFF = 330 * 60000;
function istParts(d = new Date()) {
  const t = new Date(d.getTime() + OFF);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds() };
}
const p2 = n => String(n).padStart(2, '0');
function istISO(d = new Date()) {
  const p = istParts(d);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.hh)}:${p2(p.mm)}:${p2(p.ss)}+05:30`;
}
function istDate(d = new Date()) { return istISO(d).slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
module.exports = { istISO, istDate, istParts, addDays };
