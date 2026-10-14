// Pengecekan izin di server (bukan hanya tombol disembunyikan), perubahan role langsung berlaku, user nonaktif, login.
const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const cfg = require('../config');
const { startApp } = require('./app-helper');
const { dbAvailable } = require('./helpers');

test('izin di server', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_authz'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const mkRole = async (name, perms) => { const r = await q('INSERT INTO roles (name) VALUES (?)', [name]); if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [r.insertId, p])]); return r.insertId; };
  const mkUser = async (username, roleId, extra = {}) => { const r = await q('INSERT INTO users (username,password,name,role_id,email,is_active,must_change_password) VALUES (?,?,?,?,?,?,?)', [username, bcrypt.hashSync('pass1234', 10), username.toUpperCase(), roleId, `${username}@x.id`, extra.active ?? 1, extra.must ?? 0]); return r.insertId; };
  const as = (id, name = 'X') => { const tok = jwt.sign({ id, name }, cfg.secret); return (method, url, body) => app.callAs(tok, method, url, body); };
  const viewer = await mkRole('Viewer JO', ['jo.view']), none = await mkRole('Kosong', []);
  const vId = await mkUser('viewer', viewer), nId = await mkUser('kosong', null), iId = await mkUser('nonaktif', viewer, { active: 0 }), mId = await mkUser('harusganti', viewer, { must: 1 });
  const V = as(vId), N = as(nId);

  // viewer: boleh lihat JO, tidak boleh yang lain
  assert.equal((await V('GET', '/job-orders')).status, 200);
  assert.equal((await V('GET', '/job-orders/summary')).status, 200);
  for (const [m, u] of [['POST', '/job-orders'], ['PUT', '/job-orders/1'], ['PATCH', '/job-orders/1/status'], ['DELETE', '/job-orders/1'], ['GET', '/job-orders/export'], ['GET', '/job-orders/1/materials/template'],
    ['POST', '/job-orders/1/duplicate'], ['POST', '/documents'], ['GET', '/ho/tickets'], ['POST', '/ho/tickets'], ['GET', '/home/upcoming'], ['GET', '/home/tickets'],
    ['POST', '/customers'], ['POST', '/shippers'], ['POST', '/vendors']]) {
    const r = await V(m, u, {}); assert.equal(r.status, 403, `${m} ${u} -> ${r.status}`); assert.equal(r.data.error, 'Tidak punya akses');
  }
  // user tanpa role: ditolak di semua modul, tetapi /me dan /lookups tetap bisa
  assert.equal((await N('GET', '/job-orders')).status, 403); assert.equal((await N('GET', '/home/upcoming')).status, 403);
  assert.equal((await N('GET', '/me')).status, 200); assert.equal((await N('GET', '/lookups')).status, 200);

  // perubahan izin role langsung berlaku tanpa login ulang
  assert.equal((await V('POST', '/job-orders', {})).status, 403);
  await q('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)', [viewer, 'jo.create']);
  assert.equal((await V('POST', '/job-orders', {})).status, 400);               // lolos izin, gagal validasi
  await q("DELETE FROM role_permissions WHERE role_id=? AND permission='jo.create'", [viewer]);
  assert.equal((await V('POST', '/job-orders', {})).status, 403);
  await q('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)', [viewer, 'jo.export']);
  assert.equal((await V('GET', '/job-orders/export')).status, 200);
  await q("UPDATE users SET role_id=? WHERE id=?", [none, vId]);                 // ganti role user
  assert.equal((await V('GET', '/job-orders')).status, 403);
  await q("UPDATE users SET role_id=? WHERE id=?", [viewer, vId]);

  // user nonaktif membawa token lama -> 401
  assert.equal((await as(iId)('GET', '/me')).status, 401);
  await q('UPDATE users SET is_active=0 WHERE id=?', [vId]);
  assert.equal((await V('GET', '/job-orders')).status, 401);
  await q('UPDATE users SET is_active=1 WHERE id=?', [vId]);
  assert.equal((await V('GET', '/job-orders')).status, 200);

  // Super Admin tetap bisa semuanya; /me memuat role dan izin
  const me = (await app.get('/me')).data;
  assert.equal(me.role.name, 'Super Admin'); assert.equal(me.permissions.length, require('../lib/permissions').ALL_PERMISSIONS.length);
  assert.equal(me.password, undefined);
  assert.equal((await app.get('/job-orders')).status, 200); assert.equal((await app.get('/home/upcoming')).status, 200);
  assert.deepEqual((await V('GET', '/me')).data.permissions.sort(), ['jo.export', 'jo.view']);

  // wajib ganti password: endpoint lain terkunci sampai diganti
  const M = as(mId);
  const blocked = await M('GET', '/job-orders'); assert.equal(blocked.status, 403); assert.equal(blocked.data.must_change_password, true);
  assert.equal((await M('GET', '/me')).status, 200);
  assert.equal((await M('POST', '/me/password', { current: 'salah123', password: 'barubaru1' })).status, 400);
  assert.equal((await M('POST', '/me/password', { current: 'pass1234', password: 'pendek' })).status, 400);
  assert.equal((await M('POST', '/me/password', { current: 'pass1234', password: 'pass1234' })).status, 400);
  assert.equal((await M('POST', '/me/password', { current: 'pass1234', password: 'barubaru1' })).status, 200);
  assert.equal((await M('GET', '/job-orders')).status, 200);
  assert.ok(bcrypt.compareSync('barubaru1', (await q('SELECT password FROM users WHERE id=?', [mId]))[0].password));
  const log = await q("SELECT * FROM audit_log WHERE entity_type='user' AND entity_id=?", [mId]);
  assert.equal(log.length, 1); assert.ok(!JSON.stringify(log).includes('barubaru1'));

  // berkas upload butuh izin lihat JO/HO
  assert.equal((await app.rawUrl(`/uploads/x.png?t=${jwt.sign({ id: nId }, cfg.secret)}`)).status, 403);
  assert.equal((await app.rawUrl(`/uploads/tidak-ada.png?t=${jwt.sign({ id: vId }, cfg.secret)}`)).status, 404);
  assert.equal((await app.rawUrl('/uploads/x.png')).status, 401);

  // login: nonaktif = pesan sama dengan password salah, last_login_at terisi, dibatasi 10 gagal
  const login = (u, p) => app.rawLogin(u, p);
  const bad = await login('viewer', 'salah'), inactive = await login('nonaktif', 'pass1234');
  assert.equal(bad.status, 401); assert.equal(inactive.status, 401); assert.deepEqual(inactive.data, bad.data);
  assert.equal((await q("SELECT last_login_at FROM users WHERE username='viewer'"))[0].last_login_at, null);
  const ok = await login('viewer', 'pass1234'); assert.equal(ok.status, 200); assert.ok(ok.data.token);
  assert.ok((await q("SELECT last_login_at FROM users WHERE username='viewer'"))[0].last_login_at);
  for (let i = 0; i < 9; i++) await login('ghost', 'x');                          // total 10 gagal untuk IP yang sama (1 di atas + 9)
  assert.equal((await login('viewer', 'pass1234')).status, 429);                  // IP terblokir walau password benar
});
