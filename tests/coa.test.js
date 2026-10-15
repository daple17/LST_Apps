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

const jwt = require('jsonwebtoken'), ExcelJS = require('exceljs'), cfg = require('../config');
const { startApp } = require('./app-helper');

test('API COA: daftar, filter, validasi, ubah, kelompok, ekspor, izin, audit', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_coa_api'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const list = async (qs = '') => (await app.get('/coa' + qs)).data;
  const hdrs = (await app.get('/coa/headers')).data, hid = (jenis, sub, grp = '') => hdrs.find(h => h.jenis === jenis && h.sub_header === sub && h.group_account === grp).id;

  // data awal, ringkasan, paginasi 50
  let d = await list(); assert.equal(d.total, 365); assert.equal(d.rows.length, 50); assert.equal(d.pages, 8); assert.equal(d.rows[0].code, 11010);
  assert.deepEqual(d.summary, { total: 365, active: 365, inactive: 0, per_jenis: { ASET: 31, LIABILITAS: 12, EKUITAS: 4, REVENUE: 126, BEBAN: 192 } });
  assert.equal((await list('?page=8')).rows.length, 15); assert.ok(d.rows.every((r, i, a) => !i || a[i - 1].code < r.code));
  // cari: awalan kode atau isi nama; filter jenis / sub header / group / status
  assert.deepEqual((await list('?q=11010')).rows.map(r => r.code), [11010]);
  assert.ok((await list('?q=110')).rows.every(r => String(r.code).startsWith('110') || r.name.includes('110')));
  assert.ok((await list('?q=kas')).rows.some(r => r.name === 'KAS KECIL'));
  assert.equal((await list('?jenis=ASET')).total, 31); assert.equal((await list('?jenis=BEBAN&q=HANDLING IMPOR')).rows[0].code, 51010);
  assert.equal((await list('?sub_header=Aktiva Tetap')).total, 20); assert.equal((await list('?group=Biaya Reimbursement')).total, 45);
  assert.equal((await list('?status=inactive')).total, 0); assert.equal((await list('?jenis=XX')).total, 365);
  const kas = (await list('?q=11010')).rows[0]; assert.equal(kas.jenis_label, 'Aset'); assert.equal(kas.group_account, ''); assert.equal(kas.header_label, 'Aktiva Lancar');

  // validasi tambah
  const base = { code: '19999', name: 'AKUN UJI', header_id: hid('ASET', 'Aktiva Lancar') };
  for (const [b, f] of [[{ code: '1234' }, 'code'], [{ code: '01234' }, 'code'], [{ code: '123456' }, 'code'], [{ code: 'abcde' }, 'code'], [{ code: '' }, 'code'], [{ code: '11010' }, 'code'], [{ name: 'A' }, 'name'], [{ name: ' ' }, 'name'],
    [{ header_id: undefined }, 'header_id'], [{ header_id: 99999 }, 'header_id']]) {
    const r = await app.post('/coa', { ...base, ...b }); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.data.fields[f], f + JSON.stringify(b));
  }
  const ok = await app.post('/coa', { ...base, name: '  AKUN   UJI ' }); assert.equal(ok.status, 200);
  assert.equal((await list('?q=19999')).rows[0].name, 'AKUN UJI');

  // type Job Order: opsional, bisa lebih dari satu, kosong = semua type; akun awal tetap kosong
  assert.ok((await list()).rows.every(r => Array.isArray(r.job_types) && r.job_types.length === 0 && r.job_types_label === 'Semua type'));
  for (const [jt, f] of [[['IMPORT', 'BOGUS'], 'job_types'], ['IMPORT', 'job_types'], [[1], 'job_types']]) { const x = await app.post('/coa', { ...base, code: '19980', job_types: jt }); assert.equal(x.status, 400, JSON.stringify(jt)); assert.ok(x.data.fields[f]); }
  assert.equal((await q('SELECT COUNT(*) n FROM coa_accounts WHERE code=19980'))[0].n, 0);
  const jt1 = await app.post('/coa', { ...base, code: '19980', name: 'AKUN TYPE JO', job_types: ['EXPORT', 'IMPORT', 'IMPORT'] }); assert.equal(jt1.status, 200);
  let row = (await list('?q=19980')).rows[0]; assert.deepEqual(row.job_types, ['IMPORT', 'EXPORT']); assert.equal(row.job_types_label, 'Import, Export');   // urutan baku, tanpa ganda
  assert.ok((await list('?job_type=IMPORT')).rows.some(r => r.code === 19980)); assert.equal((await list('?job_type=TRUCKING&q=19980')).total, 0);
  assert.equal((await list('?job_type=TRUCKING')).total, 366); assert.equal((await list('?job_type=XX')).total, 367);           // type kosong berlaku untuk semua; type tak dikenal diabaikan
  assert.equal((await app.put(`/coa/${jt1.data.id}`, { name: 'AKUN TYPE JO 2' })).status, 200); assert.deepEqual((await list('?q=19980')).rows[0].job_types, ['IMPORT', 'EXPORT']);   // tidak dikirim = tetap
  assert.equal((await app.put(`/coa/${jt1.data.id}`, { job_types: ['PROJECT'] })).status, 200); assert.deepEqual((await list('?q=19980')).rows[0].job_types, ['PROJECT']);
  assert.equal((await app.put(`/coa/${jt1.data.id}`, { job_types: ['X'] })).status, 400);
  assert.equal((await app.put(`/coa/${jt1.data.id}`, { job_types: [] })).status, 200); assert.equal((await list('?q=19980')).rows[0].job_types_label, 'Semua type');
  assert.ok((await q("SELECT note FROM audit_log WHERE entity_type='coa' AND note LIKE '%type JO: Import, Export → Project%'")).length === 1); assert.ok((await q("SELECT note FROM audit_log WHERE entity_type='coa' AND action='Dibuat' AND note LIKE '%type JO: Import, Export'")).length === 1);
  await q('DELETE FROM audit_log WHERE entity_type="coa"'); await q('DELETE FROM coa_accounts WHERE code=19980');             // dibersihkan agar hitungan di bawah tetap

  // ubah: kode terkunci, nama, pindah kelompok, nonaktif/aktif
  let r = await app.put(`/coa/${ok.data.id}`, { code: '19998' }); assert.equal(r.status, 400); assert.match(r.data.fields.code, /tidak bisa diubah/);
  assert.equal((await app.put(`/coa/${ok.data.id}`, { code: 19999, name: 'AKUN BARU' })).status, 200);                  // kode sama = boleh
  assert.equal((await app.put(`/coa/${ok.data.id}`, { header_id: hid('ASET', 'Aktiva Tetap') })).status, 200);
  assert.equal((await list('?q=19999')).rows[0].sub_header, 'Aktiva Tetap'); assert.equal((await list('?q=19999')).rows[0].name, 'AKUN BARU');
  assert.equal((await app.put(`/coa/${ok.data.id}`, { name: 'X' })).status, 400); assert.equal((await app.put(`/coa/${ok.data.id}`, { header_id: 12345 })).status, 400);
  assert.equal((await app.put(`/coa/${ok.data.id}`, { is_active: false })).status, 200);
  assert.equal((await list('?status=inactive')).total, 1); assert.equal((await list()).summary.inactive, 1);
  assert.equal((await app.put('/coa/999999', { name: 'ZZ' })).status, 404);

  // kelompok: duplikat, group wajib untuk Revenue/Beban, neraca menyimpan group kosong
  assert.equal(hdrs.length, 30); const rev = hdrs.find(h => h.group_account === 'Pendapatan Trucking'); assert.equal(rev.accounts, 25); assert.equal(rev.has_group, true);
  r = await app.post('/coa/headers', { jenis: 'ASET', sub_header: 'Aktiva Lancar' }); assert.equal(r.status, 400); assert.match(r.data.fields.sub_header, /sudah ada/);
  r = await app.post('/coa/headers', { jenis: 'REVENUE', sub_header: 'Pendapatan Operasional', group_account: 'pendapatan trucking' }); assert.equal(r.status, 400);       // duplikat tanpa beda huruf
  r = await app.post('/coa/headers', { jenis: 'REVENUE', sub_header: 'Pendapatan Operasional' }); assert.equal(r.status, 400); assert.ok(r.data.fields.group_account);
  r = await app.post('/coa/headers', { jenis: 'BEBAN', sub_header: '', group_account: 'X' }); assert.equal(r.status, 400); assert.ok(r.data.fields.sub_header);
  r = await app.post('/coa/headers', { jenis: 'XX', sub_header: 'A' }); assert.equal(r.status, 400); assert.ok(r.data.fields.jenis);
  const nb = await app.post('/coa/headers', { jenis: 'ASET', sub_header: 'Aktiva Lainnya', group_account: 'ABAIKAN' }); assert.equal(nb.status, 200);
  const nbRow = (await app.get('/coa/headers')).data.find(h => h.id === nb.data.id); assert.equal(nbRow.group_account, ''); assert.equal(nbRow.has_group, false);
  const ng = await app.post('/coa/headers', { jenis: 'BEBAN', sub_header: 'Biaya Operasional', group_account: 'Biaya Baru' }); assert.equal(ng.status, 200);
  assert.equal((await app.get('/coa/headers')).data.find(h => h.id === ng.data.id).sort_order > hdrs.filter(h => h.jenis === 'BEBAN').at(-1).sort_order, true);
  // ubah kelompok: jenis terkunci, ganti nama, nonaktif bila masih ada akun aktif ditolak
  assert.equal((await app.put(`/coa/headers/${ng.data.id}`, { jenis: 'REVENUE' })).status, 400);
  assert.equal((await app.put(`/coa/headers/${ng.data.id}`, { group_account: 'Biaya Baru Sekali' })).status, 200);
  assert.equal((await app.put(`/coa/headers/${ng.data.id}`, { group_account: 'Biaya Trucking' })).status, 400);               // jadi duplikat
  const acc2 = await app.post('/coa', { code: '59990', name: 'AKUN BEBAN UJI', header_id: ng.data.id }); assert.equal(acc2.status, 200);
  r = await app.put(`/coa/headers/${ng.data.id}`, { is_active: false }); assert.equal(r.status, 400); assert.match(r.data.fields.is_active, /1 akun aktif/);
  assert.equal((await app.put(`/coa/${acc2.data.id}`, { is_active: false })).status, 200);
  assert.equal((await app.put(`/coa/headers/${ng.data.id}`, { is_active: false })).status, 200);                              // tidak ada akun aktif -> boleh
  assert.equal((await app.post('/coa', { code: '59991', name: 'AKUN LAIN', header_id: ng.data.id })).status, 400);               // kelompok nonaktif tidak bisa dipakai
  r = await app.put(`/coa/${acc2.data.id}`, { is_active: true }); assert.equal(r.status, 400); assert.match(r.data.fields.is_active, /Aktifkan kelompoknya/);
  assert.equal((await app.put(`/coa/headers/${ng.data.id}`, { is_active: true })).status, 200); assert.equal((await app.put(`/coa/${acc2.data.id}`, { is_active: true })).status, 200);
  assert.equal((await app.put('/coa/headers/999999', { sub_header: 'x' })).status, 404);

  // ekspor Excel mengikuti filter
  const ex = await app.raw('/coa/export?jenis=ASET'); assert.equal(ex.status, 200); assert.match(ex.type, /spreadsheetml/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Account Code', 'Account Name', 'Jenis Account', 'Sub Header', 'Group Account', 'Type JO', 'Status']);
  assert.equal(ws.rowCount, 1 + 31 + 1); assert.equal(ws.getRow(2).getCell(3).value, 'Aset');                                // 31 seed + AKUN BARU (nonaktif) pindah ke Aktiva Tetap
  assert.ok([...Array(ws.rowCount - 1)].some((_, i) => ws.getRow(i + 2).getCell(7).value === 'Nonaktif')); assert.equal(ws.getRow(2).getCell(6).value, 'Semua type');

  // izin: tanpa coa.* = 403; hanya coa.view = baca saja; DELETE tidak ada (403 bahkan untuk Super Admin)
  const mk = async (name, perms) => { const rl = await q('INSERT INTO roles (name) VALUES (?)', [name]); if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [rl.insertId, p])]);
    return (await q("INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)", [name, 'x', name, rl.insertId, name + '@x.id'])).insertId; };
  const as = id => (m, u, b) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, b);
  const none = as(await mk('tanpa', ['jo.view'])), view = as(await mk('lihat', ['coa.view']));
  for (const [m, u] of [['GET', '/coa'], ['GET', '/coa/headers'], ['GET', '/coa/export'], ['POST', '/coa'], ['PUT', '/coa/1'], ['POST', '/coa/headers'], ['PUT', '/coa/headers/1']]) assert.equal((await none(m, u, {})).status, 403, 'tanpa ' + m + u);
  assert.equal((await view('GET', '/coa')).status, 200); assert.equal((await view('GET', '/coa/headers')).status, 200);
  for (const [m, u] of [['GET', '/coa/export'], ['POST', '/coa'], ['PUT', '/coa/1'], ['POST', '/coa/headers'], ['PUT', '/coa/headers/1']]) assert.equal((await view(m, u, {})).status, 403, 'lihat ' + m + u);
  for (const u of ['/coa/1', '/coa/headers/1', '/coa']) { assert.equal((await app.del(u)).status, 403); }
  assert.equal((await q('SELECT COUNT(*) n FROM coa_accounts'))[0].n, 367);                                                  // 365 + 2 akun uji: tidak ada yang terhapus

  // audit
  const acts = await q("SELECT entity_type, action, note FROM audit_log WHERE entity_type IN ('coa','coa_group') ORDER BY id");
  for (const a of ['Dibuat', 'Diubah', 'Dinonaktifkan', 'Diaktifkan']) assert.ok(acts.some(x => x.entity_type === 'coa' && x.action === a), 'coa ' + a);
  assert.ok(acts.some(x => x.entity_type === 'coa_group' && x.action === 'Dibuat') && acts.some(x => x.entity_type === 'coa_group' && /Group Account: Biaya Baru → Biaya Baru Sekali/.test(x.note)));
  assert.ok(acts.some(x => /kelompok: Aset › Aktiva Tetap|nama: AKUN UJI → AKUN BARU/.test(x.note)) && acts.some(x => /kelompok: Aset › Aktiva Lancar → Aset › Aktiva Tetap/.test(x.note)));
});
