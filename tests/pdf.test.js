const test = require('node:test'), assert = require('node:assert/strict');
const { sjPdf } = require('../lib/pdf');
const { ticketReportText } = require('../lib/report-text');

// teks dari PDF tanpa kompresi: pdfkit menulis teks standar sebagai string heksadesimal
const pdfText = buf => [...buf.toString('latin1').matchAll(/<([0-9a-f]{2,})>/gi)].map(m => Buffer.from(m[1], 'hex').toString('latin1')).join('').replace(/\s+/g, '');   // spasi dibuang: pdfkit memecah teks per kerning
const pages = buf => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;

const data = (n = 6) => ({ no_sj: '2026100086', nopol: 'B 9854 TEJ', driver: 'YANTO', phone: '0812345', vendor_name: 'LST', start_loading: '2026-10-14 03:00:00', finish_loading: '2026-10-14 04:20:00', entry_at: '2026-10-14 10:05', exit_at: null,
  pic_name: 'Administrator', customer: 'PT UNITED STEEL SERVICE INDONESIA', origin: 'PRIOK', destination: 'CIBITUNG', jo_numbers: '0024USC', invoices: 'INV-1', bl: 'ASANKWJK012', vessel: 'SHINLINE 12', party: '300 CL', weight_ton: 61.57,
  nopen: '123456 (14-10-2026)', aju: '000386',
  items: Array.from({ length: n }, (_, i) => ({ product_no: `CQH41${i}B`, description: 'GALVANIZED COIL', spec: 'JAC270C', qty: 1, weight: 8120 + i, mark: i === 1 ? 'DAMAGE' : 'GOOD' })), unit: 'COIL', total_qty: n, total_weight_kg: 61570 });

test('PDF Surat Jalan: A4 satu halaman berisi data muatan, truk, tabel material, total MT, kolom tulis tangan', async () => {
  const buf = await sjPdf(data(), { compress: false });
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.equal(pages(buf), 1);
  assert.match(buf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const t = pdfText(buf);
  for (const want of ['PT LIMA SARANA TRANS', 'SURAT JALAN', '2026100086', 'PT UNITED STEEL SERVICE INDONESIA', 'CIBITUNG', 'ASANKWJK012', '123456 (14-10-2026)', 'B 9854 TEJ', 'YANTO', 'PIC OPS', 'Administrator', 'CQH410B', 'Good', 'Damage', '61,57 MT', 'Masuk Pabrik', 'Keluar Pabrik', 'Scan barcode atau QR untuk melihat surat jalan digital'])
    assert.ok(t.includes(want.replace(/\s+/g, '')), `PDF harus memuat "${want}"`);
});
test('PDF Surat Jalan: material banyak berlanjut ke halaman berikutnya (header tabel diulang)', async () => {
  const buf = await sjPdf(data(60), { compress: false });
  assert.ok(pages(buf) >= 2); assert.ok((pdfText(buf).match(/Product\/Cont/g) || []).length >= 2);
});

test('Copy Report: format ringkas siap tempel WhatsApp', () => {
  const t = ticketReportText({ ticket_no: '2026101301AD', pic_name: 'Admin', customer: 'PT X', vessel: 'MSC BEIRA', party: '10 CL', weight: 91.28, mat_pct: 57, del_pct: 34.5, ok: 10, dm: 1, nc: 5,
    trips: [{ nopol: 'B 1 X', driver: 'BUDI', vendor_code: 'LST', qty: 7, unit: 'COIL', destination: 'CIBITUNG' }, { nopol: 'B 2 Y', driver: 'ANI', qty: 3, unit: 'COIL', destination: null }] });
  assert.match(t, /^\*HANDLING OPS 2026101301AD\*/);
  for (const want of ['Customer: PT X', 'Vessel: MSC BEIRA', 'Report Material: 57% (OK 10 | Damage 1 | Belum dicek 5)', 'Trucking Delivery: 34,5% (2 rit)', '1. B 1 X - BUDI (LST) - 7 COIL - CIBITUNG', '2. B 2 Y - ANI - 3 COIL - -']) assert.ok(t.includes(want), want);
});
