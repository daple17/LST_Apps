const test = require('node:test'), assert = require('node:assert/strict');
const { dbAvailable } = require('./helpers');
const { startApp, joBody } = require('./app-helper');
const IdFmt = require('../lib/idfmt'), fmt = require('../lib/format');

const day = n => IdFmt.jktDay(new Date(Date.now() + n * 86400000));

test('mergeParty: jumlah per satuan, urutan kemunculan, teks bebas apa adanya', () => {
  assert.equal(fmt.mergeParty([{ qty: 12, unit: '20FT' }, { qty: 11, unit: '20FT' }]), '23x20ft');
  assert.equal(fmt.mergeParty([{ qty: 300, unit: 'COIL' }, { qty: 12, unit: '40FT' }, { qty: 100, unit: 'COIL' }]), '400 CL + 12x40ft');
  assert.equal(fmt.mergeParty([{ qty: null, unit: null, party_text: '590 BE' }, { qty: 5, unit: 'COIL' }]), '5 CL + 590 BE');
  assert.equal(fmt.mergeParty([]), '');
});

test('Home: kartu Upcoming Plan, Handling Ops, halaman Rencana delivery', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_home');
  t.after(() => app.close());
  const sql = (s, p) => app.pool.query(s, p);
  let seq = 0;
  const jo = (o = {}) => sql('INSERT INTO job_orders (no_jo, type, customer_id, vessel, eta_etd, delivery_plan, qty, unit, weight_kg, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [`T${String(++seq).padStart(4, '0')}USC`, o.type || 'IMPORT', o.customer || 1, o.vessel === undefined ? 'MV ' + seq : o.vessel, o.eta === undefined ? day(2) : o.eta, day(9), o.qty ?? 10, o.unit || 'COIL', o.kg ?? 1000, o.status || 'NOT_COMP']).then(r => r[0].insertId);

  await t.test('Upcoming Plan: filter, gabung vessel+customer+tanggal, urutan tanggal terdekat', async () => {
    const a1 = await jo({ vessel: 'MV ALPHA', eta: day(3), qty: 12, unit: '20FT', kg: 10000 });
    await jo({ vessel: 'MV ALPHA', eta: day(3), qty: 11, unit: '20FT', kg: 5500 });          // digabung dengan a1
    await jo({ vessel: 'MV BETA', customer: 2, eta: day(0), qty: 300, unit: 'COIL', kg: 2760860 }); // hari ini ikut
    await jo({ vessel: 'MV GAMMA', type: 'EXPORT', eta: day(1) });                            // ETD (Export) ikut
    await jo({ vessel: 'MV LAMA', eta: day(-1) });                                            // sudah lewat
    await jo({ vessel: 'MV DONE', eta: day(4), status: 'COMPLETE' });                         // Complete
    await jo({ vessel: 'MV TANPA ETA', eta: null });                                          // tanpa ETA
    await jo({ vessel: 'MV ALPHA', customer: 2, eta: day(3) });                               // customer lain = baris terpisah
    const d = (await app.get('/home/upcoming')).data;
    assert.deepEqual(d.rows.map(x => x.vessel), ['MV BETA', 'MV GAMMA', 'MV ALPHA', 'MV ALPHA']);
    assert.equal(d.total, 4);
    const alpha = d.rows.find(x => x.vessel === 'MV ALPHA' && x.jo_count === 2);
    assert.deepEqual([alpha.party, alpha.weight, alpha.jo_id, alpha.customer], ['23x20ft', 15.5, a1, 'PT UNITED STEEL SERVICE INDONESIA']);
    const beta = d.rows[0]; assert.deepEqual([beta.party, beta.weight, beta.eta_etd], ['300 CL', 2760.86, day(0)]);
  });

  await t.test('Upcoming Plan: maksimal 8 baris di kartu, total jujur; halaman penuh memakai filter tanggal dan paginasi', async () => {
    for (let i = 0; i < 24; i++) await jo({ vessel: `MV BANYAK ${i}`, eta: day(10 + i) });
    const c = (await app.get('/home/upcoming')).data;
    assert.equal(c.rows.length, 8); assert.equal(c.total, 28);
    const p1 = (await app.get('/home/plan')).data, p2 = (await app.get('/home/plan?page=2')).data;
    assert.deepEqual([p1.rows.length, p1.total, p1.pages, p2.rows.length], [20, 28, 2, 8]);
    const f = (await app.get(`/home/plan?from=${day(10)}&to=${day(12)}`)).data;
    assert.deepEqual(f.rows.map(x => x.vessel), ['MV BANYAK 0', 'MV BANYAK 1', 'MV BANYAK 2']);
    assert.deepEqual((await app.get(`/home/plan?from=${day(-1)}&to=${day(0)}`)).data.rows.map(x => x.vessel), ['MV LAMA', 'MV BETA']);   // rentang lampau dibolehkan lewat filter
  });

  await t.test('Handling Ops: hanya tiket progres < 100%, terbaru di atas, nama depan PIC, progres benar', async () => {
    const mk = async () => { const j = (await app.post('/job-orders', joBody())).data.id; const tk = (await app.post('/ho/tickets', { jo_ids: [j] })).data;
      await app.post(`/ho/tickets/${tk.id}/materials`, { rows: [{ jo_id: j, product_no: 'H-1', description: 'C', net_weight: 1, gross_weight: 1, qty: 1, unit: 'COIL', origin: 'A', destination: 'B' }, { jo_id: j, product_no: 'H-2', description: 'C', net_weight: 1, gross_weight: 1, qty: 1, unit: 'COIL', origin: 'A', destination: 'B' }] });
      return { ...tk, j }; };
    const t1 = await mk(), t2 = await mk(), t3 = await mk();
    const mats = async id => (await app.get(`/ho/tickets/${id}/materials`)).data.rows;
    const m1 = await mats(t1.id);
    await app.patch(`/ho/tickets/${t1.id}/materials/${m1[0].id}/report`, { check_status: 'OK' });             // t1: report 50%
    for (const m of await mats(t3.id)) await app.patch(`/ho/tickets/${t3.id}/materials/${m.id}/report`, { check_status: 'OK' });
    await app.post(`/ho/tickets/${t3.id}/sj`, { nopol: 'B 1 X', driver: 'A', items: (await mats(t3.id)).map(m => ({ material_id: m.id, qty: 1, weight: 1 })) });   // t3 selesai 100%
    const d = (await app.get('/home/tickets')).data;
    assert.deepEqual(d.rows.map(x => x.ticket_no), [t2.ticket_no, t1.ticket_no]);       // t3 selesai tidak tampil; t2 dibuat setelah t1
    assert.equal(d.total, 2);
    const r1 = d.rows[1]; assert.deepEqual([r1.mat_pct, r1.del_pct, r1.pic], [50, 0, 'Administrator']);
    assert.ok(Array.isArray(r1.customers) && r1.customers.length === 1);
  });
});
