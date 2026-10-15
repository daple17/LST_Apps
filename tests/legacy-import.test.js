const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const cfg = require('../config');
const { migrate } = require('../lib/migrate');
const { seedMaster } = require('../server');
const { freshDb, dbAvailable } = require('./helpers');
const { run } = require('../scripts/legacy-import');

const SRC = 'lesat_test_legacy_src', DST = 'lesat_test_import_dst';
async function setup(t) {
  const src = await freshDb(SRC), dst = await freshDb(DST);
  t.after(async () => { await src.end(); await dst.end(); });
  await src.query(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-mini.sql'), 'utf8'));
  await migrate(dst); await seedMaster(dst); await dst.query('DELETE FROM customers'); await dst.query('DELETE FROM vendors'); await dst.query('DELETE FROM shippers');
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesat-rep-'));
  const args = (...extra) => ['--lokal', `--legacy-host=${cfg.db.host}`, `--legacy-port=${cfg.db.port}`, `--legacy-user=${cfg.db.user}`, `--legacy-pass=${cfg.db.password}`, `--legacy-db=${SRC}`, `--report-dir=${reportDir}`, ...extra];
  const go = (...extra) => run(args(...extra), { log: () => {}, target: { ...cfg.db, database: DST } });
  return { src, dst, q: async (s, p) => (await dst.query(s, p))[0], go, args, reportDir };
}

test('impor: menolak berjalan tanpa --lokal atau di host non-lokal', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const base = ['--legacy-db=x'], tgt = { ...cfg.db, database: DST };
  await assert.rejects(run(base, { log: () => {}, target: tgt }), /hanya untuk uji lokal.*--lokal/);
  await assert.rejects(run(['--lokal', '--legacy-host=10.20.30.40', ...base], { log: () => {}, target: tgt }), /database sistem lama.*bukan lokal/);
  await assert.rejects(run(['--lokal', ...base], { log: () => {}, target: { ...tgt, host: 'db.produksi.example.com' } }), /host MySQL tujuan.*bukan lokal/);
  await assert.rejects(run(['--lokal', '--dry-run', '--commit'], { log: () => {}, target: tgt }), /tidak bisa dipakai bersamaan/);
  await assert.rejects(run(['--lokal', '--aneh'], { log: () => {}, target: tgt }), /Opsi tidak dikenal/);
});

