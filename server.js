const express = require('express'), mysql = require('mysql2/promise'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), path = require('path');
const cfg = require('./config');
const rules = require('./lib/rules');
const { migrate } = require('./lib/migrate');
const { wrap, bad } = require('./lib/http');

// createApp(pool): aplikasi Express tanpa listen — dipakai server dan test integrasi
function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.get('/shared/code128.js', (req, res) => res.sendFile(path.join(__dirname, 'lib', 'code128.js'))); // satu berkas untuk server & browser
  app.use(express.static(path.join(__dirname, 'public')));

  app.post('/api/login', wrap(async (req, res) => {
    const [[u]] = await pool.query('SELECT * FROM users WHERE username=?', [req.body.username]);
    if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) return res.status(401).json({ error: 'Username atau password salah' });
    res.json({ token: jwt.sign({ id: u.id, name: u.name }, cfg.secret, { expiresIn: '12h' }), name: u.name });
  }));

  app.use('/api', (req, res, next) => {
    try { req.user = jwt.verify((req.headers.authorization || '').slice(7), cfg.secret); next(); }
    catch { res.status(401).json({ error: 'Unauthorized' }); }
  });
  app.use('/uploads', (req, res, next) => { // berkas butuh token lewat ?t=
    try { jwt.verify(req.query.t, cfg.secret); next(); } catch { res.sendStatus(401); }
  }, express.static(cfg.uploadDir));

  app.get('/api/lookups', wrap(async (req, res) => {
    const [customers] = await pool.query('SELECT id,code,name FROM customers ORDER BY name');
    const [shippers] = await pool.query('SELECT id,name FROM shippers ORDER BY name');
    const [vendors] = await pool.query('SELECT id,code,name FROM vendors ORDER BY code');
    const [[me]] = await pool.query('SELECT name,employee_no FROM users WHERE id=?', [req.user.id]);
    res.json({ customers, shippers, vendors, me, rules: rules.client });
  }));

  app.post('/api/customers', wrap(async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase(), name = String(req.body.name || '').trim();
    if (!/^[A-Z]{3}$/.test(code)) return bad(res, 'Kode customer harus 3 huruf');
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
  app.get('/api/vendors', wrap(async (req, res) => res.json((await pool.query('SELECT id,code,name FROM vendors ORDER BY code'))[0])));
  app.post('/api/vendors', wrap(async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase(), name = String(req.body.name || '').trim();
    if (!/^[A-Z0-9 ]{2,10}$/.test(code)) return bad(res, 'Kode vendor 2-10 huruf/angka');
    if (!name) return bad(res, 'Nama wajib diisi');
    const [[d]] = await pool.query('SELECT id FROM vendors WHERE code=?', [code]);
    if (d) return bad(res, 'Kode sudah dipakai');
    const [r] = await pool.query('INSERT INTO vendors (code,name) VALUES (?,?)', [code, name]);
    res.json({ id: r.insertId });
  }));

  const jo = require('./routes/job-orders'), handling = require('./routes/handling')(pool);
  app.use('/api/job-orders', require('./routes/jo-materials')(pool, { refreshTickets: handling.refreshForJo }));
  app.use('/api/job-orders', jo(pool));
  app.use('/api/documents', jo.documentsRouter(pool));
  app.use('/api/ho', handling);
  return app;
}

// data master awal (hanya jika kosong)
async function seedMaster(pool) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM users');
  if (!n) {
    if (!cfg.adminPassword) throw new Error('ADMIN_PASSWORD wajib diisi untuk membuat user admin pertama');
    await pool.query('INSERT INTO users (username,password,name,pic_code,employee_no) VALUES (?,?,?,?,?)', ['admin', bcrypt.hashSync(cfg.adminPassword, 10), 'Administrator', 'AD', '2022010001']);
  }
  const [[{ nc }]] = await pool.query('SELECT COUNT(*) nc FROM customers');
  if (!nc) {
    await pool.query('INSERT INTO customers (code,name) VALUES ?', [[['USC', 'PT UNITED STEEL SERVICE INDONESIA'], ['BTU', 'PT BERKAH TRANS UTAMA'], ['POS', 'PT POSCO INDONESIA JAKARTA PROCESSING CENTER'], ['NIJ', 'PT NIPRO INDONESIA JAYA'], ['PJM', 'PT PANATA JAYA MANDIRI']]]);
    await pool.query('INSERT INTO shippers (name) VALUES ?', [[['POSCO CORPORATION'], ['SHANGHAI STEEL CO'], ['EVERGREEN SHIPPING']]]);
  }
  const [[{ nv }]] = await pool.query('SELECT COUNT(*) nv FROM vendors');
  if (!nv) await pool.query('INSERT INTO vendors (code,name) VALUES ?', [[['LST', 'PT LIMA SARANA TRANS'], ['MJL', 'MJL TRANS'], ['DMS', 'DMS LOGISTIK'], ['HAJ W', 'HAJ WIJAYA'], ['HAJ S', 'HAJ SENTOSA']]]);
  await pool.query("UPDATE users SET pic_code='AD', employee_no='2022010001' WHERE username='admin' AND pic_code IS NULL");
}

async function init() {
  const pool = mysql.createPool(cfg.db);
  for (let i = 0; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) { if (i > 30) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
  await migrate(pool);
  await seedMaster(pool);
  if (cfg.seedDummy) {
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM job_orders WHERE remarks LIKE 'DUMMY%'");
    if (!n || cfg.seedDummy === 'force') await require('./scripts/seed-dummy')(pool);
  }
  const PORT = process.env.PORT || 3100;
  createApp(pool).listen(PORT, () => console.log('LESAT di http://localhost:' + PORT));
}
if (require.main === module) init().catch(e => { console.error(e); process.exit(1); });
module.exports = { createApp, seedMaster, init };
