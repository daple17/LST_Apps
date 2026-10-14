const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../lib/code128');

test('tabel Code 128: 103 pola, tiap pola 6 elemen berjumlah 11 modul dan unik', () => {
  assert.equal(C.P.length, 103);
  for (const p of C.P) { assert.equal(p.length, 6); assert.equal([...p].reduce((a, d) => a + +d, 0), 11); }
  assert.equal(new Set(C.P).size, 103);
});
test('encode: contoh baku "A" (checksum 34)', () => {
  const e = C.encode('A');
  assert.deepEqual(e.values, [104, 33, 34]);
  assert.equal(e.pattern, '211214' + '111323' + '131123' + '2331112');
});
test('encode: pola lengkap = 11 modul per simbol + stop 13 + quiet zone', () => {
  for (const t of ['2026100041', 'CQH4162B', 'IMP-004', 'ASANKWJK012']) {
    const { pattern, values } = C.encode(t);
    assert.equal([...pattern].reduce((a, d) => a + +d, 0), 11 * values.length + 13);   // start+data+checksum (11 modul) + stop (13)
    assert.equal([...pattern].length, 6 * values.length + 7);
    const b = C.bars(t); assert.equal(b.bars[0].x, 10); assert.equal(b.modules, 11 * values.length + 13 + 20); // + quiet zone 10 modul kiri/kanan
  }
});
test('teks tidak valid ditolak', () => {
  assert.throws(() => C.encode(''), /kosong/); assert.throws(() => C.encode('é'), /tidak didukung/);
});
test('svg valid tanpa NaN/undefined', () => {
  const s = C.svg('2026100041'); assert.ok(!/NaN|undefined/.test(s)); assert.match(s, /^<svg /);
});
