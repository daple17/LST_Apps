const test = require('node:test'), assert = require('node:assert/strict');
const F = require('../lib/idfmt');

test('tanggal header: hari + tanggal lengkap bahasa Indonesia', () => {
  assert.equal(F.longDate('2025-06-10'), 'Selasa, 10 Juni 2025');
  assert.equal(F.longDate(new Date('2026-10-14T05:00:00Z')), 'Rabu, 14 Oktober 2026');
  assert.equal(F.longDate(new Date('2026-10-13T20:00:00Z')), 'Rabu, 14 Oktober 2026');   // 03:00 WIB sudah hari berikutnya
});
test('tanggal tabel: 10 Jun 2025', () => {
  assert.equal(F.shortDate('2025-06-10'), '10 Jun 2025'); assert.equal(F.shortDate('2026-08-01'), '1 Agu 2026'); assert.equal(F.shortDate(null), '-');
  assert.equal(F.shortDate('2026-10-14 03:00:00'), '14 Okt 2026');
});
test('Age: +N hari, hari yang sama 0, memakai hari WIB', () => {
  const now = new Date('2025-06-12T10:00:00Z');
  assert.equal(F.ageDays('2025-06-10', now), 2); assert.equal(F.ageLabel(2), '+2');
  assert.equal(F.ageDays('2025-06-12', now), 0); assert.equal(F.ageLabel(0), '0');
  assert.equal(F.ageDays('2025-06-11 20:00:00', now), 0);        // 03:00 WIB tanggal 12 = hari yang sama
  assert.equal(F.ageDays('2025-06-13', now), -1);
});
test('nama depan dan singkatan customer', () => {
  assert.equal(F.firstName('Imam Maulana'), 'Imam'); assert.equal(F.firstName('  Administrator '), 'Administrator'); assert.equal(F.firstName(''), '');
  assert.equal(F.shortCustomer('PT UNITED STEEL SERVICE INDONESIA'), 'UNITED STEEL SERVICE…'); assert.equal(F.shortCustomer('PT NIPRO INDONESIA JAYA'), 'NIPRO INDONESIA JAYA'); assert.equal(F.shortCustomer('CT ADVANCE TECHNOLOGY'), 'CT ADVANCE TECHNOLOGY');
});
