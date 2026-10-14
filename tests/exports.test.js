const test = require('node:test'), assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { toBuffer } = require('../lib/excel');
const { joSheets } = require('../lib/exports');

test('Excel daftar JO: semua kolom tabel + semua nomor referensi', async () => {
  const rows = [{ id: 1, no_jo: '0027BTU', type: 'IMPORT', type_bc: 'BC 2.0', customer_name: 'PT BTU', shipper_name: null, jenis_muatan: 'FCL', vessel: 'SHINLINE 12', party: '300 CL', weight: 2760.86, eta_etd: '2026-10-01', delivery_plan: '2026-10-05', status: 'NOT_COMP', remarks: 'x' }];
  const refs = new Map([[1, [{ kind: 'AJU', number: '000386', ref_date: '2026-10-01' }, { kind: 'AJU', number: '000385', ref_date: null }, { kind: 'INVOICE', number: 'INV1', ref_date: null }]]]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await toBuffer(joSheets(rows, refs)));
  const ws = wb.getWorksheet('Job Order'), head = ws.getRow(1).values.slice(1);
  for (const h of ['No. JO', 'Type', 'Customer', 'Aju Ceisa', 'No. BL', 'No. Invoice', 'No. SI/PO', 'Vessel', 'Party', 'Weight (ton)', 'ETA/ETD', 'Rencana Delivery', 'Status']) assert.ok(head.includes(h), h);
  const r = ws.getRow(2);
  assert.equal(r.getCell('A').value, '0027BTU'); assert.equal(r.getCell('B').value, 'Import');
  assert.equal(r.getCell('F').value, '000386, 000385');         // semua aju, bukan hanya yang pertama
  assert.equal(r.getCell('O').value, 2760.86);                  // angka, bukan teks
  assert.ok(r.getCell('P').value instanceof Date);              // tanggal sungguhan
  assert.equal(r.getCell('R').value, 'Not Complete');
  const refSheet = wb.getWorksheet('Referensi'); assert.equal(refSheet.rowCount, 4);
});
