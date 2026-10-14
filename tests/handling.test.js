const test = require('node:test'), assert = require('node:assert/strict');
const { dbAvailable } = require('./helpers');
const { startApp, joBody } = require('./app-helper');

const PNG = { filename: 'f.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
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
    assert.equal((await app.patch(`/ho/tickets/${tk}/materials/${mid}/report`, { check_status: 'DAMAGE', remarks: 'penyok' })).data.error, 'Damage wajib minimal 1 foto');
    assert.equal((await app.post(`/ho/tickets/${tk}/materials/${mid}/photos`, PNG)).status, 200);
    assert.equal((await app.patch(`/ho/tickets/${tk}/materials/${mid}/report`, { check_status: 'DAMAGE', remarks: 'penyok' })).status, 200);
    const jo4 = await mkJo();
    const rm = await app.put(`/ho/tickets/${tk}/jos`, { jo_ids: [jo4] });
    assert.equal(rm.status, 400); assert.match(rm.data.error, /tidak bisa dilepas/);
  });

  await t.test('surat jalan: Finish Loading lewat tombol, waktu bisa dikoreksi, PDF A4', async () => {
    const jo = await mkJo(), tk = (await app.post('/ho/tickets', { jo_ids: [jo] })).data.id;
    await app.post(`/ho/tickets/${tk}/materials`, { rows: [mat(jo, 'W-1'), mat(jo, 'W-2')] });
    const rows = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows;
    const sj = await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'b 7 pdf', driver: 'SITI', phone: '0811', items: rows.map(r => ({ material_id: r.id, qty: 1, weight: 1000 })) });
    assert.equal(sj.status, 200);
    const row = async () => (await app.get(`/ho/tickets/${tk}/sj`)).data.rows[0];
    let r = await row(); assert.equal(r.finish_at, null); assert.equal(r.load_min, null);               // Finish Loading belum dicatat otomatis
    assert.equal((await app.post(`/ho/sj/${sj.data.id}/finish`)).status, 200);
    r = await row(); assert.ok(r.finish_at); assert.ok(r.load_min >= 0);
    const bad = await app.put(`/ho/sj/${sj.data.id}`, { nopol: 'B 7 PDF', driver: 'SITI', start_loading: '2026-10-14T05:00:00Z', finish_loading: '2026-10-14T04:00:00Z' });
    assert.equal(bad.status, 400); assert.match(bad.data.error, /tidak boleh lebih awal/);
    const ok = await app.put(`/ho/sj/${sj.data.id}`, { nopol: 'B 7 PDF', driver: 'SITI', start_loading: '2026-10-14T01:00:00Z', finish_loading: '2026-10-14T02:20:00Z' });
    assert.equal(ok.status, 200); r = await row(); assert.equal(r.load_min, 80);
    await app.put(`/ho/sj/${sj.data.id}`, { nopol: 'B 7 PDF', driver: 'SITI', start_loading: '2026-10-14T01:00:00Z', finish_loading: '' });
    assert.equal((await row()).load_min, null);                                                                // finish dikosongkan = belum selesai
    const pdf = await app.raw(`/ho/sj/${sj.data.id}/pdf`);
    assert.equal(pdf.status, 200); assert.equal(pdf.type, 'application/pdf'); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  });

  await t.test('Damage wajib remarks; nomor produk ganda dalam satu JO ditolak; kirim melebihi sisa ditolak', async () => {
    const jo5 = await mkJo(), tk = (await app.post('/ho/tickets', { jo_ids: [jo5] })).data.id;
    await app.post(`/ho/tickets/${tk}/materials`, { rows: [mat(jo5, 'V-1', { qty: 10 })] });
    const dup = await app.post(`/ho/tickets/${tk}/materials`, mat(jo5, 'v-1'));
    assert.equal(dup.status, 400); assert.match(dup.data.error, /sudah ada/);
    const mid = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows[0].id;
    assert.equal((await app.patch(`/ho/tickets/${tk}/materials/${mid}/report`, { check_status: 'DAMAGE' })).status, 400);      // tanpa remarks
    assert.equal((await app.post(`/ho/tickets/${tk}/materials/${mid}/photos`, { filename: 'x.exe', data: 'AAAA' })).status, 400);   // bukan gambar
    const a = await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 1', driver: 'A', items: [{ material_id: mid, qty: 6, weight: 600 }] });
    assert.equal(a.status, 200);
    const over = await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 2', driver: 'B', items: [{ material_id: mid, qty: 5, weight: 500 }] });
    assert.equal(over.status, 400); assert.match(over.data.error, /melebihi sisa \(4\)/);       // pengiriman parsial dijaga
    assert.equal((await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 2', driver: 'B', items: [{ material_id: mid, qty: 4, weight: 400 }] })).status, 200);
    assert.equal((await app.get(`/ho/tickets/${tk}`)).data.del_pct, 100);
  });
});

