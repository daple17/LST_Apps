// Pembuat berkas .xlsx (daftar JO, tiket, Report Material, template). Data & kolom disiapkan di lib/exports.js.
const ExcelJS = require('exceljs');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// sheets: [{ name, columns: [{header, key, width, numFmt}], rows: [{...}], note }]
async function toBuffer(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'meLESAT'; wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = s.columns.map(c => ({ header: c.header, key: c.key, width: c.width || 16, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    s.rows.forEach(r => ws.addRow(r));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14689E' } };
    h.alignment = { vertical: 'middle', wrapText: true };
    h.height = 22;
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const send = async (res, name, sheets) => {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(await toBuffer(sheets));
};
// 'YYYY-MM-DD' / Date -> Date (UTC) agar tampil sebagai tanggal di Excel
const toDate = v => (v ? (v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00Z')) : null);
module.exports = { XLSX_MIME, toBuffer, send, toDate };
