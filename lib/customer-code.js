// Kode customer otomatis (3 huruf kapital, dipakai di nomor JO: 0027USC). Murni, tanpa database.
const STOP = new Set(['PT', 'CV', 'UD', 'PD', 'FA', 'TBK', 'PERSERO', 'CO', 'LTD', 'INC', 'CORP', 'THE', 'AND', 'DAN']);
const CODE_RE = /^[A-Z]{3}$/;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// kata bermakna dari nama (tanpa badan usaha), hanya huruf
function words(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter(w => w && !STOP.has(w)).map(w => w.replace(/[^A-Z]/g, '')).filter(Boolean);
}
const pad3 = s => (s + 'XXX').slice(0, 3);

// calon kode berurutan dari yang paling "alami": inisial 3 kata pertama, lalu kombinasi lain
function candidates(name) {
  const ws = words(name), out = [];
  if (!ws.length) return ['CST'];
  if (ws.length >= 3) out.push(ws[0][0] + ws[1][0] + ws[2][0]);
  if (ws.length >= 2) { out.push(pad3(ws[0][0] + ws[1][0] + (ws[0][1] || ws[1][1] || ''))); out.push(pad3(ws[0].slice(0, 2) + ws[1][0])); }
  out.push(pad3(ws[0]));
  if (ws.length >= 3) out.push(pad3(ws[0][0] + ws[1].slice(0, 2)));
  return [...new Set(out)];
}

// kode pertama yang belum dipakai (taken: Set kode huruf besar, termasuk kode lama non-3-huruf)
function suggestCode(name, taken = new Set()) {
  const used = c => taken.has(c);
  const cands = candidates(name);
  for (const c of cands) if (!used(c)) return c;
  // bentrok: pertahankan dua huruf pertama calon utama, variasikan huruf ketiga (huruf dari nama dulu, lalu A-Z)
  const own = [...new Set(words(name).join('').split(''))].join('');
  for (const base of cands) for (const ch of own + ALPHA) { const c = base.slice(0, 2) + ch; if (!used(c)) return c; }
  for (const base of cands) for (const a of ALPHA) for (const b of ALPHA) { const c = base[0] + a + b; if (!used(c)) return c; }
  for (const a of ALPHA) for (const b of ALPHA) for (const c3 of ALPHA) { const c = a + b + c3; if (!used(c)) return c; }
  throw new Error('Semua kode customer 3 huruf sudah terpakai');
}
module.exports = { CODE_RE, words, candidates, suggestCode };
