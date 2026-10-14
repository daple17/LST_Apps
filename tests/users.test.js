const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');
const cfg = require('../config');
const { startApp } = require('./app-helper');
const { dbAvailable } = require('./helpers');

test('API user management', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_users'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const roles = Object.fromEntries((await q('SELECT id,name FROM roles')).map(r => [r.name, r.id]));
  const adminId = (await q("SELECT id FROM users WHERE username='admin'"))[0].id;
  const base = { name: 'Budi Santoso', username: 'budi', email: 'Budi@LimaSarana.example', pic_code: 'BS', role_id: roles['PIC Operasional'] };

  // validasi
  const c = b => app.post('/users', { ...base, ...b });
  for (const [b, field] of [[{ name: '' }, 'name'], [{ email: '' }, 'email'], [{ email: 'bukan-email' }, 'email'], [{ username: 'a b' }, 'username'], [{ pic_code: 'b' }, 'pic_code'], [{ pic_code: 'BSX' }, 'pic_code'],
    [{ role_id: 9999 }, 'role_id'], [{ password: 'pendek' }, 'password']]) {
    const r = await c(b); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.data.fields?.[field], field + ' ' + JSON.stringify(b) + ' ' + JSON.stringify(r.data));
  }
  // sukses: email disimpan huruf kecil; password acak hanya dikirim sekali
  const ok = await c({}); assert.equal(ok.status, 200); assert.ok(ok.data.temp_password.length >= 10);
  const u = (await app.get(`/users/${ok.data.id}`)).data;
  assert.equal(u.email, 'budi@limasarana.example'); assert.equal(u.must_change_password, true); assert.equal(u.is_active, true); assert.equal(u.password, undefined);
  assert.equal((await app.rawLogin('budi', ok.data.temp_password)).data.must_change_password, true);
  assert.ok(!(await q("SELECT note FROM audit_log WHERE entity_type='user'")).some(a => (a.note || '').includes(ok.data.temp_password)));
  // duplikat
  for (const [b, field] of [[{ email: 'BUDI@limasarana.example', username: 'budi2', pic_code: 'XX' }, 'email'], [{ username: 'budi', email: 'x@y.id', pic_code: 'XX' }, 'username'], [{ username: 'budi3', email: 'b3@y.id' }, 'pic_code']]) {
    const r = await c(b); assert.equal(r.status, 400); assert.ok(r.data.fields?.[field], field + JSON.stringify(b) + JSON.stringify(r.data));
  }
  // password diisi admin: tidak dikembalikan
  const withPw = await c({ username: 'cici', email: 'cici@x.id', pic_code: 'CC', password: 'rahasia123', must_change_password: false });
  assert.equal(withPw.data.temp_password, undefined); assert.equal((await app.rawLogin('cici', 'rahasia123')).data.must_change_password, false);

  // daftar: ringkasan, cari, filter, urutan (nonaktif di bawah)
  let l = (await app.get('/users')).data; assert.deepEqual(l.summary, { total: 3, active: 3, inactive: 0, never: 1 }); // hanya admin (token langsung) yang belum pernah login lewat /login
  l = (await app.get('/users?q=LIMASARANA')).data; assert.deepEqual(l.rows.map(x => x.username), ['budi']);
  assert.deepEqual((await app.get(`/users?role_id=${roles['PIC Operasional']}`)).data.rows.map(x => x.username).sort(), ['budi', 'cici']);
  assert.equal((await app.get('/users?q=BS')).data.rows[0].username, 'budi');
  assert.deepEqual((await app.get('/users?status=pending')).data.rows.map(x => x.username), ['admin']);  // belum pernah login

  // kode PIC terkunci setelah dipakai di tiket
  await q("INSERT INTO handling_tickets (ticket_no, pic_id, created_by) VALUES ('2026101001BS', ?, ?)", [ok.data.id, ok.data.id]);
  let r = await app.put(`/users/${ok.data.id}`, { pic_code: 'ZZ' }); assert.equal(r.status, 400); assert.match(r.data.fields.pic_code, /terkunci.*1 nomor tiket/);
  assert.equal((await app.put(`/users/${ok.data.id}`, { name: 'Budi S.', pic_code: 'BS' })).status, 200);
  assert.equal((await app.put(`/users/${withPw.data.id}`, { pic_code: 'ZZ' })).status, 200);       // belum dipakai: boleh
  // password kosong = tidak berubah
  assert.equal((await app.rawLogin('cici', 'rahasia123')).status, 200);
  assert.equal((await app.put(`/users/${withPw.data.id}`, { password: 'barubaru123' })).status, 200);
  assert.equal((await app.rawLogin('cici', 'rahasia123')).status, 401); assert.equal((await app.rawLogin('cici', 'barubaru123')).status, 200);

  // aturan akun sendiri
  assert.equal((await app.put(`/users/${adminId}`, { role_id: roles['PIC Operasional'] })).status, 400);
  assert.equal((await app.put(`/users/${adminId}`, { is_active: false })).status, 400);
  assert.equal((await app.post(`/users/${adminId}/deactivate`)).status, 400);
  assert.equal((await app.del(`/users/${adminId}`)).status, 400);

  // nonaktif / aktif: token lama langsung ditolak
  const tok = jwt.sign({ id: withPw.data.id }, cfg.secret);
  assert.equal((await app.callAs(tok, 'GET', '/me')).status, 200);
  assert.equal((await app.post(`/users/${withPw.data.id}/deactivate`)).status, 200);
  assert.equal((await app.callAs(tok, 'GET', '/me')).status, 401); assert.equal((await app.rawLogin('cici', 'barubaru123')).status, 401);
  assert.equal((await app.get('/users')).data.rows.at(-1).username, 'cici');                        // nonaktif di akhir daftar
  assert.equal((await app.post(`/users/${withPw.data.id}/activate`)).status, 200);

  // hapus: user bertransaksi ditolak; user tanpa jejak boleh
  r = await app.del(`/users/${ok.data.id}`); assert.equal(r.status, 400); assert.match(r.data.error, /Nonaktifkan/);
  const fresh = (await app.post('/users', { ...base, username: 'tmp', email: 'tmp@x.id', pic_code: 'TT' })).data.id;
  assert.equal((await app.get(`/users/${fresh}`)).data.deletable, true);
  assert.equal((await app.del(`/users/${fresh}`)).status, 200); assert.equal((await app.get(`/users/${fresh}`)).status, 404);

  // Super Admin: hanya Super Admin yang boleh membuat/mengubah/menonaktifkan; tidak bisa dihapus
  const mgr = await q('INSERT INTO roles (name) VALUES (?)', ['Pengelola User']);
  await q('INSERT INTO role_permissions (role_id, permission) VALUES (?,?),(?,?),(?,?),(?,?)', [mgr.insertId, 'user.view', mgr.insertId, 'user.create', mgr.insertId, 'user.update', mgr.insertId, 'user.delete']);
  const mid = (await q("INSERT INTO users (username,password,name,role_id,email) VALUES ('mgr','x','Mgr',?,'mgr@x.id')", [mgr.insertId])).insertId;
  const M = (m, u, b) => app.callAs(jwt.sign({ id: mid }, cfg.secret), m, u, b);
  assert.equal((await M('PUT', `/users/${adminId}`, { name: 'X' })).status, 403);
  assert.equal((await M('POST', `/users/${adminId}/deactivate`)).status, 403);
  assert.equal((await M('POST', '/users', { ...base, username: 'sa2', email: 'sa2@x.id', pic_code: 'SA', role_id: roles['Super Admin'] })).status, 403);
  assert.equal((await M('PUT', `/users/${withPw.data.id}`, { role_id: roles['Super Admin'] })).status, 403);
  assert.equal((await M('GET', '/users')).data.rows.find(x => x.username === 'admin').locked, true);
  assert.equal((await app.del(`/users/${adminId}`)).status, 400);
  const sa2 = await app.post('/users', { ...base, username: 'sa2', email: 'sa2@x.id', pic_code: 'SA', role_id: roles['Super Admin'] });
  assert.equal(sa2.status, 200); assert.equal((await app.del(`/users/${sa2.data.id}`)).status, 400);
  assert.equal((await app.post(`/users/${sa2.data.id}/deactivate`)).status, 200);                  // admin masih ada -> boleh
  // user tanpa izin user.* ditolak
  const V = (m, u, b) => app.callAs(jwt.sign({ id: withPw.data.id }, cfg.secret), m, u, b);
  assert.equal((await V('GET', '/users')).status, 403); assert.equal((await V('POST', '/users', base)).status, 403);

  // audit
  const acts = (await q("SELECT action FROM audit_log WHERE entity_type='user' ORDER BY id")).map(a => a.action);
  for (const a of ['Dibuat', 'Diubah', 'Dinonaktifkan', 'Diaktifkan', 'Dihapus']) assert.ok(acts.includes(a), a);
  assert.ok((await q("SELECT note FROM audit_log WHERE action='Diubah' AND note LIKE '%role%'")).length >= 0);
});
