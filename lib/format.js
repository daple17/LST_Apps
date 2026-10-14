const { UNITS } = require('./rules');
const unitBy = c => UNITS.find(u => u.code === c);

// 300 CL | 12x40ft | teks lama apa adanya
function partyLabel(qty, unit, text) {
  if (qty == null || qty === '' || !unit) return text || '';
  const u = unitBy(unit), n = Number(qty);
  return u && u.container ? `${n}x${u.label}` : `${n} ${u ? u.label : unit}`;
}

// "300 CL" / "12x40ft" / "18 bundle" -> {qty, unit, text}; yang tidak dikenali disimpan di text
function parseParty(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { qty: null, unit: null, text: null };
  let m = /^(\d+)\s*x\s*(20|40)\s*ft$/i.exec(s);
  if (m) return { qty: +m[1], unit: `${m[2]}FT`, text: null };
  m = /^(\d+)\s*(cl|coils?)$/i.exec(s); if (m) return { qty: +m[1], unit: 'COIL', text: null };
  m = /^(\d+)\s*(bdl|bundles?)$/i.exec(s); if (m) return { qty: +m[1], unit: 'BUNDLE', text: null };
  m = /^(\d+)\s*(pcs?|pieces?)$/i.exec(s); if (m) return { qty: +m[1], unit: 'PCS', text: null };
  return { qty: null, unit: null, text: s };
}

// pisah daftar nomor ("000386, 000385" / baris baru / ;) menjadi array unik
const splitRefs = v => [...new Set(String(v ?? '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];

const fmtNum = (n, dec = 2) => (n == null || n === '' || Number.isNaN(Number(n)) ? '' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec }));

module.exports = { partyLabel, parseParty, splitRefs, fmtNum };
