const test = require('node:test'), assert = require('node:assert/strict');
const { migrate, helpers } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');
const { seedCoa } = require('../migrations/007-coa');
const P = require('../lib/permissions');

test('migrasi 007: data awal COA, aman diulang, tidak menimpa perubahan pengguna', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const pool = await freshDb('lesat_test_coa_mig'); t.after(() => pool.end());
  const q = async (s, p) => (await pool.query(s, p))[0], m = helpers(pool);
  await migrate(pool); assert.deepEqual(await migrate(pool), []);
  assert.equal((await q('SELECT COUNT(*) n FROM coa_accounts'))[0].n, 365);
  assert.equal((await q('SELECT COUNT(*) n FROM coa_headers'))[0].n, 30);
  const per = Object.fromEntries((await q('SELECT h.jenis, COUNT(*) n FROM coa_accounts a JOIN coa_headers h ON h.id=a.header_id GROUP BY h.jenis')).map(r => [r.jenis, r.n]));
  assert.deepEqual(per, { ASET: 31, LIABILITAS: 12, EKUITAS: 4, REVENUE: 126, BEBAN: 192 });
  assert.equal((await q("SELECT COUNT(*) n FROM coa_headers WHERE jenis IN ('ASET','LIABILITAS','EKUITAS') AND group_account<>''"))[0].n, 0);   // neraca tanpa group
  assert.equal((await q("SELECT COUNT(*) n FROM coa_headers WHERE jenis IN ('REVENUE','BEBAN') AND group_account=''"))[0].n, 0);
  assert.equal((await q('SELECT COUNT(*) n FROM coa_accounts WHERE is_active=1'))[0].n, 365);
  assert.deepEqual((await q('SELECT name FROM coa_accounts WHERE code IN (45155,45165) ORDER BY code')).map(r => r.name), ['CRANE', 'ADM LIFT ON']);

  // perubahan pengguna tidak tertimpa walau seed dijalankan lagi (juga bila catatan migrasi hilang)
  await q("UPDATE coa_accounts SET name='NAMA BARU', is_active=0 WHERE code=11010");
  await q("INSERT INTO coa_headers (jenis, sub_header, group_account, sort_order) VALUES ('REVENUE','Pendapatan Operasional','Kelompok Baru',900)");
  assert.equal(await seedCoa(m), false);
  await q("DELETE FROM schema_migrations WHERE name='007-coa.js'"); await migrate(pool);
  assert.equal((await q('SELECT COUNT(*) n FROM coa_accounts'))[0].n, 365);
  assert.deepEqual((await q('SELECT name, is_active FROM coa_accounts WHERE code=11010'))[0], { name: 'NAMA BARU', is_active: 0 });
  assert.equal((await q('SELECT COUNT(*) n FROM coa_headers'))[0].n, 31);
  // kode unik di database
  await assert.rejects(q("INSERT INTO coa_accounts (code, name, header_id) VALUES (11010, 'DOBEL', 1)"), /Duplicate/);
  // izin: coa tersedia, ekspor ada, tidak ada hapus; Super Admin ikut memegangnya
  const sa = (await q("SELECT p.permission FROM role_permissions p JOIN roles r ON r.id=p.role_id WHERE r.name='Super Admin'")).map(r => r.permission);
  assert.ok(sa.includes('coa.export') && !sa.some(p => p === 'coa.delete')); assert.equal(sa.length, P.ALL_PERMISSIONS.length);
});
