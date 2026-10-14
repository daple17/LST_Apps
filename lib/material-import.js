// Baca file Excel "Upload List" -> baris mentah per kolom Add data. Pemeriksaan isi ada di material-validate.js.
const ExcelJS = require('exceljs');
const { COLUMNS, HEADER_INDEX, norm } = require('./material-validate');
const MAX_ROWS = 5000;

const cellText = c => {
  const v = c?.value;
  if (v == null) return null;
  if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map(x => x.text).join('') : null);
  return v;
};

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('File bukan Excel (.xlsx) yang valid'), { status: 400 }); }
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('File Excel kosong'), { status: 400 });
  const map = {}; // nomor kolom -> key
  ws.getRow(1).eachCell((c, i) => { const k = HEADER_INDEX[norm(cellText(c))]; if (k) map[i] = k; });
  const missing = COLUMNS.filter(c => c.req && !Object.values(map).includes(c.key)).map(c => c.header);
  if (missing.length) throw Object.assign(new Error(`Kolom wajib tidak ditemukan di baris 1: ${missing.join(', ')}. Gunakan Download Template.`), { status: 400 });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), raw = {};
    let any = false;
    for (const [i, key] of Object.entries(map)) { const v = cellText(row.getCell(+i)); raw[key] = v; if (v !== null && String(v).trim() !== '') any = true; }
    if (any) rows.push({ n: r, raw });
    if (rows.length > MAX_ROWS) throw Object.assign(new Error(`Maksimal ${MAX_ROWS} baris per file`), { status: 400 });
  }
  return rows;
}
module.exports = { parseWorkbook };
