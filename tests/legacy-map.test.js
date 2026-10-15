const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../lib/legacy-map');

test('kode customer = nickname lama; bukan 3 huruf ditandai tinjau', () => {
  assert.deepEqual(M.customerCode(' usc '), { code: 'USC', needsReview: false });
  for (const n of ['SIDAN', 'AMIR', 'FADLAN', 'MR', 'UI', 'BW', 'UNPAD', '', null, 'U5C', 'US-']) assert.equal(M.customerCode(n).needsReview, true, String(n));
  assert.equal(M.customerCode('fadlan').code, 'FADLAN');
});

test('nomor JO, tipe, BC, jenis muatan, status', () => {
  assert.deepEqual(M.joNumber(27, 'BTU'), { no_jo: '0027BTU', legacy_no: '27' }); assert.deepEqual(M.joNumber('6034', 'USC'), { no_jo: '6034USC', legacy_no: '6034' });
  assert.deepEqual(M.joNumber(12345, 'ABC'), { no_jo: '12345ABC', legacy_no: '12345' }); assert.deepEqual(M.joNumber(null, 'ABC'), { no_jo: null, legacy_no: null });
  assert.deepEqual([1, 2, 3, 4, 0, 9, null].map(M.jobType), ['IMPORT', 'EXPORT', 'TRUCKING', 'PROJECT', null, null, null]);
  assert.deepEqual(['PIB BC 2.0', 'PIB BC 1.6', 'PIB BC 2.8', 'PIB BC 2.3', 'PEB BC 3.0', 'Pilih', 'Lainnya', '', null, 'PIB  BC 2.0'].map(M.typeBc), ['BC 2.0', 'BC 1.6', 'BC 2.8', 'BC 2.3', 'BC 3.0', null, null, null, null, 'BC 2.0']);
  assert.deepEqual(['FCL', 'LCL', 'lcl', 'x', null].map(M.jenisMuatan), ['FCL', 'LCL_BB', 'LCL_BB', null, null]);
  assert.deepEqual([0, 1, 2, null].map(M.statusJo), ['NOT_COMP', 'COMPLETE', 'COMPLETE', 'NOT_COMP']);
  assert.deepEqual([M.siKind('IMPORT'), M.siKind('EXPORT'), M.siKind('TRUCKING'), M.siKind('PROJECT')], ['SI_DO', 'SI_PO', 'SI_DO', 'SI_DO']);
});

test('peti kemas: daftar, ringkasan, MIX', () => {
  assert.deepEqual(M.containers({ fcl_20: 0, fcl_40: 0 }), { list: [], container_count: null, container_type: null });
  assert.deepEqual(M.containers({ fcl_20: 3 }), { list: [{ size: '20FT', qty: 3 }], container_count: 3, container_type: '20FT' });
  const mix = M.containers({ fcl_20: 2, fcl_40: 1, fcl_45: 0, fcl_ot: 1, fcl_fr: 4 });
  assert.deepEqual(mix.list.map(c => `${c.size}:${c.qty}`), ['20FT:2', '40FT:1', 'OT:1', 'FR:4']); assert.equal(mix.container_count, 8); assert.equal(mix.container_type, 'MIX');
  assert.equal(M.containers({ fcl_45: 1 }).container_type, '45FT'); assert.equal(M.containers({ fcl_20: null, fcl_40: undefined }).container_count, null);
});

