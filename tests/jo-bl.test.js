const test = require('node:test'), assert = require('node:assert/strict');
const { startApp, joBody } = require('./app-helper');
const { dbAvailable } = require('./helpers');

test('No. BL unik: ditolak saat buat/ubah JO, tanpa peka huruf besar/kecil dan spasi', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_jobl'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const bl = n => ({ kind: 'BL', number: n }), mk = refs => app.post('/job-orders', joBody({ references: refs }));
  const a = await mk([bl('MAEU 123-45')]); assert.equal(a.status, 200);
  let r = await mk([bl('maeu123-45')]); assert.equal(r.status, 400); assert.match(r.data.error, /No\. BL maeu123-45 sudah dipakai JO .+, tidak bisa diinput lagi/);
  r = await mk([bl('X1'), bl(' x1 ')]); assert.equal(r.status, 400); assert.match(r.data.error, /dua kali/);
  assert.equal((await q("SELECT COUNT(*) n FROM job_orders")).at(0).n, 1);                                                    // penolakan tidak meninggalkan JO setengah jadi
  assert.equal((await mk([{ kind: 'INVOICE', number: 'MAEU 123-45' }])).status, 200);                                         // hanya jenis BL yang dijaga
  const b = await mk([bl('BL-B')]); assert.equal(b.status, 200);
  // ubah: BL milik sendiri boleh tetap; BL baru yang bentrok ditolak; BL lain yang bebas boleh
  const ok = await app.put(`/job-orders/${b.data.id}`, joBody({ references: [bl('BL-B'), bl('BL-C')] })); assert.equal(ok.status, 200);
  r = await app.put(`/job-orders/${b.data.id}`, joBody({ references: [bl('BL-B'), bl('MAEU 123-45')] })); assert.equal(r.status, 400); assert.match(r.data.error, /sudah dipakai JO/);
  // data lama yang sudah ganda tetap bisa diedit selama BL-nya tidak diubah
  await q("INSERT INTO jo_references (jo_id, kind, number) VALUES (?, 'BL', 'BL-B')", [a.data.id]);
  assert.equal((await app.put(`/job-orders/${b.data.id}`, joBody({ references: [bl('BL-B'), bl('BL-C')] }))).status, 200);
});
