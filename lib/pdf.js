// PDF server-side (pdfkit, tanpa browser): Surat Jalan A4. Font bawaan PDF (Helvetica) — pakai karakter ASCII/Latin saja.
const PDFDocument = require('pdfkit'), path = require('path'), fs = require('fs');
const Code128 = require('./code128'), fmt = require('./format'), calc = require('./calc');
const LOGO = path.join(__dirname, '..', 'public', 'logo.png');
const BLUE = '#14538a', INK = '#000000', MUT = '#444444';
const COMPANY = { name: 'PT LIMA SARANA TRANS', lines: ['Jakarta Garden City Rukan Avenue', 'Block C8 No. 53, Cakung Timur, Cakung', 'Jakarta Timur, DKI Jakarta'] };

const wib = v => { const ms = calc.toMs(v); return ms == null ? '' : new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).replace(/\./g, ':').replace(',', '') + ' WIB'; };
const wibLocal = v => (v ? String(v).replace('T', ' ').slice(0, 16) : ''); // DATETIME tanpa zona (isian tangan: masuk/keluar pabrik)

function collect(doc) { return new Promise((ok, no) => { const b = []; doc.on('data', c => b.push(c)); doc.on('end', () => ok(Buffer.concat(b))); doc.on('error', no); }); }
const safe = v => String(v ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');

function header(doc, title, no) {
  const x = doc.page.margins.left, w = doc.page.width - x - doc.page.margins.right;
  if (fs.existsSync(LOGO)) doc.image(LOGO, x, 36, { width: 44 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(COMPANY.name, x + 54, 38);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUT).text(COMPANY.lines.join('\n'), x + 54, 53, { lineGap: 1 });
  doc.moveTo(x, 92).lineTo(x + w, 92).lineWidth(1.2).strokeColor(INK).stroke();
  doc.fillColor(INK);
  if (no) doc.font('Helvetica-Bold').fontSize(10).text(`No. ${no}`, x, 100, { width: w, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(22).text(title, x, 114, { width: w, align: 'center', characterSpacing: 1 });
  doc.y = 150;
}
// pasangan label : nilai, dua kolom
function kvBlock(doc, rows, { x, y, w, labelW = 82 }) {
  let cy = y;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(k, x, cy, { width: labelW });
    doc.font('Helvetica').fontSize(9).text(': ' + safe(v || '-'), x + labelW, cy, { width: w - labelW });
    cy = Math.max(cy + 13, doc.y + 2);
  }
  return cy;
}
function barcode(doc, text, x, y, h = 38, mw = 1.25) {
  const b = Code128.bars(text);
  doc.fillColor('#000');
  for (const r of b.bars) doc.rect(x + r.x * mw, y, r.w * mw, h).fill();
  return b.modules * mw;
}

// d: lihat routes/handling.js (GET /sj/:id/pdf)
async function sjPdf(d, { compress = true } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, compress, info: { Title: `Surat Jalan ${d.no_sj}`, Author: COMPANY.name } }), done = collect(doc);
  const x = 36, W = doc.page.width - 72;
  header(doc, 'SURAT JALAN', d.no_sj);

  let y = kvBlock(doc, [['Customer', d.customer], ['Address Destination', d.destination], ['From', d.origin]], { x, y: 150, w: W, labelW: 110 }) + 4;
  const left = [['Job Order', d.jo_numbers], ['Invoice', d.invoices], ['B/L', d.bl], ['Vessel', d.vessel]], right = [['Party', d.party], ['Weight', d.weight_ton != null ? `${fmt.fmtNum(d.weight_ton)} ton` : ''], ['Nopen / Tgl', d.nopen], ['No. Aju', d.aju]];
  const y1 = kvBlock(doc, left, { x, y, w: W / 2 - 8 }), y2 = kvBlock(doc, right, { x: x + W / 2 + 8, y, w: W / 2 - 8 });
  y = Math.max(y1, y2) + 8;

  // tabel material
  const cols = [['No', 24, 'c'], ['Product/Cont', 112, 'l'], ['Desc & Spec', 190, 'l'], ['Qty', 38, 'r'], ['Weight (kg)', 70, 'r'], ['Marks', 0, 'l']];
  cols[5][1] = W - cols.slice(0, 5).reduce((a, c) => a + c[1], 0);
  const drawHead = yy => {
    doc.rect(x, yy, W, 16).fillAndStroke('#eef3f8', '#000'); doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5);
    let cx = x; for (const [n, w, a] of cols) { doc.text(n, cx + 3, yy + 4, { width: w - 6, align: a === 'c' ? 'center' : a === 'r' ? 'right' : 'left' }); cx += w; }
    return yy + 16;
  };
  y = drawHead(y);
  doc.font('Helvetica').fontSize(8.5);
  d.items.forEach((it, i) => {
    const desc = safe([it.description, it.spec].filter(Boolean).join(' ')), h = Math.max(15, doc.heightOfString(desc, { width: cols[2][1] - 6 }) + 6);
    if (y + h > doc.page.height - 190) { doc.addPage(); y = drawHead(36); doc.font('Helvetica').fontSize(8.5); }
    doc.rect(x, y, W, h).strokeColor('#999').lineWidth(0.5).stroke(); doc.fillColor(INK);
    const cells = [String(i + 1), safe(it.product_no), desc, fmt.fmtNum(it.qty, 0), fmt.fmtNum(it.weight, 0), it.mark === 'DAMAGE' ? 'Damage' : it.mark === 'GOOD' ? 'Good' : '-'];
    let cx = x; cols.forEach(([, w, a], k) => { doc.fillColor(k === 5 && it.mark === 'DAMAGE' ? '#b42318' : k === 5 && it.mark === 'GOOD' ? '#1a7f45' : INK).text(cells[k], cx + 3, y + 4, { width: w - 6, align: a === 'c' ? 'center' : a === 'r' ? 'right' : 'left' }); cx += w; });
    y += h;
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(`Total: ${fmt.fmtNum(d.total_qty, 0)} ${d.unit || ''}     ${fmt.fmtNum(calc.sjTotalMT([d.total_weight_kg]))} MT`, x, y + 8, { width: W, align: 'center' });
  y += 34;

  // data truk + kolom isian tangan
  if (y > doc.page.height - 170) { doc.addPage(); y = 50; }
  const ty = kvBlock(doc, [['Nopol', d.nopol], ['Driver', d.driver], ['No. HP', d.phone], ['PIC OPS', d.pic_name]], { x, y, w: W / 2 - 8, labelW: 50 });
  const bx = x + W / 2 + 8, bw = W / 2 - 8;
  for (const [i, [label, val]] of [['Tanggal dan Waktu Masuk Pabrik', d.entry_at], ['Tanggal dan Waktu Keluar Pabrik', d.exit_at]].entries()) {
    const by = y + i * 52;
    doc.rect(bx, by, bw, 46).lineWidth(1.4).strokeColor('#000').stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(label, bx + 5, by + 4, { width: bw - 10, underline: true });
    if (val) doc.font('Helvetica').fontSize(10).text(wibLocal(val), bx + 5, by + 24);
  }
  const code = d.link || d.no_sj, mods = Code128.bars(code).modules, mw = Math.min(1.25, W / mods), by = Math.max(ty, y + 108) + 10;     // isi barcode = link surat jalan digital; mw menyesuaikan lebar kertas
  barcode(doc, code, x + (W - mods * mw) / 2, by, 38, mw);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUT).text(`Scan barcode untuk melihat surat jalan digital  ·  ${d.no_sj}`, x, by + 44, { width: W, align: 'center' });
  if (d.start_loading || d.finish_loading) doc.fontSize(7.5).text(`Start loading: ${wib(d.start_loading) || '-'}   Finish loading: ${wib(d.finish_loading) || '-'}   Vendor: ${safe(d.vendor_name || '-')}`, x, by + 60, { width: W, align: 'center' });
  doc.end();
  return done;
}

// Damage report per material: data material, remarks, foto (JPEG/PNG)
async function damagePdf(d, { compress = true } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, compress, info: { Title: `Damage Report ${d.product_no}`, Author: COMPANY.name } }), done = collect(doc);
  const x = 36, W = doc.page.width - 72;
  header(doc, 'DAMAGE REPORT', d.ticket_no);
  const rows = [['Product/Container No', d.product_no], ['Description', d.description], ['Spec', d.spec], ['Job Order', d.jo_no], ['No. BL', d.bl_no], ['Customer', d.customer], ['Vessel', d.vessel],
    ['Qty', `${fmt.fmtNum(d.qty, 0)} ${d.unit || ''}`], ['Net / Gross (kg)', `${fmt.fmtNum(d.net_weight, 0)} / ${fmt.fmtNum(d.gross_weight, 0)}`], ['Dari - Tujuan', `${d.origin || '-'} - ${d.destination || '-'}`], ['Diperiksa oleh', `${d.checked_by || '-'}   ${wib(d.checked_at)}`]];
  let y = kvBlock(doc, rows, { x, y: 150, w: W, labelW: 120 }) + 8;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Remarks', x, y); y += 14;
  const rh = Math.max(40, doc.heightOfString(safe(d.remarks), { width: W - 12 }) + 12);
  doc.rect(x, y, W, rh).lineWidth(1).strokeColor('#000').stroke(); doc.font('Helvetica').fontSize(10).text(safe(d.remarks) || '-', x + 6, y + 6, { width: W - 12 }); y += rh + 14;
  doc.font('Helvetica-Bold').fontSize(10).text(`Foto (${d.photos.length})`, x, y); y += 16;
  const cw = (W - 12) / 2, ch = 190;
  for (const [i, ph] of d.photos.entries()) {
    const col = i % 2; if (col === 0 && y + ch > doc.page.height - 50) { doc.addPage(); y = 50; }
    const px = x + col * (cw + 12);
    try { doc.image(ph, px, y, { fit: [cw, ch], align: 'center', valign: 'center' }); doc.rect(px, y, cw, ch).lineWidth(0.5).strokeColor('#999').stroke(); }
    catch { doc.font('Helvetica').fontSize(9).fillColor(MUT).text('(foto tidak bisa ditampilkan)', px, y + ch / 2, { width: cw, align: 'center' }); }
    if (col === 1 || i === d.photos.length - 1) y += ch + 12;
  }
  doc.end();
  return done;
}
module.exports = { sjPdf, damagePdf, header, kvBlock, barcode, collect, safe, wib, COMPANY, INK, MUT, BLUE };
