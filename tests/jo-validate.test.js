const test = require('node:test'), assert = require('node:assert/strict');
const { validateJo } = require('../lib/jo-validate');
const fields = b => validateJo(b).map(e => e.field).sort();

const full = {
  customer_id: 1, jenis_muatan: 'FCL', type_bc: 'BC 2.0', vessel: 'V', eta_etd: '2026-10-01', delivery_plan: '2026-10-05', container_count: 2, container_type: '40FT',
  weight: 10, qty: 5, unit: 'COIL', references: [{ kind: 'AJU', number: '1' }, { kind: 'INVOICE', number: 'I' }, { kind: 'SI_PO', number: 'P' }],
};

test('Import: ketat (aju, invoice, BC, vessel, ETA, kontainer, weight, qty wajib; SI/PO tidak ada)', () => {
  assert.deepEqual(fields({ type: 'IMPORT' }), ['INVOICE', 'containers', 'customer', 'delivery_plan', 'eta_etd', 'jenis_muatan', 'qty', 'type_bc', 'vessel', 'weight']);
  assert.deepEqual(fields({ ...full, type: 'IMPORT' }), []);                                 // SI/PO tidak wajib untuk Import
});
test('Export: wajib SI/PO, SI/DO tidak ada', () => {
  assert.ok(fields({ ...full, type: 'EXPORT', references: [{ kind: 'AJU', number: '1' }, { kind: 'INVOICE', number: 'I' }] }).includes('SI_PO'));
  assert.deepEqual(fields({ ...full, type: 'EXPORT' }), []);
});
test('Trucking dan Project: longgar (hanya customer, jenis muatan, delivery plan)', () => {
  for (const type of ['TRUCKING', 'PROJECT']) {
    assert.deepEqual(fields({ type }), ['customer', 'delivery_plan', 'jenis_muatan']);
    assert.deepEqual(fields({ type, customer_id: 1, jenis_muatan: 'LCL_BB', delivery_plan: '2026-10-05' }), []);
  }
});
test('kontainer butuh jumlah DAN jenis; party teks cukup sebagai qty', () => {
  assert.ok(fields({ ...full, type: 'IMPORT', container_type: '' }).includes('containers'));
  assert.ok(!fields({ ...full, type: 'IMPORT', qty: null, unit: null, party: '300 CL' }).includes('qty'));
});
test('nomor referensi kosong/spasi tidak dihitung', () => {
  assert.ok(fields({ ...full, type: 'IMPORT', references: [{ kind: 'AJU', number: '  ' }, { kind: 'INVOICE', number: 'I' }] }).includes('AJU') === false);   // Aju opsional
});
