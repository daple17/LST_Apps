const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../lib/permissions');
const { migrate, helpers } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');

test('daftar izin: kode valid, modul tersedia & "segera"', () => {
  assert.ok(P.isValid('jo.update')); assert.ok(P.isValid('approval.approve'));
  assert.ok(!P.isValid('jo.approve')); assert.ok(P.isValid('coa.export')); assert.ok(P.isValid('checkin_rekap.export')); assert.ok(!P.isValid('checkin.export')); assert.ok(!P.isValid('checkin_rekap.create')); assert.ok(!P.isValid('coa.delete')); assert.ok(!P.isValid('nope.view')); assert.ok(!P.isValid('jo'));
  assert.equal(new Set(P.ALL_PERMISSIONS).size, P.ALL_PERMISSIONS.length);
  const by = Object.fromEntries(P.MODULES.map(m => [m.key, m]));
  for (const k of ['home', 'jo', 'ho', 'checkin', 'checkin_rekap', 'coa', 'customer', 'vendor', 'shipper', 'user', 'role']) assert.equal(by[k].available, true, k);
  for (const k of ['trucking', 'submission', 'settlement', 'job_complete', 'unit', 'approval']) assert.equal(by[k].available, false, k);
  for (const m of P.MODULES) assert.ok(P.GROUPS.includes(m.group), m.key);
});

test('level akses: Tanpa/Lihat/Kelola/Penuh dan "kustom"', () => {
  assert.deepEqual(P.levelPerms('jo', 'manage'), ['jo.view', 'jo.create', 'jo.update', 'jo.export']);
  assert.equal(P.levelPerms('jo', 'full').length, 5);
  assert.deepEqual(P.levelPerms('home', 'full'), ['home.view']);
  assert.equal(P.levelOf('jo', new Set()), 'none');
  assert.equal(P.levelOf('jo', new Set(['jo.view'])), 'view');
  assert.equal(P.levelOf('jo', new Set(P.levelPerms('jo', 'manage'))), 'manage');
  assert.equal(P.levelOf('jo', new Set(P.levelPerms('jo', 'full'))), 'full');
  assert.equal(P.levelOf('jo', new Set(['jo.view', 'jo.delete'])), 'custom');
  assert.equal(P.levelOf('approval', new Set(['approval.view', 'approval.approve'])), 'full');
  assert.equal(P.levelOf('checkin', new Set(P.levelPerms('checkin', 'manage'))), 'manage'); assert.deepEqual(P.levelPerms('checkin_rekap', 'manage'), ['checkin_rekap.view', 'checkin_rekap.update', 'checkin_rekap.export']);
});

test('migrasi 005: role, izin, user lama; aman diulang', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const pool = await freshDb('lesat_test_rbac'); t.after(() => pool.end());
  const q = async (s, p) => (await pool.query(s, p))[0];
  await require('../migrations/000-legacy-baseline').up(helpers(pool));
  await q("INSERT INTO users (username,password,name,pic_code) VALUES ('admin','x','Administrator','AD'),('tejo','x','Tejo','TP')");
  await migrate(pool); assert.deepEqual(await migrate(pool), []);
  const { syncSystemRoles } = require('../lib/roles-seed');
  await syncSystemRoles(pool); await syncSystemRoles(pool); // idempoten

  const roles = await q('SELECT * FROM roles ORDER BY id');
  assert.deepEqual(roles.map(r => r.name), ['Super Admin', 'PIC Operasional']);
  assert.equal(roles[0].is_system, 1); assert.equal(roles[1].is_system, 0); assert.equal(roles[0].data_scope, 'ALL');
  assert.equal((await q('SELECT COUNT(*) n FROM role_permissions WHERE role_id=?', [roles[0].id]))[0].n, P.ALL_PERMISSIONS.length);
  const pic = (await q('SELECT permission FROM role_permissions WHERE role_id=? ORDER BY permission', [roles[1].id])).map(r => r.permission);
  assert.deepEqual(pic, ['checkin.create', 'checkin.update', 'checkin.view', 'ho.create', 'ho.export', 'ho.update', 'ho.view', 'home.view', 'jo.create', 'jo.export', 'jo.update', 'jo.view']);

  const u = Object.fromEntries((await q('SELECT username, role_id, email, is_active, must_change_password FROM users')).map(x => [x.username, x]));
  assert.equal(u.admin.role_id, roles[0].id); assert.equal(u.admin.email, 'admin@gmail.com');
  assert.equal(u.tejo.role_id, roles[1].id); assert.equal(u.tejo.email, null); assert.equal(u.tejo.is_active, 1); assert.equal(u.tejo.must_change_password, 0);
  // email unik, tetapi NULL boleh banyak
  await q("INSERT INTO users (username,password,name) VALUES ('a','x','A'),('b','x','B')");
  await assert.rejects(q("INSERT INTO users (username,password,name,email) VALUES ('c','x','C','admin@gmail.com')"), /Duplicate/);
  // role yang masih dipakai user tidak bisa dihapus begitu saja (FK)
  await assert.rejects(q('DELETE FROM roles WHERE id=?', [roles[1].id]));
  // izin Super Admin ikut bertambah bila daftar izin bertambah: dikembalikan penuh walau ada yang hilang
  await q("DELETE FROM role_permissions WHERE role_id=? AND permission='jo.delete'", [roles[0].id]);
  await syncSystemRoles(pool);
  assert.equal((await q('SELECT COUNT(*) n FROM role_permissions WHERE role_id=?', [roles[0].id]))[0].n, P.ALL_PERMISSIONS.length);
});
