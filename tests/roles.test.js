const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), cfg = require('../config');
const { startApp } = require('./app-helper');
const { dbAvailable } = require('./helpers');
const P = require('../lib/permissions');

test('API role management', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_roles'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const list = (await app.get('/roles')).data, sa = list.find(r => r.name === 'Super Admin'), pic = list.find(r => r.name === 'PIC Operasional');
  assert.equal(sa.is_system, true); assert.equal(sa.perm_count, P.ALL_PERMISSIONS.length); assert.equal(sa.users, 1); assert.equal(sa.data_scope, 'ALL');

  // buat: validasi nama/izin
  for (const [b, f] of [[{ name: '' }, 'name'], [{ name: 'Super Admin' }, 'name'], [{ name: 'X', permissions: [] }, 'name'], [{ name: 'Role Baru', permissions: ['jo.hack'] }, 'permissions'],
    [{ name: 'Role Baru', permissions: ['jo.approve'] }, 'permissions'], [{ name: 'Role Baru', permissions: 'jo.view' }, 'permissions'], [{ name: 'Role Baru', data_scope: 'OWN' }, 'data_scope']]) {
    const r = await app.post('/roles', b); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.data.fields[f], f);
  }
  // aksi selain lihat otomatis menyertakan lihat
  const mk = await app.post('/roles', { name: 'Admin Gudang', description: 'Tes', permissions: ['jo.update', 'approval.approve', 'home.view'] });
  assert.equal(mk.status, 200);
  const got = (await app.get(`/roles/${mk.data.id}`)).data;
  assert.deepEqual(got.permissions, ['approval.approve', 'approval.view', 'home.view', 'jo.update', 'jo.view']); assert.equal(got.active_modules, 3);

  // ubah izin: tercatat di audit (sebelum/sesudah) dan langsung berlaku
  const uid = (await q("INSERT INTO users (username,password,name,role_id,email) VALUES ('gdg','x','Gudang',?,'g@x.id')", [mk.data.id])).insertId;
  const G = (m, u, b) => app.callAs(jwt.sign({ id: uid }, cfg.secret), m, u, b);
  assert.equal((await G('GET', '/job-orders')).status, 200); assert.equal((await G('GET', '/ho/tickets')).status, 403);
  const up = await app.put(`/roles/${mk.data.id}`, { name: 'Admin Gudang', permissions: ['ho.view', 'ho.create'] });
  assert.equal(up.status, 200); assert.deepEqual(up.data.permissions, ['ho.create', 'ho.view']);
  assert.equal((await G('GET', '/job-orders')).status, 403); assert.equal((await G('GET', '/ho/tickets')).status, 200);
  const log = (await q("SELECT action, note FROM audit_log WHERE entity_type='role' AND entity_id=? ORDER BY id", [mk.data.id]));
  assert.deepEqual(log.map(l => l.action), ['Dibuat', 'Izin diubah']);
  assert.match(log[1].note, /ditambah: ho\.create, ho\.view; dicabut: approval\.approve, approval\.view, home\.view, jo\.update, jo\.view/);
  assert.equal((await app.put(`/roles/${mk.data.id}`, { permissions: ['x.y'] })).status, 400);
  assert.equal((await app.get(`/roles/${mk.data.id}`)).data.permissions.length, 2);          // gagal -> tidak berubah
  assert.equal((await app.put(`/roles/${mk.data.id}`, { name: 'PIC Operasional' })).status, 400); // nama ganda
  assert.equal((await app.put(`/roles/${mk.data.id}`, { description: 'baru' })).data.permissions.length, 2); // izin tidak dikirim = tetap

  // role sistem tidak bisa diubah/dihapus; role terpakai tidak bisa dihapus; duplikat
  assert.equal((await app.put(`/roles/${sa.id}`, { name: 'Raja' })).status, 403);
  assert.equal((await app.put(`/roles/${sa.id}`, { permissions: [] })).status, 403);
  assert.equal((await app.del(`/roles/${sa.id}`)).status, 403);
  let r = await app.del(`/roles/${mk.data.id}`); assert.equal(r.status, 400); assert.match(r.data.error, /1 user/);
  const dup = await app.post(`/roles/${pic.id}/duplicate`); assert.equal(dup.data.name, 'PIC Operasional (salinan)');
  assert.deepEqual((await app.get(`/roles/${dup.data.id}`)).data.permissions, (await app.get(`/roles/${pic.id}`)).data.permissions);
  assert.equal((await app.post(`/roles/${pic.id}/duplicate`)).data.name, 'PIC Operasional (salinan 2)');
  assert.equal((await app.del(`/roles/${dup.data.id}`)).status, 200); assert.equal((await app.get(`/roles/${dup.data.id}`)).status, 404);
  await q('UPDATE users SET role_id=? WHERE id=?', [pic.id, uid]);
  assert.equal((await app.del(`/roles/${mk.data.id}`)).status, 200);

  // tanpa izin role.* ditolak; dengan role.view boleh baca saja
  const V = (m, u, b) => app.callAs(jwt.sign({ id: uid }, cfg.secret), m, u, b);
  assert.equal((await V('GET', '/roles')).status, 403); assert.equal((await V('POST', '/roles', { name: 'Zzz' })).status, 403);
  await q("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'role.view')", [pic.id]);
  assert.equal((await V('GET', '/roles')).status, 200); assert.equal((await V('POST', '/roles', { name: 'Zzz' })).status, 403);
  assert.equal((await V('PUT', `/roles/${pic.id}`, { description: 'x' })).status, 403); assert.equal((await V('DELETE', `/roles/${pic.id}`)).status, 403);
  // pengguna dengan role.update tapi bukan sistem tetap tidak boleh mengubah Super Admin
  await q("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'role.update')", [pic.id]);
  assert.equal((await V('PUT', `/roles/${sa.id}`, { description: 'x' })).status, 403);
});
