const { DatabaseSync } = require('node:sqlite');
function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, pin_hash TEXT, salt TEXT, role TEXT DEFAULT 'owner', fails INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0, created TEXT);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created INTEGER);
  CREATE TABLE IF NOT EXISTS txns(id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT CHECK(type IN('income','expense')), item TEXT, amount INTEGER CHECK(amount>0), category TEXT, method TEXT, status TEXT CHECK(status IN('demo','pending','manual','verified')) DEFAULT 'demo', ts TEXT, note TEXT, source TEXT, upi_ref TEXT, client_id TEXT, deleted INTEGER DEFAULT 0, created TEXT, updated TEXT, UNIQUE(user_id,client_id));
  CREATE UNIQUE INDEX IF NOT EXISTS ux_upiref ON txns(user_id,upi_ref) WHERE upi_ref IS NOT NULL;
  CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, UNIQUE(user_id,name));
  CREATE TABLE IF NOT EXISTS budgets(id INTEGER PRIMARY KEY, user_id INTEGER, period TEXT CHECK(period IN('daily','weekly','monthly')), category TEXT, amount INTEGER, UNIQUE(user_id,period,category));
  CREATE TABLE IF NOT EXISTS bills(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, amount INTEGER, due TEXT, paid INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS people(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, phone TEXT, UNIQUE(user_id,name));
  CREATE TABLE IF NOT EXISTS khata(id INTEGER PRIMARY KEY, user_id INTEGER, person_id INTEGER REFERENCES people(id) ON DELETE CASCADE, kind TEXT CHECK(kind IN('lent','borrowed','got_back','paid_back')), amount INTEGER CHECK(amount>0), ts TEXT, note TEXT, due TEXT);
  CREATE TABLE IF NOT EXISTS upi_profile(user_id INTEGER PRIMARY KEY, vpa TEXT, name TEXT, raw TEXT, source TEXT, updated TEXT);
  CREATE TABLE IF NOT EXISTS pay_requests(id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER, note TEXT, payer TEXT, uri TEXT, ref TEXT, status TEXT CHECK(status IN('pending','manual','verified','cancelled')) DEFAULT 'pending', txn_id INTEGER, created TEXT, updated TEXT);
  CREATE TABLE IF NOT EXISTS provider_events(id INTEGER PRIMARY KEY, provider TEXT, event_id TEXT, payload TEXT, result TEXT, created TEXT, UNIQUE(provider,event_id));
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, ts TEXT);`);
  return db;
}
module.exports = { openDb };
