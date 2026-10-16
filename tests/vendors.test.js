const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), ExcelJS = require('exceljs'), cfg = require('../config');
const { startApp, joBody } = require('./app-helper');
const { dbAvailable } = require('./helpers');

test('API vendor: daftar, kode otomatis, kunci kode, nonaktif, hapus, ekspor, izin', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_vendors'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const seeded = (await q('SELECT COUNT(*) n FROM vendors'))[0].n;
  let d = (await app.get('/vendors')).data; assert.equal(d.summary.total, seeded); assert.deepEqual([d.summary.inactive, d.summary.review], [0, 0]); assert.ok(d.rows.every(v => v.is_active === true && typeof v.sj_count === 'number'));
  const cid = (await q("INSERT INTO countries (name) VALUES ('Indonesia')")).insertId; assert.deepEqual((await app.get('/vendors/countries')).data, [{ id: cid, name: 'Indonesia' }]);

  for (const [b, f] of [[{ name: '' }, 'name'], [{ name: 'A' }, 'name'], [{ name: 'PT BARU', city: 'x'.repeat(101) }, 'city'], [{ name: 'PT BARU', country_id: 999999 }, 'country_id'], [{ name: 'PT BARU', code: '!' }, 'code'], [{ name: d.rows[0].name.toLowerCase() }, 'name']]) {
    const r = await app.post('/vendors', b); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.data.fields[f], f);
  }
  const a = await app.post('/vendors', { name: 'PT Mitra Angkut Jaya', city: 'Bekasi', pic: 'Budi', npwp: '01.234', country_id: cid }); assert.equal(a.status, 200); assert.match(a.data.code, /^[A-Z0-9]{2,10}$/);
  const b2 = await app.post('/vendors', { name: 'CV Mitra Antar Jaya' }); assert.equal(b2.status, 200); assert.notEqual(b2.data.code, a.data.code);
  const got = (await app.get(`/vendors/${a.data.id}`)).data; assert.deepEqual([got.city, got.pic, got.is_active, got.needs_code_review, got.sj_count], ['Bekasi', 'Budi', true, false, 0]);
  const par = await Promise.all([1, 2, 3, 4].map(i => app.post('/vendors', { name: 'Alfa Beta Gamma ' + i }))); assert.ok(par.every(x => x.status === 200)); assert.equal(new Set(par.map(x => x.data.code)).size, 4);
  assert.equal((await app.post('/vendors', { name: 'PT MITRA ANGKUT JAYA' })).status, 400);
  assert.equal((await app.post('/vendors', { name: 'Manual Satu', code: 'zz9' })).data.code, 'ZZ9'); assert.ok((await app.post('/vendors', { name: 'Manual Dua', code: 'ZZ9' })).data.fields.code);
  assert.notEqual((await app.get('/vendors/suggest-code?name=PT Mitra Angkut Jaya')).data.code, a.data.code);

  let r = await app.put(`/vendors/${a.data.id}`, { name: 'PT Mitra Angkut Jaya', code: 'XYZ' }); assert.equal(r.status, 400); assert.match(r.data.fields.code, /tidak bisa diubah/);
  assert.equal((await app.put(`/vendors/${a.data.id}`, { name: 'PT Mitra Angkut Jaya', code: a.data.code.toLowerCase(), city: 'Jakarta' })).status, 200);
  assert.equal((await app.get(`/vendors/${a.data.id}`)).data.city, 'Jakarta');
  assert.equal((await app.put(`/vendors/${a.data.id}`, { name: 'CV Mitra Antar Jaya' })).status, 400);
  assert.equal((await app.put('/vendors/999999', { name: 'Tidak Ada' })).status, 404);
  await q('UPDATE vendors SET needs_code_review=1 WHERE id=?', [b2.data.id]); assert.equal((await app.get('/vendors')).data.summary.review, 1); assert.equal((await app.get('/vendors?status=review')).data.total, 1);
  assert.equal((await app.put(`/vendors/${b2.data.id}`, { name: 'CV Mitra Antar Jaya', needs_code_review: true })).status, 200); assert.equal((await app.get(`/vendors/${b2.data.id}`)).data.needs_code_review, true);
  assert.equal((await app.put(`/vendors/${b2.data.id}`, { name: 'CV Mitra Antar Jaya', needs_code_review: false })).status, 200); assert.equal((await app.get(`/vendors/${b2.data.id}`)).data.needs_code_review, false);
  assert.deepEqual((await app.get('/vendors?q=angkut')).data.rows.map(v => v.code), [a.data.code]);

  // dipakai surat jalan: tidak bisa dihapus, hanya dinonaktifkan; nonaktif hilang dari pilihan aktif
  const cn = await app.pool.getConnection();
  try { await cn.query('SET FOREIGN_KEY_CHECKS=0'); await cn.query('INSERT INTO delivery_notes (no_sj, ticket_id, vendor_id, nopol, driver) VALUES (?,?,?,?,?)', ['SJ-TEST-1', 0, a.data.id, 'B 1 XX', 'Budi']); await cn.query('SET FOREIGN_KEY_CHECKS=1'); } finally { cn.release(); }
  assert.equal((await app.get('/vendors?q=angkut')).data.rows[0].sj_count, 1);
  r = await app.del(`/vendors/${a.data.id}`); assert.equal(r.status, 400); assert.match(r.data.error, /1 surat jalan.*Nonaktifkan/);
  assert.equal((await app.post(`/vendors/${a.data.id}/deactivate`)).status, 200); assert.equal((await app.get('/lookups')).data.vendors.find(v => v.id === a.data.id).is_active, false);
  assert.equal((await app.get('/vendors?status=inactive')).data.total, 1); assert.equal((await app.post(`/vendors/${a.data.id}/activate`)).status, 200);
  assert.equal((await app.del(`/vendors/${b2.data.id}`)).status, 200); assert.equal((await app.get(`/vendors/${b2.data.id}`)).status, 404); assert.equal((await app.del('/vendors/999999')).status, 404);

  // tarif: daftar per kota + tonase + ritase (satu angka per vendor); dijumlahkan di menu PO nanti
  const R = (city, pc) => ({ city, price_city: pc }), put = b => app.put(`/vendors/${a.data.id}`, { name: 'PT Mitra Angkut Jaya', ...b }), rates = async () => (await app.get(`/vendors/${a.data.id}`)).data;
  for (const [b, f] of [[{ rates: [R('', 1)] }, 'rates.0.city'], [{ rates: [R('A', 0)] }, 'rates.0.price_city'], [{ rates: [R('A', 'x')] }, 'rates.0.price_city'], [{ rates: [R('A', 1), R('a ', 2)] }, 'rates.1.city'], [{ rates: 'x' }, 'rates'], [{ price_ton: -1 }, 'price_ton'], [{ price_trip: 'x' }, 'price_trip']]) {
    const x = await put(b); assert.equal(x.status, 400, f); assert.ok(x.data.fields[f], f);
  }
  let g = await rates(); assert.deepEqual([g.rates.length, g.price_ton, g.price_trip], [0, 0, 0]);
  assert.equal((await put({ rates: [R('Cikarang', 1500000), R('Bekasi', 900000.5)], price_ton: 85000.5, price_trip: 250000 })).status, 200);
  g = await rates(); assert.deepEqual(g.rates, [R('Bekasi', 900000.5), R('Cikarang', 1500000)]); assert.deepEqual([g.rate_count, g.price_ton, g.price_trip], [2, 85000.5, 250000]);
  assert.equal((await put({ city: 'Jakarta' })).status, 200); g = await rates(); assert.deepEqual([g.rates.length, g.price_ton, g.price_trip], [2, 85000.5, 250000]);        // tanpa field tarif: tidak berubah
  assert.equal((await put({ rates: [R('Cikarang', 1600000)], price_trip: '' })).status, 200); g = await rates(); assert.deepEqual([g.rates, g.price_ton, g.price_trip], [[R('Cikarang', 1600000)], 85000.5, 0]);
  const nv = await app.post('/vendors', { name: 'Vendor Dengan Tarif', price_ton: 50000, rates: [R('Karawang', 700000)] }); assert.equal(nv.status, 200); const ng = (await app.get(`/vendors/${nv.data.id}`)).data; assert.deepEqual([ng.rates[0].city, ng.price_ton, ng.price_trip], ['Karawang', 50000, 0]);
  assert.equal((await app.post('/vendors', { name: 'Vendor Tarif Salah', rates: [R('X', 0)] })).status, 400); assert.equal((await q("SELECT COUNT(*) n FROM vendors WHERE name='Vendor Tarif Salah'"))[0].n, 0);
  assert.equal((await put({ rates: [] })).status, 200); assert.equal((await rates()).rate_count, 0);

  const acts = (await q("SELECT action FROM audit_log WHERE entity_type='vendor'")).map(x => x.action); for (const x of ['Dibuat', 'Diubah', 'Dinonaktifkan', 'Diaktifkan', 'Dihapus', 'Tarif diubah']) assert.ok(acts.includes(x), x);

  const ex = await app.raw('/vendors/export?q=angkut'); assert.equal(ex.status, 200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Kode', 'Nama', 'Kota', 'Negara', 'PIC', 'NPWP', 'Surat Jalan', 'Status']); assert.equal(ws.rowCount, 2); assert.equal(ws.getRow(2).getCell(1).value, a.data.code);

  const mk = async (name, perms) => { const rl = (await q('INSERT INTO roles (name) VALUES (?)', [name])).insertId; if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [rl, p])]); return (await q('INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)', [name, 'x', name, rl, name + '@x.id'])).insertId; };
  const as = id => (m, u, bd) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, bd), none = as(await mk('tanpa', ['jo.view'])), view = as(await mk('lihat', ['vendor.view']));
  const all = [['GET', '/vendors'], ['GET', '/vendors/1'], ['GET', '/vendors/export'], ['GET', '/vendors/suggest-code?name=x'], ['POST', '/vendors'], ['PUT', '/vendors/1'], ['POST', '/vendors/1/deactivate'], ['DELETE', '/vendors/1']];
  for (const [m, u] of all) assert.equal((await none(m, u, {})).status, 403, 'tanpa ' + m + u);
  assert.equal((await view('GET', '/vendors')).status, 200);
  for (const [m, u] of all.filter(x => !(x[0] === 'GET' && /^\/vendors(\/1)?$/.test(x[1])))) assert.equal((await view(m, u, {})).status, 403, 'lihat ' + m + u);
});
