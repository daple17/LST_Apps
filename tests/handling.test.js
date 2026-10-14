const test = require('node:test'), assert = require('node:assert/strict');
const { dbAvailable } = require('./helpers');
const { startApp, joBody } = require('./app-helper');

test('Handling Ops: aturan tiket, progres, penomoran, material', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_ho');
  t.after(() => app.close());
  const mkJo = async () => (await app.post('/job-orders', joBody())).data.id;
  const mat = (jo_id, no, extra = {}) => ({ jo_id, product_no: no, description: 'COIL', net_weight: 1000, gross_weight: 1010, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG', ...extra });

  const jo1 = await mkJo(), jo2 = await mkJo();

  await t.test('nomor tiket: urutan per BULAN + inisial PIC (bukan reset per hari)', async () => {
    const a = await app.post('/ho/tickets', { jo_ids: [jo1] }), b = await app.post('/ho/tickets', { jo_ids: [jo2] });
    assert.equal(a.status, 200);
    const ym = a.data.ticket_no.slice(0, 6), seq = n => n.ticket_no.slice(8, 10);
    assert.match(a.data.ticket_no, /^\d{8}01AD$/); assert.equal(seq(b.data), '02'); assert.equal(b.data.ticket_no.slice(0, 6), ym);
    t.ticketA = a.data.id; t.ticketB = b.data.id;
  });

  await t.test('satu JO hanya di satu tiket AKTIF', async () => {
    const dup = await app.post('/ho/tickets', { jo_ids: [jo1] });
    assert.equal(dup.status, 400); assert.match(dup.data.error, /sudah ada di tiket aktif/);
    const browse = await app.get(`/ho/browse-jo?q=${encodeURIComponent('')}`);
    assert.ok(!browse.data.some(j => j.id === jo1 || j.id === jo2), 'JO di tiket aktif tidak ditawarkan di Browse Data');
  });

  await t.test('progres: tab memakai nilai terendah; tiket 100% membebaskan JO-nya', async () => {
    const m = await app.post(`/ho/tickets/${t.ticketA}/materials`, { rows: [mat(jo1, 'T-1'), mat(jo1, 'T-2')] });
    assert.equal(m.status, 200);
    let tk = (await app.get(`/ho/tickets/${t.ticketA}`)).data;
    assert.deepEqual([tk.mat_pct, tk.del_pct, tk.prog], [0, 0, 0]);
    const list = (await app.get('/ho/tickets')).data.rows;
    // periksa semua material -> report 100%, tetapi pengiriman 0% => progres = 0 (nilai terendah), tiket belum selesai
    const rows = (await app.get(`/ho/tickets/${t.ticketA}/materials`)).data.rows;
    for (const r of rows) assert.equal((await app.patch(`/ho/tickets/${t.ticketA}/materials/${r.id}/report`, { check_status: 'OK' })).status, 200);
    tk = (await app.get(`/ho/tickets/${t.ticketA}`)).data;
    assert.deepEqual([tk.mat_pct, tk.del_pct, tk.prog], [100, 0, 0]); assert.equal(tk.done_at, null);
    assert.ok(list.length >= 2);
    // kirim semua -> 100% keduanya -> selesai
    const sj = await app.post(`/ho/tickets/${t.ticketA}/sj`, { nopol: 'b 1 x', driver: 'BUDI', items: rows.map(r => ({ material_id: r.id, qty: 1, weight: 1000 })) });
    assert.equal(sj.status, 200); assert.match(sj.data.sj_no, /^\d{6}0001$/);
    tk = (await app.get(`/ho/tickets/${t.ticketA}`)).data;
    assert.deepEqual([tk.mat_pct, tk.del_pct, tk.prog], [100, 100, 100]); assert.ok(tk.done_at);
    // JO dari tiket yang sudah selesai boleh masuk tiket baru
    const again = await app.post('/ho/tickets', { jo_ids: [jo1] });
    assert.equal(again.status, 200);
  });

  await t.test('JO yang sudah diperiksa/dikirim tidak bisa dilepas dari tiket aktif', async () => {
    const jo3 = await mkJo();
    const tk = (await app.post('/ho/tickets', { jo_ids: [jo3] })).data.id;
    await app.post(`/ho/tickets/${tk}/materials`, { rows: [mat(jo3, 'U-1')] });
    const mid = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows[0].id;
    await app.patch(`/ho/tickets/${tk}/materials/${mid}/report`, { check_status: 'DAMAGE', remarks: 'penyok' });
    const jo4 = await mkJo();
    const rm = await app.put(`/ho/tickets/${tk}/jos`, { jo_ids: [jo4] });
    assert.equal(rm.status, 400); assert.match(rm.data.error, /tidak bisa dilepas/);
  });

  await t.test('Damage wajib remarks; nomor produk ganda dalam satu JO ditolak; kirim melebihi sisa ditolak', async () => {
    const jo5 = await mkJo(), tk = (await app.post('/ho/tickets', { jo_ids: [jo5] })).data.id;
    await app.post(`/ho/tickets/${tk}/materials`, { rows: [mat(jo5, 'V-1', { qty: 10 })] });
    const dup = await app.post(`/ho/tickets/${tk}/materials`, mat(jo5, 'v-1'));
    assert.equal(dup.status, 400); assert.match(dup.data.error, /sudah ada/);
    const mid = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows[0].id;
    assert.equal((await app.patch(`/ho/tickets/${tk}/materials/${mid}/report`, { check_status: 'DAMAGE' })).status, 400);
    const a = await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 1', driver: 'A', items: [{ material_id: mid, qty: 6, weight: 600 }] });
    assert.equal(a.status, 200);
    const over = await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 2', driver: 'B', items: [{ material_id: mid, qty: 5, weight: 500 }] });
    assert.equal(over.status, 400); assert.match(over.data.error, /melebihi sisa \(4\)/);       // pengiriman parsial dijaga
    assert.equal((await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 2', driver: 'B', items: [{ material_id: mid, qty: 4, weight: 400 }] })).status, 200);
    assert.equal((await app.get(`/ho/tickets/${tk}`)).data.del_pct, 100);
  });
});
