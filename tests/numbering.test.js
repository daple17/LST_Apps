const test = require('node:test'), assert = require('node:assert/strict');
const n = require('../lib/numbering');
const { tx } = require('../lib/http');
const { migrate } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');

test('format nomor sesuai spesifikasi', () => {
  assert.equal(n.formatJo(27, 'usc'), '0027USC');
  assert.equal(n.formatTicket(new Date('2025-06-10T05:00:00Z'), 18, 'at'), '2025061018AT');
  assert.equal(n.formatSj(new Date('2025-06-10T05:00:00Z'), 11), '2025060011');
});
test('nomor memakai tanggal WIB, bukan UTC', () => {
  // 20:00 UTC tanggal 9 = 03:00 WIB tanggal 10
  assert.equal(n.formatTicket(new Date('2025-06-09T20:00:00Z'), 1, 'XX'), '2025061001XX');
  assert.equal(n.formatSj(new Date('2025-05-31T18:00:00Z'), 1), '2025060001');
});

test('penomoran atomik di database', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia (jalankan docker compose up -d)');
  const pool = await freshDb('lesat_test_num');
  t.after(() => pool.end());
  await migrate(pool);
  await pool.query("INSERT INTO customers (code,name) VALUES ('USC','PT USC')");

  await t.test('dua simpan bersamaan tidak mendapat nomor sama (25 transaksi paralel)', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => tx(pool, async conn => {
      const no = await n.joNumber(conn, 'USC');
      await conn.query("INSERT INTO job_orders (no_jo, type, customer_id) VALUES (?, 'IMPORT', 1)", [no]);
      return no;
    })));
    assert.equal(new Set(results).size, 25);
    assert.deepEqual([...results].sort(), Array.from({ length: 25 }, (_, i) => `${String(i + 1).padStart(4, '0')}USC`));
  });

  await t.test('nomor yang sudah terbit tidak dipakai ulang walaupun datanya dihapus', async () => {
    await pool.query("DELETE FROM job_orders WHERE no_jo='0025USC'");
    const no = await tx(pool, conn => n.joNumber(conn, 'USC'));
    assert.equal(no, '0026USC');
  });

  await t.test('simpan yang dibatalkan tidak meninggalkan lubang', async () => {
    await assert.rejects(tx(pool, async conn => { await n.joNumber(conn, 'USC'); throw new Error('gagal'); }), /gagal/);
    assert.equal(await tx(pool, conn => n.joNumber(conn, 'USC')), '0027USC');
  });

  await t.test('tiket dan surat jalan: urutan per bulan, reset bulan berikutnya', async () => {
    const d1 = new Date('2026-06-10T05:00:00Z'), d2 = new Date('2026-07-01T05:00:00Z');
    const a = await Promise.all([1, 2, 3, 4, 5].map(() => tx(pool, conn => n.ticketNumber(conn, 'AT', d1))));
    assert.deepEqual(a.sort(), ['2026061001AT', '2026061002AT', '2026061003AT', '2026061004AT', '2026061005AT']);
    assert.equal(await tx(pool, conn => n.ticketNumber(conn, 'TP', d2)), '2026070101TP');
    const s = await Promise.all([1, 2, 3].map(() => tx(pool, conn => n.sjNumber(conn, d1))));
    assert.deepEqual(s.sort(), ['2026060001', '2026060002', '2026060003']);
    assert.equal(await tx(pool, conn => n.sjNumber(conn, d2)), '2026070001');
  });
});
