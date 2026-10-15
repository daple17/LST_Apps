// Validasi & normalisasi baris material (form Add data dan Upload List memakai aturan yang sama).
const rules = require('./rules');

// kolom Add data = kolom template (urutan persis). req: wajib (*)
const COLUMNS = [
  { key: 'product_no', header: 'Product/Container No', req: true, width: 22 },
  { key: 'kondisi', header: 'Intact/Partial', req: false, width: 14, note: 'Intact atau Partial (kosong = Intact)' },
  { key: 'spec', header: 'Spec', req: false, width: 14 },
  { key: 'description', header: 'Description', req: true, width: 26 },
  { key: 'thickness', header: 'Thickness', req: false, width: 11, note: 'Tebal, mis. 0.7' },
  { key: 'width', header: 'Width', req: false, width: 11, note: 'Lebar, mis. 1245' },
  { key: 'shape', header: 'Shape', req: false, width: 9, note: 'Bentuk, mis. C (coil)' },
  { key: 'net_weight', header: 'Net Weight', req: true, width: 14, note: 'kg' },
  { key: 'gross_weight', header: 'Gross Weight', req: true, width: 14, note: 'kg' },
  { key: 'qty', header: 'Quantity', req: true, width: 10, note: 'bilangan bulat ≥ 1' },
  { key: 'unit', header: 'Unit', req: true, width: 10, note: 'mis. COIL, BUNDLE, PCS' },
  { key: 'origin', header: 'From', req: true, width: 18, note: 'lokasi pick up material' },
  { key: 'destination', header: 'Destination', req: true, width: 22, note: 'lokasi unloading' },
];
const norm = h => String(h ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const HEADER_INDEX = Object.fromEntries(COLUMNS.map(c => [norm(c.header), c.key]));

// "8.120", "8,5", "1.245,5", 8120 -> angka; tidak valid -> NaN
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
const text = (v, max) => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s.slice(0, max); };

function normalize(raw) {
  const k = String(raw.kondisi ?? '').trim().toUpperCase();
  return {
    product_no: text(raw.product_no, 60), kondisi: k === '' ? 'INTACT' : k, spec: text(raw.spec, 60), description: text(raw.description, 150),
    thickness: parseNum(raw.thickness), width: parseNum(raw.width), shape: text(raw.shape, 10),
    net_weight: parseNum(raw.net_weight), gross_weight: parseNum(raw.gross_weight), qty: parseNum(raw.qty),
    unit: text(raw.unit, 20)?.toUpperCase() ?? null, origin: text(raw.origin, 80), destination: text(raw.destination, 120),
  };
}

// -> { errors: [..], warnings: [..] }. opts.only (Set kunci kolom): hanya galat untuk kolom itu (material data lama: yang berubah saja)
function validate(m, opts = {}) {
  const errs = [], warnings = [];
  const add = (key, message) => errs.push({ key, message });
  const need = (key, label) => { if (m[key] == null || m[key] === '') add(key, `${label} wajib diisi`); };
  need('product_no', 'Product/Container No'); need('description', 'Description'); need('unit', 'Unit'); need('origin', 'From'); need('destination', 'Destination');
  for (const [key, label] of [['net_weight', 'Net Weight'], ['gross_weight', 'Gross Weight'], ['qty', 'Quantity']]) {
    if (m[key] == null) add(key, `${label} wajib diisi`); else if (Number.isNaN(m[key]) || m[key] < 0) add(key, `${label} harus angka ≥ 0`);
  }
  for (const [key, label] of [['thickness', 'Thickness'], ['width', 'Width']]) if (Number.isNaN(m[key]) || (m[key] != null && m[key] < 0)) add(key, `${label} harus angka ≥ 0`);
  if (m.qty != null && !Number.isNaN(m.qty) && (!Number.isInteger(m.qty) || m.qty < 1)) add('qty', 'Quantity harus bilangan bulat ≥ 1');
  if (!['INTACT', 'PARTIAL'].includes(m.kondisi)) add('kondisi', 'Intact/Partial harus Intact atau Partial');
  const errors = (opts.only ? errs.filter(e => opts.only.has(e.key)) : errs).map(e => e.message);
  if (m.net_weight > m.gross_weight && !errs.length) warnings.push('Net Weight lebih besar dari Gross Weight');
  return { errors, warnings };
}
// kunci kolom yang berubah antara isian baru (hasil normalize) dan baris tersimpan
function changedKeys(m, cur) {
  const ch = new Set();
  for (const k of ['product_no', 'description', 'spec', 'shape', 'kondisi', 'unit', 'origin', 'destination']) if (String(m[k] ?? '').trim() !== String(cur[k] ?? '').trim()) ch.add(k);
  for (const k of ['thickness', 'width', 'net_weight', 'gross_weight', 'qty']) { const a = m[k] == null ? null : Number(m[k]), b = cur[k] == null ? null : Number(cur[k]); if (a !== b && !(Number.isNaN(a) && Number.isNaN(b)) && !(a != null && b != null && Math.abs(a - b) < 0.005)) ch.add(k); }
  return ch;
}

// tandai nomor produk ganda: dalam file yang sama dan terhadap material yang sudah ada di JO
function markDuplicates(items, existing = new Set()) {
  const seen = new Map();
  for (const it of items) {
    const key = (it.data.product_no || '').toLowerCase();
    if (!key) continue;
    if (existing.has(key)) it.errors.push('Nomor produk sudah ada di JO ini');
    else if (seen.has(key)) it.errors.push(`Nomor produk ganda dalam file (baris ${seen.get(key)})`);
    else seen.set(key, it.n);
  }
  return items;
}
module.exports = { COLUMNS, HEADER_INDEX, norm, parseNum, normalize, validate, changedKeys, markDuplicates };
