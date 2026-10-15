// Validasi isian wajib Job Order per tipe (tabel "Isian" di spesifikasi; aturan di rules.FIELD_RULES).
// Dipakai server (menolak simpan) dan dikirim aturannya ke form (menandai isian wajib).
const rules = require('./rules');
const LABEL = {
  customer: 'Customer', jenis_muatan: 'Jenis muatan', type_bc: 'Type BC', vessel: 'Vessel', eta_etd: 'ETA/ETD', delivery_plan: 'Delivery plan',
  containers: 'Jumlah dan jenis kontainer', weight: 'Weight', qty: 'Quantity dan satuan',
  AJU: 'Nomor aju', INVOICE: 'No. invoice', BL: 'No. BL', SI_DO: 'No. SI/DO', SI_PO: 'No. SI/PO', NOPEN: 'Nopen',
};
const has = v => v !== undefined && v !== null && String(v).trim() !== '';
const isReq = (field, type) => rules.FIELD_RULES[field]?.[type] === 'R';

// -> [{ field, message }]. opts.only (Set nama kolom): hanya galat untuk kolom itu (data lama: yang berubah saja)
function validateJo(b, opts = {}) {
  const t = b.type, errs = [];
  const refs = kind => (b.references || []).filter(r => r.kind === kind && has(r.number));
  const need = (field, ok) => { if (isReq(field, t) && !ok) errs.push({ field, message: `${LABEL[field]} wajib diisi` }); };
  need('customer', has(b.customer_id));
  need('jenis_muatan', has(b.jenis_muatan));
  need('type_bc', has(b.type_bc));
  need('vessel', has(b.vessel));
  need('eta_etd', has(b.eta_etd));
  need('delivery_plan', has(b.delivery_plan));
  need('containers', Number(b.container_count) > 0 && has(b.container_type));
  need('weight', has(b.weight) || has(b.weight_kg));
  need('qty', (has(b.qty) && has(b.unit)) || has(b.party));
  for (const k of rules.REF_KINDS.map(x => x.code)) need(k, refs(k).length > 0);
  return opts.only ? errs.filter(e => opts.only.has(e.field)) : errs;
}

// Kolom yang BERUBAH antara isian baru (kolom JO yang sudah dinormalisasi + referensi) dan baris tersimpan. Dipakai untuk JO data lama:
// kolom wajib yang tidak disentuh tidak divalidasi (keputusan 2 migrasi), kolom yang diubah divalidasi penuh.
const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const day = v => (v ? String(v).slice(0, 10) : '');
const kgDiffers = (a, b) => (a == null || b == null ? !(a == null && b == null) : Math.abs(Number(a) - Number(b)) > 5);   // 5 kg: pembulatan ton 2 desimal di form
function changedFields(f, cur, nextRefs, curRefs) {
  const ch = new Set();
  if (!same(f.jenis_muatan, cur.jenis_muatan)) ch.add('jenis_muatan');
  if (!same(f.type_bc, cur.type_bc)) ch.add('type_bc');
  if (!same(f.vessel, cur.vessel)) ch.add('vessel');
  if (day(f.eta_etd) !== day(cur.eta_etd)) ch.add('eta_etd');
  if (day(f.delivery_plan) !== day(cur.delivery_plan)) ch.add('delivery_plan');
  if (!same(f.container_count, cur.container_count) || !same(f.container_type, cur.container_type)) ch.add('containers');
  if (kgDiffers(f.weight_kg, cur.weight_kg)) ch.add('weight');
  if (!same(f.qty, cur.qty) || !same(f.unit, cur.unit) || !same(f.party_text, cur.party_text)) ch.add('qty');
  if (nextRefs) for (const k of rules.REF_KINDS.map(x => x.code)) {
    const a = nextRefs.filter(r => r.kind === k).map(r => String(r.number).trim()).filter(Boolean).sort().join('|'), b = curRefs.filter(r => r.kind === k).map(r => String(r.number).trim()).sort().join('|');
    if (a !== b) ch.add(k);
  }
  return ch;
}
module.exports = { validateJo, changedFields, LABEL, isReq };
