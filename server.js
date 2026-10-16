const express = require('express'), mysql = require('mysql2/promise'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), path = require('path');
const cfg = require('./config');
const rules = require('./lib/rules');
const { migrate } = require('./lib/migrate');
const { wrap, bad } = require('./lib/http');
const { authenticate, requirePerm, guard, loginLimiter } = require('./lib/authz');
const permissions = require('./lib/permissions');
const audit = require('./lib/audit');

// createApp(pool): aplikasi Express tanpa listen — dipakai server dan test integrasi
function createApp(pool, opts = {}) {   // opts.now: jam server yang bisa diganti di tes (selalu jam server, bukan klien)
  const app = express();
  app.set('trust proxy', 1); // di belakang proxy Railway: req.ip = IP klien (untuk pembatasan login)
  app.use(express.json({ limit: '25mb' }));
  for (const f of ['code128', 'idfmt']) app.get(`/shared/${f}.js`, (req, res) => res.sendFile(path.join(__dirname, 'lib', `${f}.js`))); // satu berkas untuk server & browser
  app.use(express.static(path.join(__dirname, 'public')));
  // surat jalan digital via QR: tanpa login, link rahasia (lib/sj-link.js), hanya-baca
  app.get('/s/:code(\\d+)', async (req, res, next) => {
    try {
      const id = require('./lib/sj-link').verify(req.params.code); if (!id) return res.status(404).type('text').send('Surat jalan tidak ditemukan');
      const buf = await handling.sjPdfBuffer(id); if (!buf) return res.status(404).type('text').send('Surat jalan tidak ditemukan');
      res.set('Cache-Control', 'no-store').type('application/pdf').set('Content-Disposition', 'inline; filename="surat-jalan.pdf"').send(buf);
    } catch (e) { next(e); }
  });

  const limiter = loginLimiter();
  app.post('/api/login', wrap(async (req, res) => {
    const username = String(req.body.username || '').trim(), ip = req.ip;
    if (limiter.blocked(ip, username)) return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.' });
    const [[u]] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
    // user nonaktif ditolak dengan pesan yang sama seperti password salah (tidak membocorkan status akun)
    if (!u || !u.is_active || !bcrypt.compareSync(String(req.body.password || ''), u.password)) { limiter.fail(ip, username); return res.status(401).json({ error: 'Username atau password salah' }); }
    limiter.ok(ip, username);
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=?', [u.id]);
    res.json({ token: jwt.sign({ id: u.id, name: u.name }, cfg.secret, { expiresIn: '12h' }), name: u.name, must_change_password: !!u.must_change_password });
  }));

  // semua /api di bawah ini butuh login; user nonaktif / token lama langsung ditolak (401)
  app.use('/api', wrap(async (req, res, next) => {
    // unduhan yang dibuka lewat tautan biasa (PDF/ZIP) boleh membawa token di ?t= (hanya GET)
    const tok = (req.headers.authorization || '').slice(7) || (req.method === 'GET' && /\/(pdf|zip)$|\/photo\/\d+$/.test(req.path) ? String(req.query.t || '') : '');
    const user = await authenticate(pool, cfg.secret, tok);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    // wajib ganti password: hanya /me, ganti password, dan lookups yang boleh sampai password diganti
    if (user.mustChange && !/^\/(me(\/password)?|lookups)$/.test(req.path)) return res.status(403).json({ error: 'Wajib ganti password terlebih dahulu', must_change_password: true });
    req.user = user; next();
  }));
  app.use('/uploads', wrap(async (req, res, next) => { // berkas butuh token lewat ?t= dan izin lihat JO atau Handling Ops
    const user = await authenticate(pool, cfg.secret, String(req.query.t || ''));
    if (!user) return res.sendStatus(401);
    if (/^\/att-/.test(req.path)) return res.sendStatus(403);   // foto absensi hanya lewat /api/checkin(-rekap)/photo (dicek pemilik/izin)
    if (!user.perms.has('jo.view') && !user.perms.has('ho.view')) return res.sendStatus(403);
    next();
  }), express.static(cfg.uploadDir));

  app.get('/api/me', (req, res) => {
    const { perms, mustChange, ...u } = req.user;
    res.json({ ...u, permissions: [...perms], must_change_password: mustChange });
  });
  app.post('/api/me/password', wrap(async (req, res) => {
    const cur = String(req.body.current || ''), next = String(req.body.password || '');
    if (next.length < 8) return bad(res, 'Password baru minimal 8 karakter');
    const [[u]] = await pool.query('SELECT password FROM users WHERE id=?', [req.user.id]);
    if (!bcrypt.compareSync(cur, u.password)) return bad(res, 'Password lama salah');
    if (cur === next) return bad(res, 'Password baru harus berbeda dari yang lama');
    await pool.query('UPDATE users SET password=?, must_change_password=0 WHERE id=?', [bcrypt.hashSync(next, 10), req.user.id]);
    await audit.log(pool, { entity: 'user', id: req.user.id, action: 'Ganti password', user: req.user }); // password tidak pernah ditulis ke log
    res.json({ ok: true });
  }));

  app.get('/api/lookups', wrap(async (req, res) => {
    const customers = (await pool.query('SELECT id,code,name,is_active FROM customers ORDER BY name'))[0].map(c => ({ ...c, is_active: !!c.is_active }));
    const [shippers] = await pool.query('SELECT id,name FROM shippers ORDER BY name');
    const vendors = (await pool.query('SELECT id,code,name,is_active FROM vendors ORDER BY code'))[0].map(v => ({ ...v, is_active: !!v.is_active }));
    const [[me]] = await pool.query('SELECT name,employee_no FROM users WHERE id=?', [req.user.id]);
    res.json({ customers, shippers, vendors, me, rules: rules.client, permissions: permissions.client });
  }));

  app.post('/api/shippers', requirePerm('shipper.create'), wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return bad(res, 'Nama wajib diisi');
    const [r] = await pool.query('INSERT INTO shippers (name) VALUES (?)', [name]);
    res.json({ id: r.insertId });
  }));
  const jo = require('./routes/job-orders'), handling = require('./routes/handling')(pool);
  const JO_EXPORT = [['GET', /^\/export$/, 'export'], ['GET', /^\/\d+\/materials\/template$/, 'export']];
  app.use('/api/job-orders', guard('jo', JO_EXPORT));
  app.use('/api/documents', guard('jo'));
  const HO_EXPORT = [['GET', /^\/tickets\/export$/, 'export'], ['GET', /^\/tickets\/\d+\/(export|zip)$/, 'export'], ['GET', /^\/sj\/\d+\/pdf$/, 'export'], ['GET', /^\/tickets\/\d+\/materials\/\d+\/pdf$/, 'export'],
    ['POST', /^\/sj\/\d+\/finish$/, 'update'], ['POST', /^\/sj\/\d+\/(ready|complete|reopen|tracking\/(step|undo|link\/(revoke|regenerate|unlock)))$/, 'update'], ['POST', /^\/(tickets\/\d+\/materials\/\d+|sj\/\d+)\/photos$/, 'update']];
  app.use('/api/ho', guard('ho', HO_EXPORT));
  app.use('/api/home', requirePerm('home.view'));
  app.use('/api/users', guard('user', [['POST', /^\/\d+\/(de)?activate$/, 'update']]), require('./routes/users')(pool));
  app.use('/api/checkin', guard('checkin'), require('./routes/checkin').router(pool, opts));
  app.use('/api/checkin-rekap', guard('checkin_rekap', [['GET', /^\/export$/, 'export']]), require('./routes/checkin-rekap')(pool, opts));
  app.use('/api/customers', guard('customer', [['GET', /^\/export$/, 'export'], ['GET', /^\/suggest-code$/, 'create'], ['POST', /^\/\d+\/(de)?activate$/, 'update']]), require('./routes/customers')(pool));
  app.use('/api/vendors', guard('vendor', [['GET', /^\/export$/, 'export'], ['GET', /^\/suggest-code$/, 'create'], ['POST', /^\/\d+\/(de)?activate$/, 'update'], ['POST', /^\/cities$/, 'update']]), require('./routes/vendors')(pool));
  app.use('/api/coa', guard('coa', [['GET', /^\/export$/, 'export']]), require('./routes/coa')(pool));
  app.use('/api/roles', guard('role'), require('./routes/roles')(pool));
  app.use('/api/job-orders', require('./routes/jo-materials')(pool, { refreshTickets: handling.refreshForJo }));
  app.use('/api/job-orders', jo(pool));
  app.use('/api/documents', jo.documentsRouter(pool));
  app.use('/api/ho', handling);
  app.use('/api/home', require('./routes/home')(pool, { ticketSummaries: handling.summariesByIds }));
  return app;
}

