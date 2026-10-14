const test = require('node:test'), assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const mv = require('../lib/material-validate');
const { parseWorkbook } = require('../lib/material-import');
const { toBuffer } = require('../lib/excel');
const { materialTemplateSheets } = require('../lib/exports');

const ok = { product_no: 'C1', kondisi: 'Intact', description: 'COIL', net_weight: '8.120', gross_weight: 8187, qty: '1', unit: 'coil', origin: 'PRIOK', destination: 'CIBITUNG' };

test('angka: format Indonesia dan biasa', () => {
  assert.equal(mv.parseNum('8.120'), 8120); assert.equal(mv.parseNum('1.245,5'), 1245.5); assert.equal(mv.parseNum('8,5'), 8.5); assert.equal(mv.parseNum(0.7), 0.7);
  assert.equal(mv.parseNum(''), null); assert.ok(Number.isNaN(mv.parseNum('abc')));
});
test('baris valid dinormalkan (kondisi kosong = INTACT, satuan huruf besar)', () => {
  const m = mv.normalize({ ...ok, kondisi: '' }), r = mv.validate(m);
  assert.deepEqual(r.errors, []); assert.equal(m.kondisi, 'INTACT'); assert.equal(m.unit, 'COIL'); assert.equal(m.net_weight, 8120);
});
test('isian wajib dan angka tidak valid ditandai', () => {
  const e = mv.validate(mv.normalize({ product_no: '', net_weight: 'x', qty: '1.5', unit: 'COIL', origin: 'A', destination: 'B', gross_weight: 1, description: 'D', kondisi: 'Rusak' })).errors;
  assert.ok(e.includes('Product/Container No wajib diisi')); assert.ok(e.includes('Net Weight harus angka ≥ 0')); assert.ok(e.includes('Quantity harus bilangan bulat ≥ 1')); assert.ok(e.some(x => /Intact\/Partial/.test(x)));
});
test('net lebih besar dari gross hanya peringatan', () => {
  const r = mv.validate(mv.normalize({ ...ok, net_weight: 9000, gross_weight: 8000 }));
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1);
});
test('nomor produk ganda dalam file dan terhadap JO ditolak', () => {
  const items = [1, 2, 3, 4].map(n => ({ n, data: { product_no: ['A', 'a', 'B', 'C'][n - 1] }, errors: [] }));
  mv.markDuplicates(items, new Set(['c']));
  assert.deepEqual(items.map(i => i.errors.length), [0, 1, 0, 1]);
  assert.match(items[1].errors[0], /baris 1/); assert.match(items[3].errors[0], /sudah ada di JO/);
});

test('template: kolom persis Add data, bisa dibaca kembali oleh importer', async () => {
  const buf = await toBuffer(materialTemplateSheets());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.getWorksheet('Material').getRow(1).values.slice(1), mv.COLUMNS.map(c => c.header + (c.req ? '*' : '')));
  const rows = await parseWorkbook(buf);
  assert.equal(rows.length, 1);
  const item = mv.normalize(rows[0].raw); assert.deepEqual(mv.validate(item).errors, []); assert.equal(item.product_no, 'CQH4162B'); assert.equal(item.net_weight, 8120);
});
test('importer: kolom wajib hilang ditolak, baris kosong dilewati, urutan kolom bebas', async () => {
  const mk = async (cols, rows) => toBuffer([{ name: 'S', columns: cols.map(h => ({ header: h, key: h })), rows }]);
  await assert.rejects(parseWorkbook(await mk(['Product/Container No', 'Spec'], [])), /Kolom wajib tidak ditemukan/);
  const all = mv.COLUMNS.map(c => c.header).reverse();
  const buf = await mk(all, [{ 'Product/Container No': 'X1', Description: 'D' }, {}, { 'Product/Container No': 'X2' }]);
  const rows = await parseWorkbook(buf);
  assert.deepEqual(rows.map(r => [r.n, r.raw.product_no]), [[2, 'X1'], [4, 'X2']]);
  await assert.rejects(parseWorkbook(Buffer.from('bukan excel')), /bukan Excel/);
});