test('Handling Ops: unduhan Excel, damage report PDF, ZIP per tiket', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), ExcelJS = require('exceljs');
  const app = await startApp('lesat_test_dl');
  t.after(() => app.close());
  const PNG = { filename: 'f.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
  const jo = (await app.post('/job-orders', joBody({ vessel: 'MSC / BEIRA' }))).data.id, tk = (await app.post('/ho/tickets', { jo_ids: [jo] })).data;
  const mat = no => ({ jo_id: jo, product_no: no, description: 'COIL', spec: 'SPCC', net_weight: 1000, gross_weight: 1010, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG' });
  await app.post(`/ho/tickets/${tk.id}/materials`, { rows: [mat('G-1'), mat('D-1'), mat('N-1')] });
  const m = Object.fromEntries((await app.get(`/ho/tickets/${tk.id}/materials`)).data.rows.map(r => [r.product_no, r.id]));
  await app.patch(`/ho/tickets/${tk.id}/materials/${m['G-1']}/report`, { check_status: 'OK' });
  await app.post(`/ho/tickets/${tk.id}/materials/${m['D-1']}/photos`, PNG);
  await app.patch(`/ho/tickets/${tk.id}/materials/${m['D-1']}/report`, { check_status: 'DAMAGE', remarks: 'penyok' });
  const sj = (await app.post(`/ho/tickets/${tk.id}/sj`, { nopol: 'b 1 zip', driver: 'ANI', items: [{ material_id: m['G-1'], qty: 1, weight: 1000 }] })).data;
  await app.post(`/ho/sj/${sj.id}/photos`, PNG);

  await t.test('Excel daftar tiket dan Report Material (xlsx sungguhan)', async () => {
    const a = await app.raw('/ho/tickets/export'); assert.equal(a.status, 200); assert.match(a.type, /spreadsheetml/);
    let wb = new ExcelJS.Workbook(); await wb.xlsx.load(a.buf);
    const ws = wb.getWorksheet('Handling Ops'); assert.equal(ws.getRow(2).getCell('A').value, tk.ticket_no); assert.equal(ws.getRow(1).getCell('H').value, 'Report Material (%)');
    const b = await app.raw(`/ho/tickets/${tk.id}/export`); wb = new ExcelJS.Workbook(); await wb.xlsx.load(b.buf);
    const rm = wb.getWorksheet('Report Material'), rows = [2, 3, 4].map(n => [rm.getRow(n).getCell('C').value, rm.getRow(n).getCell('O').value, rm.getRow(n).getCell('P').value]);
    assert.deepEqual(rows, [['G-1', 'OK', null], ['D-1', 'Damage', 'penyok'], ['N-1', 'Not Checked', null]]);
  });
  await t.test('damage report PDF hanya untuk status Damage dan memuat foto', async () => {
    const ok = await app.raw(`/ho/tickets/${tk.id}/materials/${m['D-1']}/pdf`);
    assert.equal(ok.status, 200); assert.equal(ok.type, 'application/pdf'); assert.equal(ok.buf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await app.raw(`/ho/tickets/${tk.id}/materials/${m['G-1']}/pdf`)).status, 400);
  });
  await t.test('ZIP: struktur folder sesuai requirement', async () => {
    const z = await app.raw(`/ho/tickets/${tk.id}/zip`); assert.equal(z.status, 200); assert.equal(z.type, 'application/zip');
    const f = path.join(os.tmpdir(), `lesat-${Date.now()}.zip`); fs.writeFileSync(f, z.buf);
    let names; try { names = execFileSync('unzip', ['-Z1', f]).toString().trim().split('\n'); } catch { return t.skip('perintah unzip tidak tersedia'); } finally { fs.rmSync(f, { force: true }); }
    assert.ok(names.every(n => n.startsWith(`${tk.ticket_no} - `)), 'semua berkas di bawah folder {No Tiket} - {Customer} - {Kapal}');
    assert.ok(names[0].includes(' - MSC _ BEIRA/'), 'karakter terlarang di nama kapal diganti');
    const rel = names.map(n => n.slice(n.indexOf('/') + 1)).filter(Boolean).sort(), sjDir = `Surat Jalan/${sj.sj_no} - B 1 ZIP`;
    assert.deepEqual(rel, ['Product/D-1 - Damage/', 'Product/D-1 - Damage/damage report.pdf', 'Product/D-1 - Damage/foto-1.png', 'Product/G-1 - Good/', `${sjDir}/`, `${sjDir}/foto-1.png`, `${sjDir}/surat jalan.pdf`].sort());
    assert.ok(!rel.some(n => n.includes('N-1')), 'material belum diperiksa tidak masuk ZIP');
  });
});
