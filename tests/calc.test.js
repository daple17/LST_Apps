const test = require('node:test'), assert = require('node:assert/strict');
const c = require('../lib/calc');

test('dwelling time: sekarang (atau waktu selesai) dikurangi waktu tiket dibuat', () => {
  const created = '2025-06-10 00:00:00';
  const now = Date.parse('2025-06-12T04:31:00Z');
  assert.equal(c.dwellMinutes(created, null, now), 2 * 1440 + 4 * 60 + 31);
  assert.equal(c.formatDwell(c.dwellMinutes(created, null, now)), '2 D : 04 H : 31 M');
  // tiket selesai: berhenti di waktu selesai, bukan sekarang
  assert.equal(c.formatDwell(c.dwellMinutes(created, '2025-06-10 02:05:00', now)), '0 D : 02 H : 05 M');
  assert.equal(c.formatDwell(null), '-');
});

test('load time: finish loading dikurangi start loading', () => {
  assert.equal(c.formatLoad(c.loadMinutes('2025-06-10 08:00:00', '2025-06-10 09:20:00')), '1 H 20 M');
  assert.equal(c.loadMinutes('2025-06-10 08:00:00', null), null);
  assert.equal(c.formatLoad(null), '-');
  assert.equal(c.loadMinutes('2025-06-10 09:00:00', '2025-06-10 08:00:00'), 0); // koreksi waktu terbalik tidak negatif
});

test('Report Material %: OK atau Damage dibagi semua material', () => {
  assert.equal(c.reportPct(4, 7), 57.14);
  assert.equal(c.reportPct(0, 0), 0);
  assert.equal(c.reportPct(7, 7), 100);
});

test('Trucking Delivery %: qty di surat jalan dibagi total qty, maksimal 100', () => {
  assert.equal(c.deliveryPct(34, 100), 34);
  assert.equal(c.deliveryPct(120, 100), 100);
  assert.equal(c.deliveryPct(5, 0), 0);
});

test('progres tiket untuk tab = nilai terendah (rata-rata hanya jika diminta)', () => {
  assert.equal(c.ticketProgress(100, 40), 40);
  assert.equal(c.ticketProgress(100, 40, 'avg'), 70);
  assert.equal(c.progressBucket(100), 'done');
  assert.equal(c.progressBucket(99.99), 'mid'); assert.equal(c.progressBucket(50), 'mid');
  assert.equal(c.progressBucket(49.99), 'low');
});

test('total berat JO = jumlah net weight (kg) / 1000, tampil ton', () => {
  assert.equal(c.joTotalTon([8120, 8140, 8090]), 24.35);
  assert.equal(c.kgToTon(2760860), 2760.86);
  assert.equal(c.tonToKg(2760.86), 2760860);
  assert.equal(c.joTotalTon([]), 0);
});

test('total di surat jalan = jumlah berat material / 1000 (MT)', () => {
  assert.equal(c.sjTotalMT([8187, 8207, 8157, 7162, 7162, 7162]), 46.04);
  assert.equal(c.sjTotalMT([61570]), 61.57);
});

test('berat deklarasi vs total material: peringatan jika selisih > ambang', () => {
  assert.equal(c.weightMismatch(10000, 10040, 0.5), false);
  assert.equal(c.weightMismatch(10000, 10100, 0.5), true);
  assert.equal(c.weightMismatch(0, 10100, 0.5), false);
});
