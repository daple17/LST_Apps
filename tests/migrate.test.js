// Migrasi data lama (skema demo) -> skema baru: data tidak hilang dan aman dijalankan ulang.
const test = require('node:test'), assert = require('node:assert/strict');
const { migrate, helpers } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');

test('migrasi data demo lama ke struktur baru', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const pool = await freshDb('lesat_test_mig');
  t.after(() => pool.end());
  const q = async (s, p) => (await pool.query(s, p))[0];

  // 1. skema lama + data lama
  await require('../migrations/000-legacy-baseline').up(helpers(pool));
  await q("INSERT INTO users (id,username,password,name,pic_code) VALUES (1,'admin','x','Administrator','AD')");
  await q("INSERT INTO customers (id,code,name) VALUES (1,'USC','PT USC'),(2,'BTU','PT BTU')");
  await q(`INSERT INTO job_orders (id,jo_no,type,customer_id,invoice_no,bl_no,si_po_no,aju_no,cargo_type,party,weight,vessel,eta,delivery_plan,checklist,status) VALUES
    (1,'0011-USC','PIB BC 2.0',1,'INV1, INV2','BL1','PO-9','000386, 000385','GALVANIZED COIL','300 CL',2.76,'SHINLINE 12','2026-10-01','2026-10-05','{"agency":{"inv":1,"fp":0},"do":{"inv":0,"fp":1},"lolo_on":{"inv":1,"fp":0},"thc":{"inv":0,"fp":0}}','NOT_COMP'),
    (2,'0012-BTU','LOKAL',2,NULL,NULL,NULL,NULL,NULL,'12x40ft',1.5,NULL,NULL,'2026-10-06','{}','COMPLETE'),
    (3,'0013-USC','PEB',1,'I3',NULL,NULL,NULL,NULL,'590 BE',0.5,'MELIA 5','2026-10-02','2026-10-04','{}','NOT_COMP')`);
  await q("INSERT INTO jo_logs (jo_id,user_name,action,note) VALUES (1,'Administrator','Dibuat',NULL)");
  await q("INSERT INTO jo_documents (jo_id,filename,path,category) VALUES (1,'bl.pdf','123-bl.pdf','Bill of Lading')");
  await q("INSERT INTO ho_tickets (id,ticket_no,pic_id) VALUES (1,'2026100101AD',1)");
  await q('INSERT INTO ho_ticket_jos (ticket_id,jo_id) VALUES (1,1)');
  await q(`INSERT INTO materials (id,ticket_id,jo_id,product_no,net_weight,gross_weight,qty,unit,check_status,remarks) VALUES
    (1,1,1,'C-1',8120,8187,1,'COIL','OK',NULL),(2,1,1,'C-2',8140,8207,1,'COIL','DAMAGE','penyok'),(3,1,1,'C-3',8090,8150,1,'COIL','NOT_CHECKED',NULL)`);
  await q("INSERT INTO material_photos (material_id,path) VALUES (2,'p1.jpg')");
  await q("INSERT INTO surat_jalan (id,sj_no,ticket_id,nopol,driver,created_by) VALUES (1,'2026100007',1,'B 1 X','BUDI','Administrator')");
  await q('INSERT INTO surat_jalan_items (sj_id,material_id,qty,weight) VALUES (1,1,1,8120),(1,2,1,8140)');
  await q("INSERT INTO sj_photos (sj_id,path) VALUES (1,'s1.jpg')");

  // 2. migrasi (dua kali: yang kedua tidak boleh melakukan apa pun)
  assert.deepEqual((await migrate(pool)).sort(), ['000-legacy-baseline.js', '001-job-orders.js', '002-handling.js', '003-nopen.js', '004-home-indexes.js', '005-users-roles.js', '006-audit-note-text.js', '007-coa.js', '008-checkin.js', '009-checkin-photo.js', '010-legacy-compat.js', '011-legacy-material-origin.js', '012-coa-job-types.js', '013-customer-active.js', '014-vendor-active.js', '015-vendor-rates.js', '016-vendor-rates-city.js']); // baseline dipanggil manual di atas, jadi belum tercatat (idempotent)
  assert.deepEqual(await migrate(pool), []);

  // 3. JO: nomor, tipe, berat, party, referensi
  const jo = Object.fromEntries((await q('SELECT * FROM job_orders')).map(j => [j.id, j]));
  assert.equal(Object.keys(jo).length, 3);
  assert.equal(jo[1].no_jo, '0011USC'); assert.equal(jo[1].legacy_no, '0011-USC');
  assert.equal(jo[1].type, 'IMPORT'); assert.equal(jo[1].type_bc, 'BC 2.0');
  assert.equal(jo[2].type, 'TRUCKING'); assert.equal(jo[2].type_bc, null);   // LOKAL -> Trucking
  assert.equal(jo[3].type, 'EXPORT');                                         // PEB -> Export
  assert.equal(Number(jo[1].weight_kg), 2760); assert.equal(Number(jo[2].weight_kg), 1500);
  assert.equal(jo[1].qty, 300); assert.equal(jo[1].unit, 'COIL');
  assert.equal(jo[2].qty, 12); assert.equal(jo[2].unit, '40FT');
  assert.equal(jo[3].qty, null); assert.equal(jo[3].party_text, '590 BE');
  assert.equal(jo[1].cargo_desc, 'GALVANIZED COIL');
  const r1 = await q('SELECT kind, number FROM jo_references WHERE jo_id=1 ORDER BY sort');
  assert.deepEqual(r1.map(r => `${r.kind}:${r.number}`), ['INVOICE:INV1', 'INVOICE:INV2', 'BL:BL1', 'SI_PO:PO-9', 'AJU:000386', 'AJU:000385']);
  for (const gone of ['invoice_no', 'bl_no', 'si_po_no', 'aju_no', 'checklist', 'weight', 'party']) assert.equal(await helpers(pool).hasColumn('job_orders', gone), false, gone);

  // 4. checklist 12 -> 9 item (digabung OR)
  const ck = Object.fromEntries((await q('SELECT item, inv, fp FROM jo_checklist WHERE jo_id=1')).map(c => [c.item, c]));
  assert.equal(Object.keys(ck).length, 9);
  assert.deepEqual([ck.agency_do.inv, ck.agency_do.fp], [1, 1]);   // agency(inv) OR do(fp)
  assert.deepEqual([ck.lolo.inv, ck.lolo.fp], [1, 0]);
  assert.deepEqual([ck.thc.inv, ck.thc.fp], [0, 0]);

  // 5. log, dokumen, penghitung
  assert.equal((await q("SELECT COUNT(*) n FROM audit_log WHERE entity_type='job_order'"))[0].n, 1);
  const doc = (await q('SELECT d.doc_type, f.filename FROM jo_documents d JOIN files f ON f.id=d.file_id'))[0];
  assert.deepEqual([doc.doc_type, doc.filename], ['BL', 'bl.pdf']);
  assert.equal((await q("SELECT last FROM counters WHERE name='JO'"))[0].last, 13);
  assert.equal((await q("SELECT last FROM counters WHERE name='SJ' AND period='202610'"))[0].last, 7);
  assert.equal((await q("SELECT last FROM counters WHERE name='TICKET' AND period='202610'"))[0].last, 1);

  // 6. Handling Ops: material tetap utuh, status pindah ke material_reports, foto ke files
  assert.equal((await q('SELECT COUNT(*) n FROM jo_materials'))[0].n, 3);
  const reps = Object.fromEntries((await q('SELECT material_id, status, remarks FROM material_reports')).map(r => [r.material_id, r]));
  assert.equal(reps[1].status, 'OK'); assert.equal(reps[2].status, 'DAMAGE'); assert.equal(reps[2].remarks, 'penyok'); assert.equal(reps[3], undefined);
  assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='material_report'"))[0].n, 1);
  assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='delivery_note'"))[0].n, 1);
  const items = await q('SELECT material_id, mark FROM delivery_note_items ORDER BY material_id');
  assert.deepEqual(items.map(i => i.mark), ['GOOD', 'DAMAGE']);
  const dn = (await q('SELECT no_sj, created_by_name FROM delivery_notes'))[0];
  assert.deepEqual([dn.no_sj, dn.created_by_name], ['2026100007', 'Administrator']);

  assert.match(await helpers(pool).columnType('jo_references', 'kind'), /NOPEN/);

  // 7. tabel lama sudah tidak ada; JO boleh masuk tiket lagi setelah tiket lama selesai (UNIQUE jo_id dilepas)
  const h = helpers(pool);
  for (const old of ['ho_tickets', 'materials', 'surat_jalan', 'jo_logs', 'material_photos', 'sj_photos']) assert.equal(await h.hasTable(old), false, old);
  await q("INSERT INTO handling_tickets (ticket_no,pic_id) VALUES ('2026100102AD',1)");
  await q('INSERT INTO ticket_job_orders (ticket_id,jo_id) VALUES (2,1)');
});