test('impor bagian 1: dry-run tidak menulis; commit memetakan master, pengguna, Job Order; idempoten; reset', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const { src, dst, q, go, reportDir } = await setup(t);
  const nc = (await q("INSERT INTO customers (code, name) VALUES ('NEW', 'CUSTOMER BARU LESAT')")).insertId;           // data LESAT yang sudah ada tidak boleh tersentuh
  await q("INSERT INTO job_orders (no_jo, type, customer_id, status) VALUES ('0001NEW', 'TRUCKING', ?, 'NOT_COMP')", [nc]);
  await q("INSERT INTO counters (name, period, last) VALUES ('JO', '', 5) ON DUPLICATE KEY UPDATE last=5");
  const snap = async () => JSON.stringify(await Promise.all(['customers', 'vendors', 'shippers', 'job_orders', 'jo_references', 'jo_checklist', 'jo_containers', 'users', 'roles', 'countries', 'ports', 'tps_warehouses', 'legacy_quarantine', 'counters'].map(t2 => q(`SELECT * FROM ${t2} ORDER BY 1,2`))));

  // dry-run: statistik terisi, tetapi tidak ada tulisan ke tabel data
  const before = await snap();
  let r = await go(); assert.equal(r.mode, 'dry-run');
  assert.equal(await snap(), before);
  assert.equal(r.ctx.stats.job_orders.inserted, 4); assert.equal(r.ctx.stats.job_orders.quarantined, 2); assert.equal(r.ctx.stats.customers.inserted, 4);
  assert.ok(fs.readdirSync(reportDir).some(f => /^run-.*\.md$/.test(f)) && fs.readdirSync(reportDir).some(f => /karantina\.csv$/.test(f)));   // laporan tetap ditulis
  assert.equal((await q("SELECT COUNT(*) n FROM import_runs WHERE mode='dry-run'"))[0].n, 1);

  // commit
  r = await go('--commit'); assert.equal(r.mode, 'commit');
  const cust = Object.fromEntries((await q('SELECT * FROM customers')).map(c => [c.code, c]));
  assert.deepEqual(Object.keys(cust).sort(), ['FADLAN', 'NEW', 'USC', 'BTU', 'XYZ'].sort());           // kode = nickname (huruf besar)
  assert.equal(cust.USC.legacy_code, 'USC1'); assert.equal(cust.USC.tax_no, '01.234'); assert.equal(cust.BTU.tax_no, null); assert.equal(cust.BTU.legacy_code, null);
  assert.deepEqual([cust.FADLAN.needs_code_review, cust.USC.needs_code_review, cust.NEW.legacy_id], [1, 0, null]);
  const v = Object.fromEntries((await q('SELECT * FROM vendors')).map(x => [x.legacy_id, x]));
  assert.equal(v[1].code, 'MJL'); assert.equal(v[1].needs_code_review, 0); assert.deepEqual([v[2].code, v[2].needs_code_review], ['ML01', 1]); assert.equal(v[3].code, 'DPS01'); assert.equal(v[4].code, 'VKK01'); assert.equal(v[4].needs_code_review, 1);
  assert.equal(v[1].npwp, null); assert.equal(v[1].country_id !== null, true);
  assert.deepEqual((await q('SELECT name, is_foreign FROM ports ORDER BY legacy_id')).map(p => [p.name, p.is_foreign]), [['TANJUNG PRIOK', 0], ['KWANGYANG', 1]]);
  assert.equal((await q('SELECT COUNT(*) n FROM countries'))[0].n, 2); assert.equal((await q('SELECT COUNT(*) n FROM tps_warehouses'))[0].n, 1);
  assert.equal((await q('SELECT country_id FROM shippers WHERE legacy_id=2'))[0].country_id, null);

  // pengguna: admin tertaut (tanpa mengubah peran/password), lainnya nonaktif tanpa izin
  const adm = (await q("SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE username='admin'"))[0];
  assert.deepEqual([adm.legacy_id, adm.role, adm.is_active], [1, 'Super Admin', 1]); assert.ok(adm.password.startsWith('$2'));
  const un = Object.fromEntries((await q("SELECT u.*, r.name role, (SELECT COUNT(*) FROM role_permissions WHERE role_id=r.id) perms FROM users u JOIN roles r ON r.id=u.role_id")).map(u => [u.username, u]));
  for (const k of ['budi', 'citra', 'dodo', 'migrasi-sistem-lama']) { assert.equal(un[k].is_active, 0, k); assert.equal(un[k].role, 'Pengguna Lama (tanpa akses)'); assert.equal(un[k].perms, 0); assert.equal(un[k].must_change_password, 1); }
  assert.equal(un.budi.email, 'budi@mail.test'); assert.equal(un.citra.email, null);                    // email ganda dikosongkan
  assert.equal(un.dodo.email, null); assert.equal(un.dodo.pic_code, null);                              // email tak valid / kode PIC terlalu panjang
  assert.notEqual(un.budi.password, un.citra.password);

  // Job Order
  const jo = Object.fromEntries((await q('SELECT * FROM job_orders')).map(j => [j.no_jo, j]));
  assert.deepEqual(Object.keys(jo).sort(), ['0001NEW', '0027USC', '0028BTU', '0029FADLAN', '0030USC']);   // 105 (customer tidak ada) dan 106 (tipe 7) dikarantina
  const a = jo['0027USC'], b = jo['0028BTU'], c = jo['0029FADLAN'], d = jo['0030USC'];
  assert.deepEqual([a.type, a.type_bc, a.jenis_muatan, a.legacy_no, a.origin, a.legacy_id], ['IMPORT', 'BC 2.0', 'FCL', '27', 'LEGACY', 101]);
  assert.deepEqual([String(a.eta_etd).slice(0, 10), String(a.etd).slice(0, 10), a.jo_date, a.delivery_plan], ['2026-01-20', '2026-01-10', '2026-01-05', null]);   // IMPORT: eta_etd = DateEta
  assert.deepEqual([a.status, a.legacy_status, a.completed_at], ['NOT_COMP', 0, null]);                 // status 0 tetap tanpa tanggal selesai
  assert.deepEqual([a.container_count, a.container_type, a.vessel, a.remarks], [3, 'MIX', 'MSC BEIRA', 'catatan satu']);
  assert.deepEqual([a.port_loading_id !== null, a.port_dest_id !== null, a.tps_id !== null, a.shipper_id !== null, a.created_by !== null], [true, true, true, true, true]);
  assert.deepEqual([b.type, b.type_bc, b.jenis_muatan, String(b.eta_etd).slice(0, 10), Number(b.weight_kg), Number(b.cbm), b.qty, b.unit, b.party_text, b.status, String(b.completed_at).slice(0, 10)],
    ['EXPORT', 'BC 3.0', 'LCL_BB', '2026-01-30', 2760, 1.5, 300, 'COIL', null, 'COMPLETE', '2026-02-02']);          // EXPORT: eta_etd = COALESCE(DateEtd, DateEta)
  assert.deepEqual([c.type, c.type_bc, c.unit, c.party_text, c.qty, c.status, c.legacy_status, c.shipper_id], ['TRUCKING', null, null, 'BE', 13, 'COMPLETE', 2, null]);   // satuan tak dikenal -> teks; 12.5 dibulatkan
  assert.deepEqual([d.type, d.type_bc, d.jenis_muatan, d.weight_kg, d.qty, d.container_count, d.eta_etd], ['PROJECT', null, null, null, null, null, null]);
  assert.equal((await q("SELECT COUNT(*) n FROM job_orders WHERE origin='NEW'"))[0].n, 1);
  const refs = id => q('SELECT kind, number, ref_date FROM jo_references WHERE jo_id=? ORDER BY kind, sort', [id]);
  assert.deepEqual((await refs(a.id)).map(x => `${x.kind}:${x.number}:${x.ref_date ? String(x.ref_date).slice(0, 10) : ''}`), ['AJU:A1:', 'INVOICE:INV1:', 'INVOICE:INV2:', 'BL:BL1:2026-01-02', 'SI_DO:SD1:2026-01-04', 'SI_DO:SD2:2026-01-04', 'HBL:HB1:2026-01-03']);
  assert.deepEqual((await refs(b.id)).map(x => `${x.kind}:${x.number}`), ['AJU:A2', 'INVOICE:INV3', 'SI_PO:PO-1']);   // Export: NoSiDo -> SI_PO
  assert.deepEqual(await refs(c.id), []);                                                                  // '-' dibuang
  assert.deepEqual((await q('SELECT size, qty FROM jo_containers WHERE jo_id=? ORDER BY size', [a.id])).map(x => `${x.size}:${x.qty}`), ['20FT:2', '40FT:1']);
  assert.equal((await q("SELECT COUNT(*) n FROM jo_checklist WHERE jo_id IN (?,?,?,?)", [a.id, b.id, c.id, d.id]))[0].n, 36);
  assert.equal((await q("SELECT COUNT(*) n FROM jo_checklist c JOIN job_orders j ON j.id=c.jo_id WHERE j.no_jo='0001NEW'"))[0].n, 0);   // JO LESAT tidak disentuh
  // karantina + penghitung
  const qr = await q("SELECT source_table, legacy_id, reason FROM legacy_quarantine WHERE source_table='job_orders' ORDER BY legacy_id");
  assert.deepEqual(qr.map(x => x.legacy_id), [105, 106]); assert.match(qr[0].reason, /customer/); assert.match(qr[1].reason, /JobOrderType 7/);
  assert.equal((await q("SELECT last FROM counters WHERE name='JO' AND period=''"))[0].last, 30);       // dinaikkan ke nomor lama terbesar (30), tidak turun
  assert.equal(r.ctx.stats.job_orders.details.anomali_status0_tapi_ada_tanggal_selesai, 1);              // hanya JO 101 (status 0 tetapi ada tanggal selesai)
  assert.equal((await q("SELECT COUNT(*) n FROM import_runs"))[0].n, 2);

  // idempoten: impor ulang tidak menggandakan dan tidak menimpa isian pengguna (delivery_plan)
  await q("UPDATE job_orders SET delivery_plan='2026-03-01' WHERE no_jo='0027USC'");
  const afterFirst = await snap(); await go('--commit');
  const again = JSON.parse(await snap()), first = JSON.parse(afterFirst);
  for (const i of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10]) assert.equal(again[i].length, first[i].length, 'tabel ke-' + i);   // jumlah baris sama
  assert.equal((await q("SELECT COUNT(*) n FROM job_orders WHERE origin='LEGACY'"))[0].n, 4); assert.equal((await q('SELECT COUNT(*) n FROM jo_references'))[0].n, 7 + 3);
  assert.equal(String((await q("SELECT delivery_plan FROM job_orders WHERE no_jo='0027USC'"))[0].delivery_plan).slice(0, 10), '2026-03-01');
  assert.equal((await q("SELECT COUNT(*) n FROM users WHERE username='migrasi-sistem-lama'"))[0].n, 1); assert.equal((await q("SELECT COUNT(*) n FROM legacy_quarantine WHERE source_table='job_orders'"))[0].n, 2);   // karantina dibangun ulang, tidak menumpuk
  // perubahan di sumber ikut terbawa saat diulang; referensi dengan berkas tidak dihapus
  await dst.query('INSERT INTO files (owner_type, owner_id, filename, path, size, mime) VALUES ("jo_reference", 1, "x.pdf", "x.pdf", 1, "application/pdf")');
  const keep = (await q("SELECT r.id FROM jo_references r JOIN job_orders j ON j.id=r.jo_id WHERE j.no_jo='0027USC' AND r.number='INV2'"))[0].id;
  await q('UPDATE jo_references SET file_id=(SELECT MAX(id) FROM files) WHERE id=?', [keep]);
  await src.query("UPDATE job_order SET Invoice='INV1', Vessel='KAPAL BARU' WHERE id=101");
  await go('--commit');
  assert.deepEqual((await q("SELECT r.number FROM jo_references r JOIN job_orders j ON j.id=r.jo_id WHERE j.no_jo='0027USC' AND r.kind='INVOICE' ORDER BY 1")).map(x => x.number), ['INV1', 'INV2']);   // INV2 punya berkas: dipertahankan
  assert.equal((await q("SELECT vessel FROM job_orders WHERE no_jo='0027USC'"))[0].vessel, 'KAPAL BARU');

  // --only: hanya tabel yang diminta
  await go('--reset-legacy'); await go('--commit', '--only=customers,countries');
  assert.equal((await q("SELECT COUNT(*) n FROM customers WHERE legacy_id IS NOT NULL"))[0].n, 4); assert.equal((await q("SELECT COUNT(*) n FROM job_orders WHERE origin='LEGACY'"))[0].n, 0);

  // --reset-legacy: kembali ke kondisi sebelum impor; data LESAT tetap
  await go('--commit');
  assert.ok((await q("SELECT COUNT(*) n FROM job_orders WHERE origin='LEGACY'"))[0].n === 4);
  r = await go('--reset-legacy'); assert.equal(r.mode, 'reset');
  assert.equal(await snap(), before);                                                                       // sama persis dengan sebelum impor pertama
  assert.equal((await q("SELECT legacy_id FROM users WHERE username='admin'"))[0].legacy_id, null); assert.equal((await q("SELECT COUNT(*) n FROM roles WHERE name='Pengguna Lama (tanpa akses)'"))[0].n, 0);
  assert.equal((await q("SELECT COUNT(*) n FROM job_orders WHERE no_jo='0001NEW'"))[0].n, 1); assert.equal((await q("SELECT code FROM customers"))[0].code, 'NEW');
});