test('satuan: padanan, jamak ke tunggal, tak dikenal -> party_text, kosong', () => {
  for (const [a, b] of [['CL', 'COIL'], ['coils', 'COIL'], ['COILS', 'COIL'], ['BUNDLES', 'BUNDLE'], ['-BUNDLES', 'BUNDLE'], ['BUNDL', 'BUNDLE'], ['CT', 'CARTON'], ['ctn', 'CARTON'], ['PX', 'PACKAGE'], ['PK', 'PACKAGE'], ['PACKAGES', 'PACKAGE'], ['Pkgs', 'PACKAGE'],
    ['PLTS', 'PALLET'], ['Pallets', 'PALLET'], ['BG', 'BAG'], ['Cases', 'CASE'], ['WODEN CASE', 'CASE'], ['DR', 'DRUM'], ['RO', 'ROLL'], ['STEEL BOX', 'BOX'], ['PIECE', 'PCS'], ['PCE', 'PCS'], ['  unit ', 'UNIT'], ['UNT', 'UNIT'], ['IBCS', 'IBC']]) assert.deepEqual(M.unitMap(a), { unit: b, party_text: null }, a);
  for (const t of ['BE', 'EE', 'Rit', 'Bulan', 'CL, 930Lbr', 'BE, NE', 'Lbr, 72 CL']) assert.deepEqual(M.unitMap(t), { unit: null, party_text: t }, t);   // tidak ditebak
  for (const t of ['', '  ', null, undefined, '-', '0', 'CONTAINER', 'KONTAINER']) assert.deepEqual(M.unitMap(t), { unit: null, party_text: null }, String(t));
  assert.ok(Object.keys(M.UNIT_MAP.map).every(k => k === k.toUpperCase()));
  assert.equal(M.materialUnit('Container', '40 F'), '40FT'); assert.equal(M.materialUnit('Container', '20 F'), '20FT'); assert.equal(M.materialUnit('Container', '1'), null);
  assert.equal(M.materialUnit('COIL', '40 F'), 'COIL'); assert.equal(M.materialUnit('Package', null), 'PACKAGE'); assert.equal(M.materialUnit('Pieces'), 'PCS'); assert.equal(M.materialUnit('ton'), 'TON'); assert.equal(M.materialUnit('1'), null); assert.equal(M.materialUnit(''), null); assert.equal(M.materialUnit('20'), '20FT');
});

test('referensi: pisah ", ", " dan ", "&", placeholder dibuang', () => {
  assert.deepEqual(M.splitRefsLegacy('A, B dan C'), ['A', 'B', 'C']); assert.deepEqual(M.splitRefsLegacy('A & B'), ['A', 'B']); assert.deepEqual(M.splitRefsLegacy('A;B\nC'), ['A', 'B', 'C']);
  assert.deepEqual(M.splitRefsLegacy('-'), []); assert.deepEqual(M.splitRefsLegacy('.'), []); assert.deepEqual(M.splitRefsLegacy('N/A'), []); assert.deepEqual(M.splitRefsLegacy(null), []); assert.deepEqual(M.splitRefsLegacy('  '), []);
  assert.deepEqual(M.splitRefsLegacy('A,A, B'), ['A', 'B']);                                                  // duplikat digabung
  assert.deepEqual(M.splitRefsLegacy('LAND AND SEA 1'), ['LAND AND SEA 1']);                                 // "AND" huruf besar tanpa spasi pemisah tidak memecah kata lain
  assert.deepEqual(M.splitRefsLegacy('BAND 1 dan BAND 2'), ['BAND 1', 'BAND 2']);
});

test('berat -> kg: Kg, Ton, "Tons" bernilai kg, unit kosong', () => {
  assert.deepEqual(M.weightKg(8120, 'Kg'), { kg: 8120, rule: 'kg' }); assert.deepEqual(M.weightKg(8120, 'KG'), { kg: 8120, rule: 'kg' });
  assert.deepEqual(M.weightKg(8.12, 'Ton'), { kg: 8120, rule: 'ton' }); assert.deepEqual(M.weightKg(1000, 'Tons'), { kg: 1000000, rule: 'ton' });   // batas: > 1000 dianggap kg
  assert.deepEqual(M.weightKg(18909, 'Tons'), { kg: 18909, rule: 'ton_label_kg_value' }); assert.deepEqual(M.weightKg(1000.5, 'ton'), { kg: 1000.5, rule: 'ton_label_kg_value' });
  assert.deepEqual(M.weightKg(250, null), { kg: 250, rule: 'blank_as_kg' }); assert.deepEqual(M.weightKg(100, ''), { kg: 100, rule: 'blank_as_kg' }); assert.deepEqual(M.weightKg(8.5, ''), { kg: 8500, rule: 'blank_as_ton' });
  assert.deepEqual(M.weightKg(99.99, undefined), { kg: 99990, rule: 'blank_as_ton' }); assert.deepEqual(M.weightKg(0, 'Kg'), { kg: 0, rule: 'kg' }); assert.deepEqual(M.weightKg(0, null), { kg: 0, rule: 'blank_as_ton' });
  assert.deepEqual(M.weightKg(null, 'Kg'), { kg: null, rule: 'empty' }); assert.deepEqual(M.weightKg('abc', 'Kg'), { kg: null, rule: 'empty' });
  assert.equal(M.tonToKg(2.76), 2760); assert.equal(M.tonToKg(0), 0); assert.equal(M.tonToKg(null), null); assert.equal(M.tonToKg(1.2345), 1234.5);
  assert.equal(M.thicknessNum('1.5'), 1.5); assert.equal(M.thicknessNum('1,5'), 1.5); assert.equal(M.thicknessNum('0.8x1250'), null); assert.equal(M.thicknessNum(''), null);
});

