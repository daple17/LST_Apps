// Aturan bisnis & konstanta (satu sumber kebenaran, dikirim ke frontend lewat /api/lookups).
// Ubah di sini jika keputusan pemilik berubah — jangan tersebar di kode.
const JO_TYPES = [
  { code: 'IMPORT', label: 'Import' }, { code: 'EXPORT', label: 'Export' },
  { code: 'TRUCKING', label: 'Trucking' }, { code: 'PROJECT', label: 'Project' },
];
// Keputusan 1: jenis BC terpisah dari tipe JO
const TYPE_BC = ['BC 2.0', 'BC 2.3', 'BC 2.5', 'BC 2.7', 'BC 2.8', 'BC 1.6', 'BC 4.0'];
const JENIS_MUATAN = [{ code: 'FCL', label: 'FCL' }, { code: 'LCL_BB', label: 'LCL/BB' }];
// Keputusan 6: party = jumlah + satuan
const UNITS = [
  { code: 'COIL', label: 'CL', name: 'COIL' }, { code: 'BUNDLE', label: 'BDL', name: 'BUNDLE' }, { code: 'PCS', label: 'PCS', name: 'PCS' },
  { code: '20FT', label: '20ft', name: '20FT', container: true }, { code: '40FT', label: '40ft', name: '40FT', container: true },
];
const REF_KINDS = [
  { code: 'AJU', label: 'Aju Ceisa' }, { code: 'INVOICE', label: 'No. Invoice' }, { code: 'BL', label: 'No. BL' },
  { code: 'SI_DO', label: 'No. SI/DO' }, { code: 'SI_PO', label: 'No. SI/PO' },
  { code: 'NOPEN', label: 'Nopen' }, // keputusan sendiri: nomor pendaftaran + tanggal untuk PDF Surat Jalan
];
const DOC_TYPES = [
  { code: 'INVOICE', label: 'Invoice' }, { code: 'BL', label: 'Bill of Lading' }, { code: 'SI_DO', label: 'SI/DO' }, { code: 'SI_PO', label: 'SI/PO' },
  { code: 'PIB_PEB', label: 'PIB/PEB' }, { code: 'FAKTUR_PAJAK', label: 'Faktur Pajak' }, { code: 'SURAT_JALAN', label: 'Surat Jalan' }, { code: 'OTHERS', label: 'Others' },
];
// Keputusan checklist: 9 item (jawaban pemilik). `legacy` = kunci checklist lama yang digabung (OR).
const CHECKLIST_ITEMS = [
  { code: 'agency_do', label: 'Agency/Adm DO', legacy: ['agency', 'do'] },
  { code: 'thc', label: 'THC', legacy: ['thc'] },
  { code: 'demurrage', label: 'Demurrage/Detention', legacy: ['demurrage'] },
  { code: 'storage', label: 'Storage', legacy: ['storage'] },
  { code: 'lolo', label: 'Lift On Lift Off', legacy: ['lolo_on', 'lolo_off'] },
  { code: 'repair', label: 'Repair', legacy: ['repair'] },
  { code: 'pibpeb_nopen', label: 'PIB/PEB Nopen', legacy: ['pibpeb', 'nopen'] },
  { code: 'sj', label: 'Surat Jalan', legacy: ['sj'] },
  { code: 'others', label: 'Others', legacy: ['others'] },
];
// Keputusan 1 (migrasi tipe lama)
const LEGACY_TYPE = { 'PIB BC 2.0': ['IMPORT', 'BC 2.0'], 'PIB BC 1.6': ['IMPORT', 'BC 1.6'], 'PIB BC 2.8': ['IMPORT', 'BC 2.8'], LOKAL: ['TRUCKING', null], PEB: ['EXPORT', null], TRUCKING: ['TRUCKING', null] };
// Wajib per tipe: R = wajib, O = opsional, X = tidak ada (dipakai form di tahap 4)
const FIELD_RULES = {
  jenis_muatan: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'R', PROJECT: 'R' },
  customer: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'R', PROJECT: 'R' },
  type_bc: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  AJU: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  INVOICE: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  BL: { IMPORT: 'O', EXPORT: 'O', TRUCKING: 'O', PROJECT: 'O' },
  SI_DO: { IMPORT: 'O', EXPORT: 'X', TRUCKING: 'O', PROJECT: 'O' },
  SI_PO: { IMPORT: 'X', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  NOPEN: { IMPORT: 'O', EXPORT: 'O', TRUCKING: 'O', PROJECT: 'O' },
  vessel: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  eta_etd: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  delivery_plan: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'R', PROJECT: 'R' },
  containers: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  weight: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
  qty: { IMPORT: 'R', EXPORT: 'R', TRUCKING: 'O', PROJECT: 'O' },
};
const NUMBERING = { // Keputusan 2-4
  jo: { width: 4 },                // 0001 + kode customer 3 huruf, urutan global tidak reset
  ticket: { width: 2 },            // YYYYMMDD + urutan per BULAN + inisial PIC
  sj: { width: 4 },                // YYYYMM + urutan per bulan
};
const LIMITS = { FILE_MAX_MB: 10, MATERIAL_PHOTOS: 8, SJ_PHOTOS: 3, PHOTO_MAX_PX: 1600, PAGE_SIZE: 20, WEIGHT_MISMATCH_PCT: 0.5 };
const FILE_TYPES = { 'application/pdf': ['.pdf'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] };
const PROGRESS_RULE = 'min'; // Keputusan: tab progres tiket = nilai terendah dari dua persen
const PROGRESS_TABS = [
  { code: '', label: 'All' }, { code: 'done', label: '100%' }, { code: 'mid', label: '50% - 99%' }, { code: 'low', label: '< 50%' },
];

// bagian yang aman dikirim ke browser
const client = { JO_TYPES, TYPE_BC, JENIS_MUATAN, UNITS, REF_KINDS, DOC_TYPES, CHECKLIST_ITEMS: CHECKLIST_ITEMS.map(({ code, label }) => ({ code, label })), FIELD_RULES, LIMITS, FILE_TYPES, PROGRESS_TABS };
module.exports = { JO_TYPES, TYPE_BC, JENIS_MUATAN, UNITS, REF_KINDS, DOC_TYPES, CHECKLIST_ITEMS, LEGACY_TYPE, FIELD_RULES, NUMBERING, LIMITS, FILE_TYPES, PROGRESS_RULE, PROGRESS_TABS, client };
