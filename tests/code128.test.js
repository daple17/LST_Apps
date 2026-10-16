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

test('barcode terbaca pemindai (ZXing): modul bulat, nomor SJ nyata', () => {
  const Z = require('../public/vendor/zxing-library.min.js');
  for (const t of ['2026100041', 'SJ-20261001-01', 'CQH4162B', 'A']) {
    const b = C.bars(t), mw = 2, W = b.modules * mw, H = 40, lum = new Uint8ClampedArray(W * H).fill(255);
    for (const r of b.bars) for (let x = r.x * mw; x < (r.x + r.w) * mw; x++) for (let y = 0; y < H; y++) lum[y * W + x] = 0;
    const res = new Z.MultiFormatReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, W, H))), new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128]]]));
    assert.equal(res.getText(), t);
  }
});
test('svg: latar putih (zona tenang) dan lebar piksel bulat per modul', () => {
  const s = C.svg('SJ-20261001-01'), m = C.bars('SJ-20261001-01').modules;
  assert.match(s, /<rect width="\d+" height="32" fill="#fff"\/>/); assert.match(s, new RegExp(`viewBox="0 0 ${m} 32" width="${m * 2}" height="64"`));   // proporsi viewBox = ukuran gambar: tepat 2 px per modul
});

test('set C: deretan angka dipadatkan, tetap terbaca ZXing (termasuk link surat jalan)', () => {
  const Z = require('../public/vendor/zxing-library.min.js');
  assert.deepEqual(C.encode('1234').values.slice(0, 3), [105, 12, 34]);                       // mulai langsung di set C
  assert.ok(C.encode('2026100041').values.length < C.encode('abcdefghij').values.length);
  for (const t of ['2026100041', '12345', 'ab12345c', 'SJ-20261001-01', 'https://lesat-production.up.railway.app/s/180123456789012', 'x1234y5678']) {
    const b = C.bars(t), mw = 2, W = b.modules * mw, H = 40, lum = new Uint8ClampedArray(W * H).fill(255);
    for (const r of b.bars) for (let x = r.x * mw; x < (r.x + r.w) * mw; x++) for (let y = 0; y < H; y++) lum[y * W + x] = 0;
    assert.equal(new Z.MultiFormatReader().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, W, H))), new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128]]])).getText(), t);
  }
});
test('svg dengan maxWidth memilih lebar modul bulat yang muat', () => {
  const t = 'https://lesat-production.up.railway.app/s/180123456789012', m = C.bars(t).modules, s = C.svg(t, { maxWidth: 840 });
  assert.match(s, new RegExp(`width="${m * Math.max(1, Math.min(2, Math.floor(840 / m)))}"`)); assert.ok(m < 840);
});