test('impor bagian 2: material, tiket, report, surat jalan (termasuk penampung), status tiket', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const { dst, q, go } = await setup(t);
  const snap = async () => JSON.stringify(await Promise.all(['customers', 'job_orders', 'jo_references', 'jo_materials', 'handling_tickets', 'ticket_job_orders', 'material_reports', 'delivery_notes', 'delivery_note_items', 'users', 'roles', 'legacy_quarantine', 'counters', 'audit_log'].map(t2 => q(`SELECT * FROM ${t2} ORDER BY 1,2`))));
  const before = await snap();
  let r = await go('--commit', '--active-window-days=30');
  const mat = Object.fromEntries((await q('SELECT * FROM jo_materials')).map(m => [m.legacy_id, m]));
  assert.deepEqual(Object.keys(mat).map(Number).sort(), [1, 2, 3, 4, 7, 8]);                               // 5 (JO tidak ada) dan 6 (data uji) dikarantina
  assert.deepEqual(Object.values(mat).map(m => m.product_no).sort(), ['C-2', 'C-2#2', 'MSKU1234567', 'TANPA-NOMOR-4', 'WING BOX', 'Z-8'].sort());   // ganda: akhiran #2 (tak peka huruf besar/kecil)
  assert.deepEqual([mat[1].container_no, mat[1].container_size, mat[7].container_no, mat[7].container_size, mat[2].container_size], ['MSKU1234567', '20', null, null, '40']);
  assert.deepEqual([mat[1].unit, mat[2].unit, mat[3].unit, mat[4].unit, mat[7].unit, mat[8].unit], ['20FT', 'COIL', 'UNIT', 'PACKAGE', 'PCS', 'BUNDLE']);
  assert.deepEqual([Number(mat[1].net_weight), Number(mat[2].net_weight), Number(mat[2].gross_weight), Number(mat[4].gross_weight), Number(mat[7].gross_weight), Number(mat[3].gross_weight)], [8000, 8100, 8140, 18909, 100, 250]);   // Kg / Ton / "Tons" bernilai kg / kosong >=100
  assert.deepEqual([mat[1].description, mat[1].spec, mat[2].spec, Number(mat[1].thickness), mat[2].thickness, mat[1].origin, mat[1].destination, mat[2].destination, mat[1].kondisi, mat[1].data_origin], ['GALVANIZED COIL', null, 'SPCC', 1.2, null, 'KOREA', 'CIKARANG', null, 'INTACT', 'LEGACY']);
  assert.equal((await q("SELECT COUNT(*) n FROM jo_materials WHERE data_origin='NEW'"))[0].n, 0);
  assert.deepEqual((await q("SELECT legacy_id, reason FROM legacy_quarantine WHERE source_table='jo_materials' ORDER BY legacy_id")).map(x => [x.legacy_id, /JO tidak ada|data uji/.exec(x.reason)?.[0]]), [[5, 'JO tidak ada'], [6, 'data uji']]);

  // tiket
  const tk = Object.fromEntries((await q('SELECT t.*, u.username pic FROM handling_tickets t JOIN users u ON u.id=t.pic_id')).map(x => [x.ticket_no, x]));
  assert.deepEqual(Object.keys(tk).sort(), ['202601001', '202601001#2', '202601002', 'MIG-202601', 'MIG-202602'].sort());   // nomor ganda diberi akhiran; dua tiket penampung
  assert.deepEqual([tk['202601001'].pic, tk['202601002'].pic, tk['202601001'].origin, tk['202601001'].is_placeholder], ['budi', 'migrasi-sistem-lama', 'LEGACY', 0]);     // PIC tak dikenal -> pengguna migrasi
  assert.deepEqual([tk['MIG-202601'].is_placeholder, tk['MIG-202601'].pic, tk['MIG-202601'].done_at !== null, tk['MIG-202602'].is_placeholder], [1, 'migrasi-sistem-lama', true, 1]);
  const links = (await q('SELECT t.ticket_no, j.no_jo FROM ticket_job_orders z JOIN handling_tickets t ON t.id=z.ticket_id JOIN job_orders j ON j.id=z.jo_id ORDER BY 1,2')).map(x => `${x.ticket_no}:${x.no_jo}`);
  assert.deepEqual(links, ['202601001:0027USC', '202601001#2:0028BTU', '202601002:0028BTU', 'MIG-202601:0028BTU']);   // JO 0028BTU di dua tiket + penampung berisi JO dari isi surat jalan
  // report kerusakan
  const reps = await q('SELECT m.legacy_id, r.status, r.remarks, r.checked_by_name, r.checked_at FROM material_reports r JOIN jo_materials m ON m.id=r.material_id ORDER BY m.legacy_id');
  assert.deepEqual(reps.map(x => [x.legacy_id, x.status, x.remarks, x.checked_by_name]), [[1, 'OK', null, 'Data lama'], [2, 'DAMAGE', 'penyok', 'Data lama']]);   // K3 ('-', status 0): tidak ada informasi, tidak dibuat
  // surat jalan
  const sj = Object.fromEntries((await q('SELECT d.*, t.ticket_no tno, v.code vcode FROM delivery_notes d JOIN handling_tickets t ON t.id=d.ticket_id LEFT JOIN vendors v ON v.id=d.vendor_id')).map(x => [x.legacy_id, x]));
  assert.deepEqual(Object.values(sj).map(x => x.no_sj).sort(), ['2026010001', '2026010001#2', '2026010003', '2026010005', '2026020001']);
  assert.deepEqual([sj[1].tno, sj[2].tno, sj[3].tno, sj[4].tno, sj[5].tno], ['202601001', '202601002', 'MIG-202601', 'MIG-202602', 'MIG-202601']);   // kosong dan kontainer tak dikenal -> penampung
  assert.deepEqual([sj[1].destination, sj[1].origin_address, sj[1].legacy_status, sj[1].origin, sj[1].vcode, sj[2].vendor_id, sj[2].phone, sj[3].phone, sj[1].start_loading, sj[1].finish_loading !== null, sj[2].finish_loading], ['CIKARANG', 'GUDANG A', 1, 'LEGACY', 'MJL', null, null, null, null, true, null]);
  assert.equal(sj[3].driver, 'SUPIR'); assert.equal((await q('SELECT COUNT(*) n FROM delivery_note_items WHERE dn_id=?', [sj[3].id]))[0].n, 0);            // surat jalan kosong tetap ada
  const items = Object.fromEntries((await q('SELECT i.*, m.legacy_id mk FROM delivery_note_items i JOIN jo_materials m ON m.id=i.material_id')).map(x => [x.legacy_id, x]));
  assert.deepEqual(Object.keys(items).map(Number).sort(), [1, 2, 3, 4, 6]);                                 // detil 5 (kontainer tak ada) dan 7 (kontainer uji) dikarantina
  assert.deepEqual([items[1].qty, Number(items[1].weight), items[1].mark, items[2].qty, Number(items[2].weight), items[2].mark, items[3].mark, items[3].legacy_flag, Number(items[4].weight), items[6].mk], [1, 8000, 'GOOD', 2, 8100, 'DAMAGE', null, 0, 7563.6, 7]);
  assert.deepEqual((await q("SELECT legacy_id, reason FROM legacy_quarantine WHERE source_table='delivery_note_items' ORDER BY legacy_id")).map(x => [x.legacy_id, /tidak ada di sumber|dikarantina/.exec(x.reason)[0]]), [[5, 'tidak ada di sumber'], [7, 'dikarantina']]);
  // status tiket + penghitung
  assert.equal(tk['202601001'].done_at !== null, true); assert.match(String(tk['202601001'].done_at), /2026-01-12/);                            // seluruh qty tercakup: selesai pada tanggal surat jalan terakhir
  for (const no of ['202601002', '202601001#2']) assert.match(String(tk[no].done_at), /2026-0[12]-/);                                           // belum tuntas dan lama: ditutup migrasi
  assert.equal((await q("SELECT COUNT(*) n FROM audit_log WHERE entity_type='ticket' AND action='Ditutup oleh migrasi'"))[0].n, 2);
  assert.deepEqual((await q("SELECT period, last FROM counters WHERE name='SJ' ORDER BY period")).map(x => [x.period, x.last]), [['202601', 5], ['202602', 1]]);   // hanya nomor 10 digit; yang diberi akhiran tidak dihitung
  assert.equal((await q("SELECT COUNT(*) n FROM counters WHERE name='TICKET'"))[0].n, 0);                  // penghitung tiket tidak disentuh
  // jendela tiket aktif: jendela sangat lebar -> tiket yang belum tuntas tetap aktif
  await go('--commit', '--active-window-days=100000');
  const act = await q("SELECT ticket_no FROM handling_tickets WHERE done_at IS NULL AND is_placeholder=0 ORDER BY 1"); assert.deepEqual(act.map(x => x.ticket_no), ['202601001#2', '202601002']);
  await go('--commit', '--active-window-days=30');
  assert.equal((await q("SELECT COUNT(*) n FROM audit_log WHERE entity_type='ticket' AND action='Ditutup oleh migrasi'"))[0].n, 2);                // catatan audit tidak menumpuk saat diulang
  // idempoten: impor ulang tidak menggandakan
  const once = JSON.parse(await snap()); await go('--commit', '--active-window-days=30'); const twice = JSON.parse(await snap());
  once.forEach((rows, i) => assert.equal(twice[i].length, rows.length, 'tabel ke-' + i));
  // reset mengembalikan semuanya (termasuk tiket penampung, catatan audit, penghitung SJ)
  await go('--reset-legacy'); const afterReset = JSON.parse(await snap()), orig = JSON.parse(before);
  orig.forEach((rows, i) => assert.deepEqual(afterReset[i], rows, 'tabel ke-' + i + ' ' + JSON.stringify(afterReset[i]).slice(0, 300) + ' vs ' + JSON.stringify(rows).slice(0, 300)));
});
