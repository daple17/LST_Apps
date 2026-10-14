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

// -> [{ field, message }]
function validateJo(b) {
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
  return errs;
}
module.exports = { validateJo, LABEL, isReq };
