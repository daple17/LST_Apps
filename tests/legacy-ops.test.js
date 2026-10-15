// Data lama bisa dioperasikan: validasi hanya kolom yang berubah, lencana/filter, relink surat jalan, aman terhadap NULL.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('node:http'), jwt = require('jsonwebtoken');
const cfg = require('../config');
const { migrate } = require('../lib/migrate');
const { seedMaster, createApp } = require('../server');
const { freshDb, dbAvailable } = require('./helpers');
const { run } = require('../scripts/legacy-import');
const MV = require('../lib/material-validate'), JV = require('../lib/jo-validate');

test('validasi parsial: fungsi murni', () => {
  const cur = { jenis_muatan: null, type_bc: null, vessel: null, eta_etd: null, delivery_plan: null, container_count: null, container_type: null, weight_kg: '1735810.00', qty: 3, unit: 'CARTON', party_text: null };
  const same = { ...cur, weight_kg: 1735810 };
  assert.equal(JV.changedFields(same, cur, undefined, []).size, 0);
  assert.deepEqual([...JV.changedFields({ ...same, vessel: 'KAPAL' }, cur, undefined, [])], ['vessel']);
  assert.ok(JV.changedFields({ ...same, weight_kg: 1735812 }, cur, undefined, []).size === 0);                    // selisih pembulatan form (<= 5 kg) bukan perubahan
  assert.ok(JV.changedFields({ ...same, weight_kg: 1735900 }, cur, undefined, []).has('weight'));
  assert.deepEqual([...JV.changedFields(same, cur, [{ kind: 'AJU', number: 'A1' }], [])], ['AJU']);              // referensi berubah
  assert.equal(JV.changedFields(same, cur, [{ kind: 'AJU', number: 'A1' }], [{ kind: 'AJU', number: 'A1' }]).size, 0);
  const full = JV.validateJo({ type: 'IMPORT', customer_id: 1, references: [] }), part = JV.validateJo({ type: 'IMPORT', customer_id: 1, references: [] }, { only: new Set(['vessel']) });
  assert.ok(full.length > 5); assert.deepEqual(part.map(e => e.field), ['vessel']);
  const m = MV.normalize({ product_no: 'A', description: 'D', unit: 'COIL', qty: 0, net_weight: 1, gross_weight: 1, origin: '', destination: '' }), curM = { product_no: 'A', description: 'D', unit: 'COIL', qty: 0, net_weight: '1.00', gross_weight: '1.00', origin: null, destination: null, kondisi: 'INTACT', spec: null, shape: null, thickness: null, width: null };
  assert.equal(MV.changedKeys(m, curM).size, 0); assert.ok(MV.validate(m).errors.length >= 3); assert.deepEqual(MV.validate(m, { only: MV.changedKeys(m, curM) }).errors, []);
  assert.deepEqual(MV.validate({ ...m, description: null }, { only: MV.changedKeys({ ...m, description: null }, curM) }).errors, ['Description wajib diisi']);
});

