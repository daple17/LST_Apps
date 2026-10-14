// Autentikasi & otorisasi. Izin dibaca dari database di SETIAP permintaan (satu query berindeks), tidak disimpan di JWT,
// sehingga perubahan role atau status user langsung berlaku. JWT hanya berisi id dan nama.
const jwt = require('jsonwebtoken');
const { ALL_PERMISSIONS } = require('./permissions');
const { SUPER_ADMIN } = require('./roles-seed');

const FORBIDDEN = { error: 'Tidak punya akses' };

// token -> user lengkap (role + izin), atau null bila token salah / user tidak ada / nonaktif
async function authenticate(pool, secret, token) {
  let p; try { p = jwt.verify(token, secret); } catch { return null; }
  const [rows] = await pool.query(`SELECT u.id, u.username, u.name, u.email, u.employee_no, u.pic_code, u.is_active, u.must_change_password, u.role_id,
      r.name role_name, r.is_system role_system, r.data_scope, rp.permission
    FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE u.id = ?`, [p.id]);
  const u = rows[0];
  if (!u || !u.is_active) return null;
  const isSuper = !!u.role_system && u.role_name === SUPER_ADMIN;
  const perms = new Set(isSuper ? ALL_PERMISSIONS : rows.map(r => r.permission).filter(Boolean));
  return { id: u.id, name: u.name, username: u.username, email: u.email, employee_no: u.employee_no, pic_code: u.pic_code,
    role: u.role_id ? { id: u.role_id, name: u.role_name, is_system: !!u.role_system, data_scope: u.data_scope } : null,
    perms, mustChange: !!u.must_change_password };
}

const can = (req, code) => !!req.user && req.user.perms.has(code);
const requirePerm = (...codes) => (req, res, next) => (codes.some(c => can(req, c)) ? next() : res.status(403).json(FORBIDDEN));

// Router dengan pola metode -> aksi: GET=view, POST=create, PUT/PATCH=update, DELETE=delete.
// `overrides`: [[METODE, regex path, aksi]] diperiksa lebih dulu (ekspor, template, finish, dll.). Daftar lengkap: docs/permission-map.md
const METHOD_ACTION = { GET: 'view', HEAD: 'view', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
function guard(mod, overrides = []) {
  return (req, res, next) => {
    const hit = overrides.find(([m, re]) => m === req.method && re.test(req.path));
    const action = hit ? hit[2] : METHOD_ACTION[req.method];
    if (!action) return res.status(403).json(FORBIDDEN);
    return can(req, `${mod}.${action}`) ? next() : res.status(403).json(FORBIDDEN);
  };
}

// Pembatasan percobaan login (di memori proses): maks. `max` gagal per username dan per IP dalam `windowMs`.
function loginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map(); // key -> [waktu gagal]
  const recent = key => { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < windowMs); a.length ? hits.set(key, a) : hits.delete(key); return a; };
  const keys = (ip, user) => [`ip:${ip}`, `u:${String(user || '').toLowerCase()}`];
  return {
    blocked: (ip, user) => keys(ip, user).some(k => recent(k).length >= max),
    fail: (ip, user) => keys(ip, user).forEach(k => { const a = recent(k); a.push(Date.now()); hits.set(k, a); }),
    ok: (ip, user) => hits.delete(`u:${String(user || '').toLowerCase()}`),
  };
}
module.exports = { authenticate, can, requirePerm, guard, loginLimiter, FORBIDDEN };
