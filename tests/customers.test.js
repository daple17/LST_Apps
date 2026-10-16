const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), ExcelJS = require('exceljs'), cfg = require('../config');
const { suggestCode, words, candidates, CODE_RE } = require('../lib/customer-code');
const { startApp, joBody } = require('./app-helper');
const { dbAvailable } = require('./helpers');

test('kode customer otomatis: inisial, tanpa badan usaha, bentrok', () => {
  const t = new Set();
  assert.deepEqual(words('PT. Berkah  Trans-Utama, Tbk'), ['BERKAH', 'TRANS', 'UTAMA']);
  assert.equal(suggestCode('PT BERKAH TRANS UTAMA', t), 'BTU'); assert.equal(suggestCode('PT UNITED STEEL SERVICE INDONESIA', t), 'USS'); assert.equal(suggestCode('CT ADVANCE TECHNOLOGY', t), 'CAT');
  assert.equal(suggestCode('FADLAN', t), 'FAD'); assert.equal(suggestCode('MR', t), 'MRX'); assert.equal(suggestCode('PT SUMBER ABADI', t), 'SAU'); assert.equal(suggestCode('Ünited Café', t), 'UCN');   // huruf beraksen dinormalkan
  assert.equal(suggestCode('', t), 'CST'); assert.equal(suggestCode('1234 5678', t), 'CST'); assert.equal(suggestCode('PT CV UD', t), 'CST');
  // bentrok: kode berikutnya tetap 3 huruf, deterministik, dan tidak memakai kode yang terpakai
  const taken = new Set(['BTU']); const c2 = suggestCode('PT BERKAH TRANS UTAMA', taken); assert.notEqual(c2, 'BTU'); assert.match(c2, CODE_RE); assert.equal(c2, suggestCode('PT BERKAH TRANS UTAMA', taken));
  taken.add(c2); const c3 = suggestCode('PT BERKAH TRANS UTAMA', taken); assert.ok(![...taken].includes(c3));
  // kode lama non-3-huruf tidak mengganggu; banyak bentrok tetap menemukan kode
  const many = new Set(); for (let i = 0; i < 400; i++) { const c = suggestCode('PT ABC DEF GHI', many); assert.match(c, CODE_RE); assert.ok(!many.has(c)); many.add(c); }
  assert.equal(candidates('PT A B C')[0], 'ABC');
});

