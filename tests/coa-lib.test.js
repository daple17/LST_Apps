const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../lib/coa');
const seed = require('../migrations/data/coa-seed.json');

test('normalisasi jenis dan penulisan baku', () => {
  assert.equal(C.normJenis('Activa/Asset'), 'ASET'); assert.equal(C.normJenis('Beban'), 'BEBAN'); assert.equal(C.normJenis('Expense'), 'BEBAN');
  assert.equal(C.normJenis('Revenue'), 'REVENUE'); assert.equal(C.normJenis('Liabilitas'), 'LIABILITAS'); assert.equal(C.normJenis('Ekuitas'), 'EKUITAS'); assert.equal(C.normJenis('xx'), null);
  for (const [a, b] of [['Biaya non ops', 'Biaya Non Ops'], ['Pendapatan non ops', 'Pendapatan Non Ops'], ['Modal ditahan', 'Modal Ditahan'], ['Pendapatan Opersional', 'Pendapatan Operasional'],
    ['Biaya Adminstrasi dan Umum', 'Biaya Administrasi dan Umum'], ['pendapatan lain-lain', 'Pendapatan Lain-lain'], ['  Biaya   Trucking ', 'Biaya Trucking']]) assert.equal(C.normHeaderText(a), b, a);
  assert.equal(C.cleanName('TRUCKING CONTAINER '), 'TRUCKING CONTAINER'); assert.equal(C.cleanName('a   b'), 'a b'); assert.equal(C.cleanName('Crane Mobil'), 'Crane Mobil'); // huruf besar/kecil dibiarkan
  assert.ok(C.CODE_RE.test('11010') && !C.CODE_RE.test('01010') && !C.CODE_RE.test('1101') && !C.CODE_RE.test('110100') && !C.CODE_RE.test('1101a'));
  assert.deepEqual(C.JENIS.filter(j => j.hasGroup).map(j => j.code), ['REVENUE', 'BEBAN']);
});

test('buildSeed: baris kosong, galat data, kode ganda dilaporkan', () => {
  const ok = { row: 2, code: 11010, name: 'KAS KECIL ', jenis: 'Activa/Asset', sub_header: 'Aktiva Lancar', group: null };
  const r = C.buildSeed([ok, { row: 3 }, { row: 4, code: null, name: null }], { taxonomy: [] });
  assert.equal(r.accounts.length, 1); assert.equal(r.accounts[0].name, 'KAS KECIL'); assert.equal(r.accounts[0].group_account, '');
  assert.throws(() => C.buildSeed([{ ...ok, code: 1234 }]), /bukan 5 angka/);
  assert.throws(() => C.buildSeed([{ ...ok, jenis: 'Aneh' }]), /tidak dikenal/);
  assert.throws(() => C.buildSeed([{ ...ok, sub_header: '' }]), /Sub Header kosong/);
  assert.throws(() => C.buildSeed([{ row: 5, code: 41010, name: 'X PENDAPATAN', jenis: 'Revenue', sub_header: 'Pendapatan Operasional', group: '' }]), /wajib punya Group/);
  assert.match(C.buildSeed([{ ...ok, group: 'Salah' }], { taxonomy: [] }).warnings[0], /diabaikan untuk Aset/);   // neraca: group diabaikan, bukan dibuang diam-diam
  const dup = [{ row: 2, code: 45155, name: 'CRANE', jenis: 'Revenue', sub_header: 'a', group: 'b' }, { row: 3, code: 45155, name: 'EXCAVATOR', jenis: 'Revenue', sub_header: 'a', group: 'b' }];
  const d = C.buildSeed(dup, { taxonomy: [] }); assert.deepEqual(d.accounts.map(a => a.name), ['CRANE']);
  assert.deepEqual(d.conflicts[0], { code: 45155, kept: { row: 2, name: 'CRANE' }, dropped: [{ row: 3, name: 'EXCAVATOR' }], reason: d.conflicts[0].reason });
  assert.throws(() => C.buildSeed(dup.map(x => ({ ...x, code: 45999 })), { taxonomy: [] }), /Kode ganda 45999.*tanpa keputusan/);
});

test('keutuhan data awal COA (coa-seed.json)', () => {
  assert.equal(seed.accounts.length, 365);
  assert.equal(new Set(seed.accounts.map(a => a.code)).size, 365);                                   // kode unik
  const per = {}; for (const a of seed.accounts) per[a.jenis] = (per[a.jenis] || 0) + 1;
  assert.deepEqual(per, { ASET: 31, LIABILITAS: 12, EKUITAS: 4, REVENUE: 126, BEBAN: 192 });
  assert.equal(seed.headers.length, 30);
  assert.equal(new Set(seed.headers.map(C.headerKey)).size, 30);
  const keys = new Set(seed.headers.map(C.headerKey));
  for (const a of seed.accounts) {
    assert.ok(C.CODE_RE.test(String(a.code)), a.code); assert.ok(a.name.length >= C.NAME_MIN && a.name === a.name.trim() && !/\s{2}/.test(a.name), a.code);
    assert.ok(keys.has(C.headerKey(a)), `kelompok ${a.code}`);
    assert.equal(!!a.group_account, C.hasGroup(a.jenis), `group vs jenis ${a.code}`);                // neraca tanpa group; revenue/beban wajib
  }
  for (const h of seed.headers) { assert.equal(!!h.group_account, C.hasGroup(h.jenis)); assert.ok(h.sub_header.length <= C.HEADER_MAX && h.group_account.length <= C.HEADER_MAX); }
  // penulisan baku: tidak ada varian lama
  const text = JSON.stringify([seed.headers, seed.accounts.map(a => [a.sub_header, a.group_account])]);
  for (const bad of ['Biaya non ops', 'Pendapatan non ops', 'Modal ditahan', 'Opersional', 'Adminstrasi', 'Activa', 'Expense']) assert.ok(!text.includes(bad), bad);
  // nama sama boleh di Revenue dan Beban (yang unik hanya kode)
  const handling = seed.accounts.filter(a => a.name === 'HANDLING IMPOR'); assert.deepEqual(handling.map(a => a.code).sort(), [41010, 51010]);
  // kode ganda: keputusan tercatat
  assert.deepEqual(seed.conflicts.map(c => [c.code, c.kept.name, c.dropped.map(d => d.name)]), [[45155, 'CRANE', ['EXCAVATOR']], [45165, 'ADM LIFT ON', ['OCEAN FREIGHT FEE']]]);
  assert.ok(!seed.accounts.some(a => a.name === 'EXCAVATOR' || a.name === 'OCEAN FREIGHT FEE'));
  // selisih data vs taksonomi dipertahankan sebagai kelompok terpisah
  const atk = seed.headers.filter(h => h.group_account === 'Biaya ATK').map(h => h.sub_header).sort(); assert.deepEqual(atk, ['Beban Operasi', 'Biaya Operasional']);
  const lain = seed.headers.filter(h => h.group_account === 'Pendapatan Lain-lain').map(h => h.sub_header).sort(); assert.deepEqual(lain, ['Pendapatan Non Ops', 'Pendapatan Operasional']);
  // kelompok dari taksonomi yang belum punya akun tetap ada (mis. Biaya Lain)
  assert.ok(seed.headers.some(h => h.group_account === 'Biaya Lain') && !seed.accounts.some(a => a.group_account === 'Biaya Lain'));
});
