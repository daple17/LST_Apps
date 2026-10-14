// Test integrasi: jalankan aplikasi sungguhan (createApp) di port acak dengan DB test, panggil lewat HTTP.
const http = require('node:http');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const cfg = require('../config');
const { migrate } = require('../lib/migrate');
const { createApp, seedMaster } = require('../server');
const { freshDb } = require('./helpers');

async function startApp(dbName) {
  const pool = await freshDb(dbName);
  await migrate(pool); await seedMaster(pool);
  const server = http.createServer(createApp(pool));
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const [[u]] = await pool.query("SELECT id,name FROM users WHERE username='admin'");
  const token = jwt.sign({ id: u.id, name: u.name }, cfg.secret);
  async function call(method, url, body) {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body) });
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  async function raw(url) { const r = await fetch(base + url, { headers: { Authorization: 'Bearer ' + token } }); return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; }
  return { pool, call, raw, get: u => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: u => call('DELETE', u),
    close: async () => { await new Promise(r => server.close(r)); await pool.end(); } };
}
// JO Trucking minimal yang valid
const joBody = (extra = {}) => ({ type: 'TRUCKING', customer_id: 1, jenis_muatan: 'FCL', delivery_plan: '2026-12-01', ...extra });
module.exports = { startApp, joBody };
