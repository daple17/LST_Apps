// Pemetaan data sistem lama (MariaDB) -> LESAT. Semua fungsi murni (tanpa database). Dipakai skrip impor dan tes.
// Dokumen aturan dan asumsi: docs/spec-migrasi-lama.md
const { splitRefs } = require('./format');
const UNIT_MAP = require('./legacy-unit-map.json');

const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const PLACEHOLDERS = new Set(['', '-', '.', 'N/A', 'NA', '--', '0']);
const isPlaceholder = v => PLACEHOLDERS.has(squash(v).toUpperCase());
const cleanText = v => (isPlaceholder(v) ? null : squash(v));                      // '-' , '.', kosong -> null

/* ---------- master ---------- */
// Kode customer LESAT = customer.nickname lama (huruf besar). needsReview bila bukan 3 huruf.
function customerCode(nickname) {
  const code = squash(nickname).toUpperCase();
  return { code, needsReview: !/^[A-Z]{3}$/.test(code) };
}
// "0027" + kode; legacy_no = angka lama apa adanya
function joNumber(noJobOrder, code) {
  const n = noJobOrder == null || noJobOrder === '' ? NaN : Number(noJobOrder);
  if (!Number.isInteger(n) || n < 0) return { no_jo: null, legacy_no: null };
  return { no_jo: String(n).padStart(4, '0') + code, legacy_no: String(n) };
}
const JOB_TYPES = { 1: 'IMPORT', 2: 'EXPORT', 3: 'TRUCKING', 4: 'PROJECT' };
const jobType = n => JOB_TYPES[Number(n)] || null;
const BC_MAP = { 'PIB BC 2.0': 'BC 2.0', 'PIB BC 1.6': 'BC 1.6', 'PIB BC 2.8': 'BC 2.8', 'PIB BC 2.3': 'BC 2.3', 'PEB BC 3.0': 'BC 3.0' };
const typeBc = importType => BC_MAP[squash(importType).replace(/\s+/g, ' ')] || null;   // "Pilih", "Lainnya", kosong, NULL -> null
const jenisMuatan = v => { const s = squash(v).toUpperCase(); return s === 'FCL' ? 'FCL' : s === 'LCL' ? 'LCL_BB' : null; };
const statusJo = n => (Number(n) === 0 || n == null ? 'NOT_COMP' : 'COMPLETE');     // 0 -> NOT_COMP; 1 dan 2 -> COMPLETE (asumsi, nilai mentah disimpan di legacy_status)
// NoSiDo lama: Import -> SI_DO; Export -> SI_PO; Trucking -> SI_DO (project: SI_DO)
const siKind = type => (type === 'EXPORT' ? 'SI_PO' : 'SI_DO');

/* ---------- peti kemas pada JO ---------- */
const CONTAINER_COLS = [['fcl_20', '20FT'], ['fcl_40', '40FT'], ['fcl_45', '45FT'], ['fcl_ot', 'OT'], ['fcl_fr', 'FR']];
function containers(row) {
  const list = CONTAINER_COLS.map(([col, size]) => ({ size, qty: Number(row[col]) || 0 })).filter(c => c.qty > 0);
  if (!list.length) return { list, container_count: null, container_type: null };
  return { list, container_count: list.reduce((a, c) => a + c.qty, 0), container_type: list.length === 1 ? list[0].size : 'MIX' };
}

/* ---------- satuan, referensi, berat ---------- */
// satuan lama -> { unit, party_text }. Tidak dikenal: unit null, teks asli dikembalikan sebagai party_text (tidak ditebak).
function unitMap(text) {
  const raw = squash(text), key = raw.toUpperCase();
  if (UNIT_MAP.kosong.includes(key)) return { unit: null, party_text: null };
  const unit = UNIT_MAP.map[key] ?? UNIT_MAP.map[key.replace(/^-+/, '')] ?? null;
  return unit ? { unit, party_text: null } : { unit: null, party_text: raw };
}
// satuan material: 'Container' -> ukuran (20FT/40FT); lainnya lewat unitMap, bila tidak dikenal huruf besar asli (maks 20); kosong -> null
function materialUnit(satuan, size) {
  const raw = squash(satuan), key = raw.toUpperCase();
  if (key === 'CONTAINER' || key === 'KONTAINER') { const s = containerSize(size); return s === '20' ? '20FT' : s === '40' ? '40FT' : null; }
  if (key === '20') return '20FT';
  if (UNIT_MAP.kosong.includes(key)) return null;
  return unitMap(raw).unit || key.slice(0, 20);
}
// pemisah tambahan: " dan ", "&"; placeholder dibuang
const NOT_REF = new Set(['', '-', '.', 'N/A', 'NA', '--']);
function splitRefsLegacy(text) {
  const s = String(text ?? '').replace(/\s+dan\s+/gi, ',').replace(/\s*&\s*/g, ',');
  return splitRefs(s).filter(x => !NOT_REF.has(x.toUpperCase()));
}
// berat -> kg. Mengembalikan juga aturan yang dipakai (untuk dihitung di laporan).
function weightKg(value, unit) {
  const v = Number(value);
  if (value == null || value === '' || !Number.isFinite(v)) return { kg: null, rule: 'empty' };
  const u = squash(unit).toLowerCase(), r2 = x => Math.round(x * 100) / 100;
  if (u === 'kg') return { kg: r2(v), rule: 'kg' };
  if (u === 'ton' || u === 'tons') return v > 1000 ? { kg: r2(v), rule: 'ton_label_kg_value' } : { kg: r2(v * 1000), rule: 'ton' };   // 18909 "Tons" sebenarnya kg
  return v >= 100 ? { kg: r2(v), rule: 'blank_as_kg' } : { kg: r2(v * 1000), rule: 'blank_as_ton' };
}
const tonToKg = v => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1000 * 100) / 100);   // job_order.lcl_ton x 1000
const thicknessNum = v => { const s = squash(v).replace(',', '.'); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; };