// data master awal (hanya jika kosong)
async function seedMaster(pool) {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM users');
  if (!n) {
    if (!cfg.adminPassword) throw new Error('ADMIN_PASSWORD wajib diisi untuk membuat user admin pertama');
    await pool.query('INSERT INTO users (username,password,name,pic_code,employee_no,email) VALUES (?,?,?,?,?,?)', ['admin', bcrypt.hashSync(cfg.adminPassword, 10), 'Administrator', 'AD', '2022010001', 'admin@gmail.com']);
  }
  const [[{ nc }]] = await pool.query('SELECT COUNT(*) nc FROM customers');
  if (!nc) {
    await pool.query('INSERT INTO customers (code,name) VALUES ?', [[['USC', 'PT UNITED STEEL SERVICE INDONESIA'], ['BTU', 'PT BERKAH TRANS UTAMA'], ['POS', 'PT POSCO INDONESIA JAKARTA PROCESSING CENTER'], ['NIJ', 'PT NIPRO INDONESIA JAYA'], ['PJM', 'PT PANATA JAYA MANDIRI']]]);
    await pool.query('INSERT INTO shippers (name) VALUES ?', [[['POSCO CORPORATION'], ['SHANGHAI STEEL CO'], ['EVERGREEN SHIPPING']]]);
  }
  const [[{ nv }]] = await pool.query('SELECT COUNT(*) nv FROM vendors');
  if (!nv) await pool.query('INSERT INTO vendors (code,name) VALUES ?', [[['LST', 'PT LIMA SARANA TRANS'], ['MJL', 'MJL TRANS'], ['DMS', 'DMS LOGISTIK'], ['HAJ W', 'HAJ WIJAYA'], ['HAJ S', 'HAJ SENTOSA']]]);
  await pool.query("UPDATE vendors SET is_own_fleet=1 WHERE code='LST'");
  await pool.query("UPDATE users SET pic_code='AD', employee_no='2022010001' WHERE username='admin' AND pic_code IS NULL");
  await require('./lib/roles-seed').syncSystemRoles(pool); // admin -> Super Admin; Super Admin selalu memegang semua izin
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
