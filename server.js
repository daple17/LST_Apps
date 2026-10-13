const express = require('express'), mysql = require('mysql2/promise'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), fs = require('fs'), path = require('path');
const cfg = require('./config'), SECRET = cfg.secret;
const pool = mysql.createPool(cfg.db);
const UP = cfg.uploadDir; fs.mkdirSync(UP, { recursive: true });
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });

app.post('/api/login', wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT * FROM users WHERE username=?', [req.body.username]);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Username atau password salah' });
  res.json({ token: jwt.sign({ id: u.id, name: u.name }, SECRET, { expiresIn: '12h' }), name: u.name });
}));

app.use('/api', (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
});
app.use('/uploads', (req, res, next) => { // files need auth via ?t=
  try { jwt.verify(req.query.t, SECRET); next(); } catch { res.sendStatus(401); }
}, express.static(UP));

app.get('/api/lookups', wrap(async (req, res) => {
  const [customers] = await pool.query('SELECT id,code,name FROM customers ORDER BY name');
  const [shippers] = await pool.query('SELECT id,name FROM shippers ORDER BY name');
  const [vendors] = await pool.query('SELECT id,code,name FROM vendors ORDER BY code');
  const [[me]] = await pool.query('SELECT name,employee_no FROM users WHERE id=?', [req.user.id]);
  res.json({ customers, shippers, vendors, me });
}));

const F = ['type', 'customer_id', 'shipper_id', 'invoice_no', 'bl_no', 'si_po_no', 'aju_no', 'cargo_type', 'party', 'weight', 'vessel', 'eta', 'delivery_plan', 'remarks'];
const vals = b => [...F.map(k => b[k] === '' || b[k] === undefined ? null : b[k]), JSON.stringify(b.checklist || {})];
const BASE = `SELECT j.*, c.name customer_name, c.code customer_code, s.name shipper_name
  FROM job_orders j JOIN customers c ON c.id=j.customer_id LEFT JOIN shippers s ON s.id=j.shipper_id`;
const log = (jo_id, user, action, note = null) => pool.query('INSERT INTO jo_logs (jo_id,user_name,action,note) VALUES (?,?,?,?)', [jo_id, user, action, note]);
const bad = (res, m) => res.status(400).json({ error: m });

app.post('/api/customers', wrap(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase(), name = String(req.body.name || '').trim();
  if (!/^[A-Z0-9]{2,6}$/.test(code)) return bad(res, 'Kode customer 2-6 huruf/angka');
  if (!name) return bad(res, 'Nama wajib diisi');
  const [[dup]] = await pool.query('SELECT id FROM customers WHERE code=?', [code]);
  if (dup) return bad(res, 'Kode sudah dipakai');
  const [r] = await pool.query('INSERT INTO customers (code,name) VALUES (?,?)', [code, name]);
  res.json({ id: r.insertId });
}));
app.post('/api/shippers', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return bad(res, 'Nama wajib diisi');
  const [r] = await pool.query('INSERT INTO shippers (name) VALUES (?)', [name]);
  res.json({ id: r.insertId });
}));

function where(qs) {
  const { q = '', status = '', type = '', customer_id = '', from = '', to = '' } = qs, w = ['1=1'], p = [];
  if (q) { w.push('(j.jo_no LIKE ? OR c.name LIKE ? OR j.vessel LIKE ? OR j.bl_no LIKE ? OR j.aju_no LIKE ? OR j.invoice_no LIKE ?)'); p.push(...Array(6).fill(`%${q}%`)); }
  if (status) { w.push('j.status=?'); p.push(status); }
  if (type) { w.push('j.type=?'); p.push(type); }
  if (customer_id) { w.push('j.customer_id=?'); p.push(customer_id); }
  if (from) { w.push('j.eta>=?'); p.push(from); }
  if (to) { w.push('j.eta<=?'); p.push(to); }
  return [' WHERE ' + w.join(' AND '), p];
}
const SORT = { jo_no: 'j.jo_no', eta: 'j.eta', delivery_plan: 'j.delivery_plan', customer: 'c.name', created: 'j.id' };
const order = qs => `${SORT[qs.sort] || 'j.id'} ${qs.dir === 'asc' ? 'ASC' : 'DESC'}, j.id DESC`;