/* ---------- kontainer / material ---------- */
function containerSize(raw) {
  const s = squash(raw).toUpperCase();
  if (!s || s === '1') return null;
  const m = /^(20|40|45) ?F$/.exec(s);
  return m ? m[1] : s === 'BB' ? 'BB' : s;
}
const isIsoContainer = no => /^[A-Z]{4}\d{7}$/.test(squash(no).toUpperCase());
// nomor material lama: trim + huruf besar; '-' / kosong / NULL -> TANPA-NOMOR-<id>
const productNo = (nomor, id) => { const s = squash(nomor).toUpperCase(); return s === '' || s === '-' ? `TANPA-NOMOR-${id}` : s; };
// pasangan (JO, nomor) ganda: yang kedua dan seterusnya diberi akhiran #2, #3 (urut menurut id). rows: [{id, jo_id, product_no}]
function dedupeProductNos(rows) {
  const seen = new Map(), out = [], changes = [];
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const base = r.product_no, k = `${r.jo_id}|${base.toUpperCase()}`, n = (seen.get(k) || 0) + 1; seen.set(k, n);
    if (n === 1) { out.push({ ...r }); continue; }
    const suffix = `#${n}`, renamed = base.slice(0, 60 - suffix.length) + suffix;
    out.push({ ...r, product_no: renamed }); changes.push({ id: r.id, jo_id: r.jo_id, from: base, to: renamed });
  }
  return { rows: out, changes };
}
const damageStatus = n => (Number(n) === 1 ? 'OK' : Number(n) === 2 ? 'DAMAGE' : 'NOT_CHECKED');   // kosong dan 0 -> NOT_CHECKED
const TEST_PATTERNS = ['material bagus', 'test', 'tes', 'coba'];                                  // dapat dikonfigurasi
function isTestRow(row, patterns = TEST_PATTERNS) {
  const re = new RegExp(`^(${patterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})( ?\\d+)?$`, 'i');
  return [row.descr_barang, row.nomor, row.description, row.product_no].some(v => v != null && re.test(squash(v)));
}

/* ---------- pengguna & kode vendor ---------- */
const validEmail = e => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(squash(e)) ? squash(e).toLowerCase() : null);
const username = uname => squash(uname).toLowerCase();
// kode vendor: kode lama dipakai bila bermakna dan belum dipakai; selain itu turunan dari nama (inisial + nomor urut) dan perlu ditinjau
function vendorCode(oldCode, name, taken) {
  const c = squash(oldCode).toUpperCase();
  if (c && !isPlaceholder(c) && /^[A-Z0-9 ]{2,10}$/.test(c) && !taken.has(c)) { taken.add(c); return { code: c, needsReview: false }; }
  const base = (squash(name).toUpperCase().replace(/^(PT|CV|UD)\.?\s+/, '').split(/[^A-Z0-9]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 5)) || 'VND';
  let n = 1, code; do { code = base + String(n).padStart(2, '0'); n++; } while (taken.has(code));
  taken.add(code); return { code, needsReview: true };
}

module.exports = { squash, isPlaceholder, cleanText, customerCode, joNumber, jobType, typeBc, jenisMuatan, statusJo, siKind, containers, unitMap, materialUnit, splitRefsLegacy, weightKg, tonToKg, thicknessNum,
  containerSize, isIsoContainer, productNo, dedupeProductNos, damageStatus, isTestRow, TEST_PATTERNS, validEmail, username, vendorCode, UNIT_MAP };
