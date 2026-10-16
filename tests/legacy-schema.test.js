const test = require('node:test'), assert = require('node:assert/strict');
const { migrate, helpers } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');
const rules = require('../lib/rules');

test('migrasi 010: skema kompatibilitas data lama (hanya menambah, aman diulang)', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const pool = await freshDb('lesat_test_legacy_schema'); t.after(() => pool.end());
  const q = async (s, p) => (await pool.query(s, p))[0], m = helpers(pool);
  // data sebelum migrasi 010 (migrasi 000-009 saja)
  const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', 'migrations');
  const tmp = require('os').tmpdir() + '/lesat-mig-' + Date.now(); fs.mkdirSync(tmp);
  for (const f of fs.readdirSync(dir).filter(f => /^\d+.*\.js$/.test(f) && f < '010')) fs.writeFileSync(path.join(tmp, f), `module.exports = require(${JSON.stringify(path.join(dir, f))});`);
  await migrate(pool, tmp);
  await q("INSERT INTO customers (code, name) VALUES ('USC', 'PT USC')"); await q("INSERT INTO vendors (code, name) VALUES ('LST', 'PT LST')"); await q("INSERT INTO shippers (name) VALUES ('SHIPPER A')");
  await q("INSERT INTO job_orders (no_jo, type, customer_id, status) VALUES ('0001USC', 'IMPORT', 1, 'NOT_COMP')");
  const before = { jo: (await q('SELECT * FROM job_orders'))[0], c: (await q('SELECT * FROM customers'))[0] };

  assert.deepEqual(await migrate(pool, dir), ['010-legacy-compat.js', '011-legacy-material-origin.js', '012-coa-job-types.js', '013-customer-active.js', '014-vendor-active.js', '015-vendor-rates.js']); assert.deepEqual(await migrate(pool, dir), []);
  // data lama tidak berubah; kolom baru terisi default
  const jo = (await q('SELECT * FROM job_orders'))[0];
  for (const k of Object.keys(before.jo)) if (k !== 'updated_at') assert.equal(String(jo[k]), String(before.jo[k]), k);
  assert.deepEqual([jo.origin, jo.legacy_id, jo.jo_date, jo.completed_at, jo.etd, jo.port_loading_id, jo.port_dest_id, jo.tps_id, jo.legacy_status], ['NEW', null, null, null, null, null, null, null, null]);
  assert.deepEqual([(await q('SELECT needs_code_review, legacy_id FROM customers'))[0].needs_code_review, (await q('SELECT origin FROM handling_tickets').catch(() => [{}]))[0]?.origin ?? 'NEW'], [0, 'NEW']);
  // tabel dan kolom baru
  for (const tb of ['countries', 'ports', 'tps_warehouses', 'jo_containers', 'legacy_quarantine', 'import_runs']) assert.equal(await m.hasTable(tb), true, tb);
  for (const [tb, cols] of Object.entries({ job_orders: ['jo_date', 'completed_at', 'etd', 'port_loading_id', 'port_dest_id', 'tps_id', 'legacy_status', 'origin', 'legacy_id'], customers: ['email', 'phone', 'address', 'city', 'tax_no', 'legacy_code', 'needs_code_review', 'legacy_id'],
    vendors: ['city', 'npwp', 'pic', 'country_id', 'needs_code_review', 'legacy_id'], shippers: ['city', 'country_id', 'legacy_id'], jo_materials: ['container_no', 'container_size', 'data_origin', 'legacy_id'],
    handling_tickets: ['origin', 'is_placeholder', 'legacy_id'], delivery_notes: ['destination', 'origin_address', 'legacy_status', 'origin', 'legacy_id'], delivery_note_items: ['legacy_flag', 'legacy_id'], users: ['legacy_id'] }))
    for (const c of cols) assert.equal(await m.hasColumn(tb, c), true, `${tb}.${c}`);
  assert.match(await m.columnType('jo_materials', 'origin'), /varchar\(80\)/);                      // `origin` lama (lokasi asal) tidak berubah
  assert.equal(await m.hasColumn('delivery_notes', 'ticket_id'), true);
  assert.equal((await q("SELECT is_nullable n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='delivery_notes' AND column_name='ticket_id'"))[0].n, 'NO');   // tiket tetap wajib
  // legacy_id unik (NULL boleh banyak)
  for (const tb of ['job_orders', 'customers', 'vendors', 'shippers', 'jo_materials', 'handling_tickets', 'delivery_notes', 'delivery_note_items', 'users', 'countries', 'ports', 'tps_warehouses']) assert.equal(await m.hasIndex(tb, (await q('SELECT INDEX_NAME n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND column_name=? AND non_unique=0', [tb, 'legacy_id']))[0]?.n || 'x'), true, 'unik legacy_id ' + tb);
  await q("INSERT INTO customers (code, name, legacy_id) VALUES ('AAA', 'A', 77)"); await assert.rejects(q("INSERT INTO customers (code, name, legacy_id) VALUES ('BBB', 'B', 77)"), /Duplicate/);
  await q("INSERT INTO customers (code, name) VALUES ('CCC', 'C'), ('DDD', 'D')");
  // batas unik material tetap (jo_id, product_no)
  await q("INSERT INTO jo_materials (jo_id, product_no) VALUES (1, 'P1')"); await assert.rejects(q("INSERT INTO jo_materials (jo_id, product_no) VALUES (1, 'P1')"), /Duplicate/);
  // referensi HBL, peti kemas dengan cascade, FK port/TPS
  await q("INSERT INTO jo_references (jo_id, kind, number) VALUES (1, 'HBL', 'H-1')"); assert.equal((await q("SELECT kind FROM jo_references"))[0].kind, 'HBL');
  await q("INSERT INTO jo_containers (jo_id, size, qty) VALUES (1, '20FT', 2)"); await assert.rejects(q("UPDATE job_orders SET port_dest_id=999 WHERE id=1"));
  await q("INSERT INTO ports (name, legacy_id, is_foreign) VALUES ('TANJUNG PRIOK', 1, 0)"); await q('UPDATE job_orders SET port_dest_id=1, origin="LEGACY", legacy_id=5537 WHERE id=1');
  await q("DELETE FROM jo_references"); await q("DELETE FROM jo_materials"); await q("DELETE FROM job_orders WHERE id=1"); assert.equal((await q('SELECT COUNT(*) n FROM jo_containers'))[0].n, 0);
  await q("INSERT INTO legacy_quarantine (source_table, legacy_id, reason, payload) VALUES ('kontainer', 1, 'tes', JSON_OBJECT('a', 1))"); assert.equal((await q('SELECT resolved_at FROM legacy_quarantine'))[0].resolved_at, null);
  // rules: HBL dan BC 3.0 tersedia; HBL opsional untuk semua tipe
  assert.ok(rules.REF_KINDS.some(k => k.code === 'HBL')); assert.ok(rules.TYPE_BC.includes('BC 3.0')); assert.deepEqual(Object.values(rules.FIELD_RULES.HBL), ['O', 'O', 'O', 'O']);
});