test('API customer: daftar, kode otomatis, kunci kode, nonaktif, hapus, ekspor, izin', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_customers'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const seeded = (await q('SELECT COUNT(*) n FROM customers'))[0].n;
  let d = (await app.get('/customers')).data; assert.equal(d.summary.total, seeded); assert.deepEqual([d.summary.inactive, d.summary.review], [0, 0]); assert.ok(d.rows.every(c => c.is_active === true && typeof c.jo_count === 'number'));

  // validasi
  for (const [b, f] of [[{ name: '' }, 'name'], [{ name: 'A' }, 'name'], [{ name: 'PT BARU', email: 'bukan-email' }, 'email'], [{ name: 'PT BARU', phone: 'x'.repeat(51) }, 'phone'], [{ name: 'PT BARU', code: 'AB' }, 'code'], [{ name: d.rows[0].name.toLowerCase() }, 'name']]) {
    const r = await app.post('/customers', b); assert.equal(r.status, 400, JSON.stringify(b)); assert.ok(r.data.fields[f], f);
  }
  // kode otomatis, unik, dua nama berinisial sama mendapat kode berbeda
  const a = await app.post('/customers', { name: 'PT Sumber Abadi Jaya', city: 'Bekasi', email: 'Info@Sumber.ID', phone: '021', tax_no: '01.234', address: 'Jl. A' }); assert.equal(a.status, 200); assert.match(a.data.code, CODE_RE);
  const b2 = await app.post('/customers', { name: 'CV Sinar Antar Jaya' }); assert.equal(b2.status, 200); assert.notEqual(b2.data.code, a.data.code); assert.match(b2.data.code, CODE_RE);
  const got = (await app.get(`/customers/${a.data.id}`)).data; assert.deepEqual([got.email, got.city, got.is_active, got.needs_code_review, got.jo_count], ['info@sumber.id', 'Bekasi', true, false, 0]);
  const par = await Promise.all(['Alfa Beta Gamma 1', 'Alfa Beta Gamma 2', 'Alfa Beta Gamma 3', 'Alfa Beta Gamma 4'].map(name => app.post('/customers', { name })));            // pembuatan bersamaan
  assert.ok(par.every(x => x.status === 200)); assert.equal(new Set(par.map(x => x.data.code)).size, 4);
  assert.equal((await app.post('/customers', { name: 'PT SUMBER ABADI JAYA' })).status, 400);                              // nama ganda (tak peka huruf besar/kecil)
  // kode manual (pemanggil lama): hanya 3 huruf dan unik
  assert.equal((await app.post('/customers', { name: 'Manual Satu', code: 'zzz' })).data.code, 'ZZZ'); const dup = await app.post('/customers', { name: 'Manual Dua', code: 'ZZZ' }); assert.equal(dup.status, 400); assert.ok(dup.data.fields.code);
  assert.equal((await app.get('/customers/suggest-code?name=PT Sumber Abadi Jaya')).data.code !== a.data.code, true);        // usulan menghindari kode yang sudah dipakai
  assert.match((await app.get('/customers/suggest-code?name=Zebra Zulu Zeta')).data.code, CODE_RE);

  // ubah: kode terkunci
  let r = await app.put(`/customers/${a.data.id}`, { name: 'PT Sumber Abadi Jaya', code: 'XYZ' }); assert.equal(r.status, 400); assert.match(r.data.fields.code, /tidak bisa diubah/);
  assert.equal((await app.put(`/customers/${a.data.id}`, { name: 'PT Sumber Abadi Jaya', code: a.data.code.toLowerCase(), city: 'Jakarta' })).status, 200);
  assert.deepEqual([(await app.get(`/customers/${a.data.id}`)).data.city, (await app.get(`/customers/${a.data.id}`)).data.code], ['Jakarta', a.data.code]);
  assert.equal((await app.put(`/customers/${a.data.id}`, { name: 'CV Sinar Antar Jaya' })).status, 400);                // nama dipakai customer lain
  assert.equal((await app.put('/customers/999999', { name: 'Tidak Ada' })).status, 404);
  // tanda "kode perlu ditinjau": hanya bisa dihapus, bukan dipasang
  await q('UPDATE customers SET needs_code_review=1 WHERE id=?', [b2.data.id]); assert.equal((await app.get('/customers')).data.summary.review, 1); assert.equal((await app.get('/customers?status=review')).data.total, 1);
  assert.equal((await app.put(`/customers/${b2.data.id}`, { name: 'CV Sinar Antar Jaya', needs_code_review: true })).status, 200); assert.equal((await app.get(`/customers/${b2.data.id}`)).data.needs_code_review, true);
  assert.equal((await app.put(`/customers/${b2.data.id}`, { name: 'CV Sinar Antar Jaya', needs_code_review: false })).status, 200); assert.equal((await app.get(`/customers/${b2.data.id}`)).data.needs_code_review, false);

  // cari + filter status
  assert.deepEqual((await app.get('/customers?q=sumber')).data.rows.map(c => c.code), [a.data.code]); assert.equal((await app.get(`/customers?q=${a.data.code}`)).data.rows[0].id, a.data.id);
  // JO: customer nonaktif tidak bisa dipakai JO baru, JO lama tetap; hapus hanya bila belum dipakai
  const jo = await app.post('/job-orders', joBody({ customer_id: a.data.id })); assert.equal(jo.status, 200); assert.match(jo.data.no_jo, new RegExp(`${a.data.code}$`));       // nomor JO memakai kode otomatis
  assert.equal((await app.get('/customers?q=Sumber')).data.rows[0].jo_count, 1);
  assert.equal((await app.post(`/customers/${a.data.id}/deactivate`)).status, 200);
  assert.equal((await app.get('/lookups')).data.customers.find(c => c.id === a.data.id).is_active, false);
  r = await app.post('/job-orders', joBody({ customer_id: a.data.id })); assert.equal(r.status, 400); assert.match(r.data.error, /nonaktif/);
  assert.equal((await app.get(`/job-orders/${jo.data.id}`)).status, 200);
  r = await app.del(`/customers/${a.data.id}`); assert.equal(r.status, 400); assert.match(r.data.error, /1 Job Order.*Nonaktifkan/);
  assert.equal((await app.get('/customers?status=inactive')).data.total, 1); assert.equal((await app.post(`/customers/${a.data.id}/activate`)).status, 200);
  assert.equal((await app.post('/job-orders', joBody({ customer_id: a.data.id }))).status, 200);
  assert.equal((await app.del(`/customers/${b2.data.id}`)).status, 200); assert.equal((await app.get(`/customers/${b2.data.id}`)).status, 404); assert.equal((await app.del('/customers/999999')).status, 404);
  // audit
  const acts = (await q("SELECT action, note FROM audit_log WHERE entity_type='customer' ORDER BY id")).map(x => x.action); for (const x of ['Dibuat', 'Diubah', 'Dinonaktifkan', 'Diaktifkan', 'Dihapus']) assert.ok(acts.includes(x), x);
  assert.ok((await q("SELECT 1 FROM audit_log WHERE entity_type='customer' AND note LIKE '%kota: Bekasi → Jakarta%'")).length === 1);

  // Excel mengikuti filter
  const ex = await app.raw('/customers/export?q=sumber'); assert.equal(ex.status, 200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Kode', 'Nama', 'Kota', 'Telepon', 'Email', 'NPWP', 'Alamat', 'Job Order', 'Status']); assert.equal(ws.rowCount, 2); assert.equal(ws.getRow(2).getCell(1).value, a.data.code);

  // izin
  const mk = async (name, perms) => { const rl = (await q('INSERT INTO roles (name) VALUES (?)', [name])).insertId; if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [rl, p])]); return (await q('INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)', [name, 'x', name, rl, name + '@x.id'])).insertId; };
  const as = id => (m, u, bd) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, bd), none = as(await mk('tanpa', ['jo.view'])), view = as(await mk('lihat', ['customer.view']));
  for (const [m, u] of [['GET', '/customers'], ['GET', '/customers/1'], ['GET', '/customers/export'], ['GET', '/customers/suggest-code?name=x'], ['POST', '/customers'], ['PUT', '/customers/1'], ['POST', '/customers/1/deactivate'], ['DELETE', '/customers/1']]) assert.equal((await none(m, u, {})).status, 403, 'tanpa ' + m + u);
  assert.equal((await view('GET', '/customers')).status, 200); assert.equal((await view('GET', `/customers/${a.data.id}`)).status, 200);
  for (const [m, u] of [['GET', '/customers/export'], ['GET', '/customers/suggest-code?name=x'], ['POST', '/customers'], ['PUT', '/customers/1'], ['POST', '/customers/1/deactivate'], ['DELETE', '/customers/1']]) assert.equal((await view(m, u, {})).status, 403, 'lihat ' + m + u);
});
