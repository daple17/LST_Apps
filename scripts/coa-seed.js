// Membaca account_codes.xlsx (sheet "Account Code", kolom A-E) -> migrations/data/coa-seed.json. Jalankan ulang hanya bila sumber berubah:
//   node scripts/coa-seed.js "<path ke account_codes.xlsx>"
const fs = require('fs'), path = require('path'), ExcelJS = require('exceljs');
const { buildSeed } = require('../lib/coa');

const cell = v => (v && typeof v === 'object' ? (v.richText ? v.richText.map(t => t.text).join('') : v.result !== undefined ? v.result : v.text ?? null) : v);
async function main() {
  const src = process.argv[2];
  if (!src) throw new Error('Pakai: node scripts/coa-seed.js <account_codes.xlsx>');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(src);
  const ws = wb.getWorksheet('Account Code'); if (!ws) throw new Error('Sheet "Account Code" tidak ada');
  const raw = [];
  ws.eachRow({ includeEmpty: false }, (r, i) => { if (i > 1) raw.push({ row: i, code: cell(r.getCell(1).value), name: cell(r.getCell(2).value), jenis: cell(r.getCell(3).value), sub_header: cell(r.getCell(4).value), group: cell(r.getCell(5).value) }); }); // kolom I-K hanya daftar filter
  const seed = buildSeed(raw);
  const out = { source: path.basename(src), ...seed };
  const dest = path.join(__dirname, '..', 'migrations', 'data', 'coa-seed.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
  const per = {}; for (const a of seed.accounts) per[a.jenis] = (per[a.jenis] || 0) + 1;
  console.log(`${seed.accounts.length} akun, ${seed.headers.length} kelompok`, per);
  for (const c of seed.conflicts) console.log(`KODE GANDA ${c.code}: diimpor ${c.kept.name}; tidak diimpor ${c.dropped.map(d => d.name).join(', ')}`);
  for (const w of seed.warnings) console.log('PERINGATAN', w);
  console.log('→', dest);
}
main().catch(e => { console.error(e.message); process.exit(1); });