test('data lama: edit sebagian, lencana, filter, relink, NULL-safe', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const SRC = 'lesat_test_legacy_src2', DST = 'lesat_test_legacy_ops';
  const src = await freshDb(SRC), dst = await freshDb(DST);
  await src.query(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-mini.sql'), 'utf8'));
  await migrate(dst); await seedMaster(dst); await dst.query('DELETE FROM customers'); await dst.query('DELETE FROM vendors'); await dst.query('DELETE FROM shippers');
  const rep = fs.mkdtempSync(path.join(os.tmpdir(), 'lesat-rep-'));
  await run(['--lokal', '--commit', `--legacy-host=${cfg.db.host}`, `--legacy-port=${cfg.db.port}`, `--legacy-user=${cfg.db.user}`, `--legacy-pass=${cfg.db.password}`, `--legacy-db=${SRC}`, `--report-dir=${rep}`], { log: () => {}, target: { ...cfg.db, database: DST } });
  const q = async (s, p) => (await dst.query(s, p))[0];
  const server = http.createServer(createApp(dst)); await new Promise(r => server.listen(0, r));
  t.after(async () => { await new Promise(r => server.close(r)); await src.end(); await dst.end(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = id => async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ id }, cfg.secret) }, body: body && JSON.stringify(body) }); const tx = await r.text(); let data; try { data = JSON.parse(tx); } catch { data = tx; } return { status: r.status, data, r }; };
  const adminId = (await q("SELECT id FROM users WHERE username='admin'"))[0].id, A = as(adminId);
  const jo = Object.fromEntries((await q('SELECT id, no_jo FROM job_orders')).map(x => [x.no_jo, x.id]));

  // lencana + filter
  let l = (await A('GET', '/job-orders')).data; assert.equal(l.total, 4); assert.ok(l.rows.every(r => r.origin === 'LEGACY' && typeof r.incomplete === 'boolean'));
  assert.equal((await A('GET', '/job-orders?origin=LEGACY')).data.total, 4); assert.equal((await A('GET', '/job-orders?origin=NEW')).data.total, 0);
  const inc = (await A('GET', '/job-orders?incomplete=1')).data; assert.deepEqual(inc.rows.map(r => r.no_jo).sort(), ['0027USC', '0028BTU', '0029FADLAN', '0030USC']);   // jenis muatan wajib untuk semua tipe dan kosong di keempat JO
  const d27 = (await A('GET', `/job-orders/${jo['0027USC']}`)).data; assert.deepEqual([d27.origin, d27.incomplete, d27.port_loading_name, d27.port_dest_name, d27.tps_name, d27.etd !== null], ['LEGACY', true, 'KWANGYANG', 'TANJUNG PRIOK', 'TPS SATU', true]);
  assert.equal((await A('GET', `/job-orders/${jo['0029FADLAN']}`)).data.incomplete, true); await q("UPDATE job_orders SET jenis_muatan='FCL' WHERE id=?", [jo['0029FADLAN']]);
  assert.equal((await A('GET', `/job-orders/${jo['0029FADLAN']}`)).data.incomplete, false); assert.equal((await A('GET', '/job-orders?incomplete=1')).data.total, 3);       // melengkapi isian wajib -> tidak lagi "belum lengkap"

  // edit sebagian: JO lama NOT_COMP (0027USC kosong delivery_plan dan kekurangan isian lain)
  const body = (extra = {}) => ({ type: 'IMPORT', customer_id: d27.customer_id, jenis_muatan: d27.jenis_muatan, type_bc: d27.type_bc, vessel: d27.vessel, eta_etd: String(d27.eta_etd).slice(0, 10), delivery_plan: null,
    container_count: d27.container_count, container_type: d27.container_type, weight: d27.weight, qty: d27.qty, unit: d27.unit, remarks: d27.remarks, ...extra });
  let r = await A('PUT', `/job-orders/${jo['0027USC']}`, body({ remarks: 'diubah sebagian' })); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await q('SELECT remarks, delivery_plan FROM job_orders WHERE id=?', [jo['0027USC']]))[0].remarks, 'diubah sebagian');
  r = await A('PUT', `/job-orders/${jo['0027USC']}`, body({ vessel: '' })); assert.equal(r.status, 400); assert.match(r.data.error, /Vessel wajib/);           // kolom yang diubah divalidasi penuh
  r = await A('PUT', `/job-orders/${jo['0027USC']}`, body({ delivery_plan: '2026-03-01', vessel: 'KAPAL BARU' })); assert.equal(r.status, 200);
  assert.deepEqual((await q('SELECT vessel, status FROM job_orders WHERE id=?', [jo['0027USC']]))[0], { vessel: 'KAPAL BARU', status: 'NOT_COMP' });
  r = await A('PUT', `/job-orders/${jo['0027USC']}`, body({ references: [{ kind: 'AJU', number: '' }] })); assert.equal(r.status, 400); assert.match(r.data.error, /Nomor aju/);   // referensi wajib yang diubah menjadi kosong
  // satuan data lama yang tidak ada di daftar form (CARTON) boleh tetap; satuan baru tetap harus valid
  const d30 = (await A('GET', `/job-orders/${jo['0030USC']}`)).data; assert.equal(d30.unit, 'CARTON');
  const b30 = { type: 'PROJECT', customer_id: d30.customer_id, qty: d30.qty, unit: d30.unit, remarks: 'proyek', delivery_plan: '2026-04-01' };
  r = await A('PUT', `/job-orders/${jo['0030USC']}`, b30); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await q('SELECT unit FROM job_orders WHERE id=?', [jo['0030USC']]))[0].unit, 'CARTON');
  r = await A('PUT', `/job-orders/${jo['0030USC']}`, { ...b30, unit: 'XYZ' }); assert.equal(r.status, 400); assert.match(r.data.error, /Satuan tidak valid/);
  // berat lama tidak berubah oleh pembulatan ton di form
  const w0 = Number((await q('SELECT weight_kg FROM job_orders WHERE id=?', [jo['0028BTU']]))[0].weight_kg); await q("UPDATE job_orders SET status='NOT_COMP', weight_kg=12345.67 WHERE id=?", [jo['0028BTU']]);
  const d28 = (await A('GET', `/job-orders/${jo['0028BTU']}`)).data;
  r = await A('PUT', `/job-orders/${jo['0028BTU']}`, { type: 'EXPORT', customer_id: d28.customer_id, jenis_muatan: d28.jenis_muatan, type_bc: d28.type_bc, vessel: d28.vessel, eta_etd: String(d28.eta_etd).slice(0, 10), container_count: d28.container_count, container_type: d28.container_type, qty: d28.qty, unit: d28.unit, weight: 12.35, remarks: 'x' });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  assert.equal(Number((await q('SELECT weight_kg FROM job_orders WHERE id=?', [jo['0028BTU']]))[0].weight_kg), 12345.67);
  // data BARU tetap divalidasi penuh
  const nc = (await q("INSERT INTO customers (code, name) VALUES ('NEW', 'BARU')")).insertId;
  r = await A('POST', '/job-orders', { type: 'IMPORT', customer_id: nc }); assert.equal(r.status, 400); assert.match(r.data.error, /Delivery plan wajib/);
  const newJo = (await A('POST', '/job-orders', { type: 'TRUCKING', customer_id: nc, jenis_muatan: 'FCL', delivery_plan: '2026-12-01' })).data.id; assert.ok(newJo);
  r = await A('PUT', `/job-orders/${newJo}`, { type: 'TRUCKING', customer_id: nc, jenis_muatan: 'FCL', delivery_plan: '' }); assert.equal(r.status, 400); assert.match(r.data.error, /Delivery plan wajib/);
  assert.equal((await A('GET', '/job-orders?origin=NEW')).data.total, 1); assert.equal((await A('GET', `/job-orders/${newJo}`)).data.incomplete, false);

  // material lama: hanya kolom yang berubah
  const mats0 = (await A('GET', `/job-orders/${jo['0027USC']}/materials`)).data, mats = mats0.rows || mats0.materials || mats0, m3 = mats.find(m => m.product_no === 'C-2#2') || mats.find(m => m.description == null);
  assert.ok(m3, 'material lama ada');
  const mb = (m, extra = {}) => ({ product_no: m.product_no, kondisi: m.kondisi, spec: m.spec, description: m.description, thickness: m.thickness, width: m.width, shape: m.shape, net_weight: m.net_weight, gross_weight: m.gross_weight, qty: m.qty, unit: m.unit, origin: m.origin, destination: m.destination, ...extra });
  r = await A('PUT', `/job-orders/${jo['0027USC']}/materials/${m3.id}`, mb(m3, { description: 'DESKRIPSI BARU' })); assert.equal(r.status, 200, JSON.stringify(r.data));   // origin/destination kosong tidak ditolak
  r = await A('PUT', `/job-orders/${jo['0027USC']}/materials/${m3.id}`, mb(m3, { description: 'D', unit: '' })); assert.equal(r.status, 400); assert.match(r.data.error, /Unit wajib/);
  r = await A('POST', `/job-orders/${jo['0027USC']}/materials`, { product_no: 'BARU-1', description: 'x', unit: 'COIL', qty: 1, net_weight: 1, gross_weight: 1 }); assert.equal(r.status, 400); assert.match(r.data.error, /From wajib/);   // material baru: validasi penuh

  // tiket penampung + relink
  const tk = Object.fromEntries((await q('SELECT id, ticket_no, is_placeholder FROM handling_tickets')).map(x => [x.ticket_no, x]));
  const sj = Object.fromEntries((await q('SELECT id, no_sj, origin FROM delivery_notes')).map(x => [x.no_sj, x]));
  const lst = (await A('GET', '/ho/tickets?from=2000-01-01&to=2999-12-31')).data; assert.equal(lst.rows.find(x => x.ticket_no === 'MIG-202601').is_placeholder, true); assert.equal(lst.rows.find(x => x.ticket_no === '202601001').is_placeholder, false);
  assert.equal(lst.rows.find(x => x.ticket_no === 'MIG-202601').prog, 100);
  assert.equal((await A('GET', '/home/tickets')).data.rows.some(x => x.ticket_no.startsWith('MIG-')), false);
  // surat jalan kosong: buka, cetak, ekspor tanpa galat; tujuan dari data lama tampil
  const empty = (await A('GET', `/ho/sj/${sj['2026010003'].id}`)).data; assert.deepEqual([empty.items.length, empty.destination, empty.is_legacy, empty.ticket_no], [0, 'TEST', true, 'MIG-202601']);
  const pdf = await fetch(`${base}/ho/sj/${sj['2026010003'].id}/pdf`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id: adminId }, cfg.secret) } }); assert.equal(pdf.status, 200); assert.equal((await pdf.arrayBuffer()).byteLength > 500, true);
  for (const u of [`/ho/tickets/${tk['MIG-202601'].id}`, `/ho/tickets/${tk['MIG-202601'].id}/sj`, `/ho/tickets/${tk['MIG-202601'].id}/materials`, `/ho/tickets/${tk['MIG-202601'].id}/report-text`, '/ho/tickets/export?from=2000-01-01&to=2999-12-31', '/job-orders/export?from=&to=', '/home/upcoming', '/home/plan']) assert.equal((await A('GET', u)).status, 200, u);
  // relink
  const before = JSON.stringify(await q("SELECT ticket_id FROM delivery_notes ORDER BY id"));
  r = await A('PUT', `/ho/delivery-notes/${sj['2026010005'].id}/relink`, { ticket_id: tk['202601001'].id }); assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await q('SELECT ticket_id FROM delivery_notes WHERE id=?', [sj['2026010005'].id]))[0].ticket_id, tk['202601001'].id);
  assert.ok((await q('SELECT 1 FROM ticket_job_orders WHERE ticket_id=? AND jo_id=?', [tk['202601001'].id, jo['0028BTU']])).length);                  // JO dari isi surat jalan ikut ditautkan
  const au = await q("SELECT entity_id, action, note FROM audit_log WHERE action LIKE 'Surat jalan%' ORDER BY id"); assert.equal(au.length, 2); assert.match(au[0].note, /2026010005: MIG-202601 → 202601001/);
  assert.deepEqual(au.map(a => a.entity_id), [tk['202601001'].id, tk['MIG-202601'].id]);
  assert.equal((await q('SELECT done_at FROM handling_tickets WHERE id=?', [tk['202601001'].id]))[0].done_at !== null, true);                       // tiket lama yang sudah ditutup tidak terbuka kembali
  for (const [dn, body, re] of [['2026010003', { ticket_id: tk['MIG-202602'].id }, /penampung/], ['2026010005', { ticket_id: tk['202601001'].id }, /sudah ada di tiket/], ['2026010003', { ticket_id: 999999 }, /tidak ditemukan/], ['2026010003', {}, /Pilih tiket/]]) {
    r = await A('PUT', `/ho/delivery-notes/${sj[dn].id}/relink`, body); assert.equal(r.status, 400, dn + JSON.stringify(body)); assert.match(r.data.error, re);
  }
  assert.equal((await A('PUT', '/ho/delivery-notes/999999/relink', { ticket_id: tk['202601001'].id })).status, 404);
  const newSj = (await q("INSERT INTO delivery_notes (no_sj, ticket_id, nopol, driver) VALUES ('2026109999', ?, 'B 1 X', 'BARU')", [tk['202601001'].id])).insertId;      // surat jalan LESAT (bukan lama) tidak bisa
  r = await A('PUT', `/ho/delivery-notes/${newSj}/relink`, { ticket_id: tk['202601002'].id }); assert.equal(r.status, 400); assert.match(r.data.error, /data lama/);
  // izin: butuh ho.update
  const rl = (await q("INSERT INTO roles (name) VALUES ('Lihat HO')")).insertId; await q("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'ho.view')", [rl]);
  const vu = (await q("INSERT INTO users (username,password,name,role_id,email) VALUES ('lihatho','x','L',?,'l@x.id')", [rl])).insertId;
  r = await as(vu)('PUT', `/ho/delivery-notes/${sj['2026010003'].id}/relink`, { ticket_id: tk['202601002'].id }); assert.equal(r.status, 403);
  assert.equal((await q('SELECT ticket_id FROM delivery_notes WHERE id=?', [sj['2026010003'].id]))[0].ticket_id, tk['MIG-202601'].id);
  r = await A('PUT', `/ho/delivery-notes/${sj['2026010003'].id}/relink`, { ticket_id: tk['202601002'].id }); assert.equal(r.status, 200);                // surat jalan kosong bisa ditautkan
});
