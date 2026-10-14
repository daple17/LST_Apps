const test = require('node:test'), assert = require('node:assert/strict');
const f = require('../lib/format');

test('party: parse dan tampil', () => {
  assert.deepEqual(f.parseParty('300 CL'), { qty: 300, unit: 'COIL', text: null });
  assert.deepEqual(f.parseParty('12x40ft'), { qty: 12, unit: '40FT', text: null });
  assert.deepEqual(f.parseParty('590 BE'), { qty: null, unit: null, text: '590 BE' }); // arti "BE" belum jelas: disimpan apa adanya
  assert.equal(f.partyLabel(300, 'COIL'), '300 CL');
  assert.equal(f.partyLabel(12, '40FT'), '12x40ft');
  assert.equal(f.partyLabel(null, null, '590 BE'), '590 BE');
});
test('daftar referensi: pisah koma/baris, hapus duplikat dan kosong', () => {
  assert.deepEqual(f.splitRefs('000386, 000385;\n000386 ,, '), ['000386', '000385']);
  assert.deepEqual(f.splitRefs(null), []);
});
test('format angka Indonesia', () => {
  assert.equal(f.fmtNum(2760.86), '2.760,86');
  assert.equal(f.fmtNum(1200, 0), '1.200');
});