test('ukuran kontainer, ISO vs bentuk lain, nomor material, nomor ganda', () => {
  assert.deepEqual(['20 F', '40 F', '45 F', '1', 'BB', '41 F', '', null, '40F'].map(M.containerSize), ['20', '40', '45', null, 'BB', '41 F', null, null, '40']);
  assert.equal(M.isIsoContainer('MSKU1234567'), true); assert.equal(M.isIsoContainer('msku1234567'), true); assert.equal(M.isIsoContainer('WING BOX'), false); assert.equal(M.isIsoContainer('MSKU123456'), false); assert.equal(M.isIsoContainer(null), false);
  assert.deepEqual(['abc-1', ' c 2 ', '-', '', null].map((n, i) => M.productNo(n, i + 10)), ['ABC-1', 'C 2', 'TANPA-NOMOR-12', 'TANPA-NOMOR-13', 'TANPA-NOMOR-14']);
  const d = M.dedupeProductNos([{ id: 5, jo_id: 1, product_no: 'A1' }, { id: 3, jo_id: 1, product_no: 'A1' }, { id: 9, jo_id: 1, product_no: 'a1' }, { id: 4, jo_id: 2, product_no: 'A1' }, { id: 7, jo_id: 1, product_no: 'B' }]);
  assert.deepEqual(d.rows.map(r => `${r.id}:${r.product_no}`).sort(), ['3:A1', '4:A1', '5:A1#2', '7:B', '9:a1#3'].sort());              // urut menurut id; JO lain tidak bentrok
  assert.deepEqual(d.changes.map(c => [c.id, c.to]), [[5, 'A1#2'], [9, 'a1#3']]);
  const long = 'X'.repeat(60), d2 = M.dedupeProductNos([{ id: 1, jo_id: 1, product_no: long }, { id: 2, jo_id: 1, product_no: long }]); assert.equal(d2.rows[1].product_no.length, 60); assert.ok(d2.rows[1].product_no.endsWith('#2'));
});

test('status kerusakan, baris uji, pengguna, kode vendor', () => {
  assert.deepEqual([null, 0, 1, 2, '', 7, '2'].map(M.damageStatus), ['NOT_CHECKED', 'NOT_CHECKED', 'OK', 'DAMAGE', 'NOT_CHECKED', 'NOT_CHECKED', 'DAMAGE']);
  for (const r of [{ descr_barang: 'Material bagus' }, { nomor: 'TEST' }, { descr_barang: 'tes' }, { nomor: 'Coba 2' }, { descr_barang: ' test 12 ' }]) assert.equal(M.isTestRow(r), true, JSON.stringify(r));
  for (const r of [{ descr_barang: 'GALVANIZED COIL' }, { nomor: 'TESTA-1' }, { descr_barang: 'testing steel' }, { nomor: null, descr_barang: null }, { nomor: 'C-123' }]) assert.equal(M.isTestRow(r), false, JSON.stringify(r));
  assert.equal(M.isTestRow({ descr_barang: 'percobaan' }, ['percobaan']), true);                              // daftar dapat dikonfigurasi
  assert.equal(M.validEmail('Budi@Mail.COM'), 'budi@mail.com'); assert.equal(M.validEmail('bukan email'), null); assert.equal(M.validEmail(''), null); assert.equal(M.username(' Arjun '), 'arjun');
  const taken = new Set();
  assert.deepEqual(M.vendorCode('MJL', 'MJL TRANS', taken), { code: 'MJL', needsReview: false });
  assert.deepEqual(M.vendorCode('MJL', 'MJL LAIN', taken), { code: 'ML01', needsReview: true });             // ganda -> turunan nama
  assert.equal(M.vendorCode('-', 'PT Dharma Putra Sejati', taken).code, 'DPS01'); assert.equal(M.vendorCode('', 'PT Dharma Putra Sejati', taken).code, 'DPS02'); assert.equal(M.vendorCode(null, '', taken).code, 'VND01');
  assert.equal(M.vendorCode('1', 'CV Abadi Jaya', taken).needsReview, true);
  assert.equal(M.cleanText(' - '), null); assert.equal(M.cleanText('  Jakarta   Utara '), 'Jakarta Utara'); assert.equal(M.cleanText(null), null);
});