app.get('/api/job-orders', wrap(async (req, res) => {
  const page = Math.max(1, +req.query.page || 1), lim = 15, [cond, p] = where(req.query);
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM job_orders j JOIN customers c ON c.id=j.customer_id${cond}`, p);
  const [rows] = await pool.query(`${BASE}${cond} ORDER BY ${order(req.query)} LIMIT ? OFFSET ?`, [...p, lim, (page - 1) * lim]);
  res.json({ rows, total: n, pages: Math.ceil(n / lim) });
}));

app.get('/api/job-orders/summary', wrap(async (req, res) => {
  const [[s]] = await pool.query(`SELECT COUNT(*) total, SUM(status='NOT_COMP') open_jo, SUM(status='COMPLETE') done,
    SUM(status='NOT_COMP' AND eta BETWEEN CURDATE() AND CURDATE()+INTERVAL 7 DAY) eta_week,
    SUM(status='NOT_COMP' AND delivery_plan < CURDATE()) late FROM job_orders`);
  res.json(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v || 0])));
}));

app.get('/api/job-orders/export', wrap(async (req, res) => {
  const [cond, p] = where(req.query);
  const [rows] = await pool.query(`${BASE}${cond} ORDER BY ${order(req.query)}`, p);
  const cols = ['jo_no', 'type', 'customer_name', 'shipper_name', 'invoice_no', 'bl_no', 'si_po_no', 'aju_no', 'cargo_type', 'party', 'weight', 'vessel', 'eta', 'delivery_plan', 'status', 'remarks'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').send('﻿' + [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n'));
}));

app.get('/api/job-orders/:id', wrap(async (req, res) => {
  const [[jo]] = await pool.query(`${BASE} WHERE j.id=?`, [req.params.id]);
  if (!jo) return res.sendStatus(404);
  [jo.documents] = await pool.query('SELECT id,filename,path,category,created_at FROM jo_documents WHERE jo_id=? ORDER BY id', [jo.id]);
  [jo.logs] = await pool.query('SELECT user_name,action,note,created_at FROM jo_logs WHERE jo_id=? ORDER BY id DESC LIMIT 50', [jo.id]);
  res.json(jo);
}));

async function create(conn, b, user) {
  const [[c]] = await conn.query('SELECT code FROM customers WHERE id=?', [b.customer_id]);
  if (!c) throw new Error('Customer tidak ditemukan');
  const [[{ m }]] = await conn.query("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(jo_no,'-',1) AS UNSIGNED)),0) m FROM job_orders FOR UPDATE");
  const jo_no = `${String(+m + 1).padStart(4, '0')}-${c.code}`;
  const [r] = await conn.query(`INSERT INTO job_orders (jo_no,${F.join(',')},checklist,created_by) VALUES (?${',?'.repeat(F.length + 1)},?)`, [jo_no, ...vals(b), user.id]);
  return { id: r.insertId, jo_no };
}
async function createTx(b, user, note) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await create(conn, b, user);
    await conn.query('INSERT INTO jo_logs (jo_id,user_name,action,note) VALUES (?,?,?,?)', [r.id, user.name, 'Dibuat', note]);
    await conn.commit();
    return r;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

app.post('/api/job-orders', wrap(async (req, res) => {
  const b = req.body;
  if (!b.type || !b.customer_id) return bad(res, 'Type dan Customer wajib diisi');
  if (b.weight !== '' && b.weight != null && isNaN(b.weight)) return bad(res, 'Weight harus angka');
  res.json(await createTx(b, req.user));
}));

app.post('/api/job-orders/:id/duplicate', wrap(async (req, res) => {
  const [[o]] = await pool.query('SELECT * FROM job_orders WHERE id=?', [req.params.id]);
  if (!o) return res.sendStatus(404);
  res.json(await createTx({ ...o, checklist: {}, invoice_no: null, bl_no: null, aju_no: null, eta: null, delivery_plan: null }, req.user, `Duplikat dari ${o.jo_no}`));
}));

app.put('/api/job-orders/:id', wrap(async (req, res) => {
  const b = req.body;
  if (!b.type) return bad(res, 'Type wajib diisi');
  if (b.weight !== '' && b.weight != null && isNaN(b.weight)) return bad(res, 'Weight harus angka');
  const [r] = await pool.query(`UPDATE job_orders SET ${F.filter(k => k !== 'customer_id').map(k => k + '=?').join(',')},checklist=? WHERE id=? AND status='NOT_COMP'`,
    [...vals(b).filter((_, i) => F[i] !== 'customer_id'), req.params.id]);
  if (!r.affectedRows) return res.status(409).json({ error: 'JO sudah Complete, tidak bisa diubah' });
  await log(req.params.id, req.user.name, 'Diedit');
  res.json({ ok: true });
}));

app.patch('/api/job-orders/:id/status', wrap(async (req, res) => {
  if (!['NOT_COMP', 'COMPLETE'].includes(req.body.status)) return res.sendStatus(400);
  await pool.query('UPDATE job_orders SET status=? WHERE id=?', [req.body.status, req.params.id]);
  await log(req.params.id, req.user.name, req.body.status === 'COMPLETE' ? 'Ditandai Complete' : 'Dibuka kembali');
  res.json({ ok: true });
}));

app.delete('/api/job-orders/:id', wrap(async (req, res) => {
  const [docs] = await pool.query('SELECT path FROM jo_documents WHERE jo_id=?', [req.params.id]);
  const [r] = await pool.query("DELETE FROM job_orders WHERE id=? AND status='NOT_COMP'", [req.params.id]);
  if (!r.affectedRows) return res.status(409).json({ error: 'JO sudah Complete, tidak bisa dihapus' });
  docs.forEach(d => fs.rmSync(path.join(UP, d.path), { force: true }));
  res.json({ ok: true });
}));

// body: {filename, data: base64, category}
app.post('/api/job-orders/:id/documents', wrap(async (req, res) => {
  const { filename, data, category = 'Lainnya' } = req.body;
  if (!filename || !data) return res.sendStatus(400);
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 10 * 1024 * 1024) return bad(res, 'Ukuran file maks 10 MB');
  const safe = `${Date.now()}-${path.basename(filename).replace(/[^\w.-]/g, '_')}`;
  fs.writeFileSync(path.join(UP, safe), buf);
  await pool.query('INSERT INTO jo_documents (jo_id,filename,path,category) VALUES (?,?,?,?)', [req.params.id, filename, safe, category]);
  await log(req.params.id, req.user.name, 'Upload dokumen', `${category}: ${filename}`);
  res.json({ ok: true });
}));

app.delete('/api/documents/:id', wrap(async (req, res) => {
  const [[d]] = await pool.query('SELECT path,jo_id,filename FROM jo_documents WHERE id=?', [req.params.id]);
  if (d) {
    fs.rmSync(path.join(UP, d.path), { force: true });
    await pool.query('DELETE FROM jo_documents WHERE id=?', [req.params.id]);
    await log(d.jo_id, req.user.name, 'Hapus dokumen', d.filename);
  }
  res.json({ ok: true });
}));

require('./ho')({ app, pool, wrap, bad, UP, fs, path });

async function init() {
  for (let i = 0; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) { if (i > 30) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  for (const [col, def] of [['pic_code', 'VARCHAR(4)'], ['employee_no', 'VARCHAR(20)']]) {
    const [x] = await pool.query('SHOW COLUMNS FROM users LIKE ?', [col]);
    if (!x.length) await pool.query(`ALTER TABLE users ADD COLUMN ${col} ${def} NULL`);
  }
  await pool.query("UPDATE users SET pic_code='AD', employee_no='2022010001' WHERE username='admin' AND pic_code IS NULL");
  const [[{ nv }]] = await pool.query('SELECT COUNT(*) nv FROM vendors');
  if (!nv) await pool.query('INSERT INTO vendors (code,name) VALUES ?', [[['LST', 'PT LIMA SARANA TRANS'], ['MJL', 'MJL TRANS'], ['DMS', 'DMS LOGISTIK'], ['HAJ W', 'HAJ WIJAYA'], ['HAJ S', 'HAJ SENTOSA']]]);
  const [cc] = await pool.query("SHOW COLUMNS FROM jo_documents LIKE 'category'");
  if (!cc.length) await pool.query("ALTER TABLE jo_documents ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'Lainnya'");
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM users');
  if (!n) {
    if (!cfg.adminPassword) throw new Error('ADMIN_PASSWORD wajib diisi untuk membuat user admin pertama');
    await pool.query('INSERT INTO users (username,password,name) VALUES (?,?,?)', ['admin', bcrypt.hashSync(cfg.adminPassword, 10), 'Administrator']);
    await pool.query('INSERT INTO customers (code,name) VALUES ?', [[['USC', 'PT UNITED STEEL SERVICE INDONESIA'], ['BTU', 'PT BERKAH TRANS UTAMA'], ['POS', 'PT POSCO INDONESIA JAKARTA PROCESSING CENTER'], ['NIJ', 'PT NIPRO INDONESIA JAYA'], ['PJM', 'PT PANATA JAYA MANDIRI']]]);
    await pool.query('INSERT INTO shippers (name) VALUES ?', [[['POSCO CORPORATION'], ['SHANGHAI STEEL CO'], ['EVERGREEN SHIPPING']]]);
  }
  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => console.log('LESAT di http://localhost:' + PORT));
}
init().catch(e => { console.error(e); process.exit(1); });
