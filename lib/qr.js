// QR code (pustaka qrcode) sebagai matriks: dipakai untuk SVG di layar dan digambar langsung di PDF.
const QRCode = require('qrcode');
const matrix = text => { const q = QRCode.create(String(text), { errorCorrectionLevel: 'M' }).modules; return { size: q.size, get: (r, c) => !!q.data[r * q.size + c] }; };
function svg(text, px = 4, quiet = 4) {
  const m = matrix(text), n = m.size + quiet * 2; let d = '';
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" role="img" aria-label="QR surat jalan digital" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function pdf(doc, text, x, y, size) {   // size = sisi total (pt) termasuk zona tenang
  const m = matrix(text), quiet = 4, u = size / (m.size + quiet * 2);
  doc.rect(x, y, size, size).fill('#fff'); doc.fillColor('#000');
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) doc.rect(x + (c + quiet) * u, y + (r + quiet) * u, u + 0.01, u + 0.01).fill();
}
module.exports = { matrix, svg, pdf };
