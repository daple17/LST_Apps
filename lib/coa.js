// COA (Chart of Accounts): aturan murni tanpa database. Dipakai skrip seed, migrasi, API, dan tes.
// Hirarki: Jenis > Sub Header > Group Account. Aset, Liabilitas, Ekuitas berhenti di Sub Header (tanpa Group Account).
const JENIS = [
  { code: 'ASET', label: 'Aset', hasGroup: false },
  { code: 'LIABILITAS', label: 'Liabilitas', hasGroup: false },
  { code: 'EKUITAS', label: 'Ekuitas', hasGroup: false },
  { code: 'REVENUE', label: 'Revenue', hasGroup: true },
  { code: 'BEBAN', label: 'Beban', hasGroup: true },
];
const JENIS_CODES = JENIS.map(j => j.code);
const hasGroup = code => !!JENIS.find(j => j.code === code)?.hasGroup;
const jenisLabel = code => JENIS.find(j => j.code === code)?.label || code;

const CODE_RE = /^[1-9]\d{4}$/;
const NAME_MIN = 2, NAME_MAX = 150, HEADER_MAX = 80;

// Jenis di berkas sumber -> kode baku ("Activa/Asset" -> ASET; "Beban" dan "Expense" -> BEBAN)
function normJenis(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/activa|asset|^aset/.test(s)) return 'ASET';
  if (/liabilit|kewajiban/.test(s)) return 'LIABILITAS';
  if (/ekuitas|equity/.test(s)) return 'EKUITAS';
  if (/revenue|pendapatan/.test(s)) return 'REVENUE';
  if (/beban|expense|biaya/.test(s)) return 'BEBAN';
  return null;
}

// Penulisan baku Sub Header / Group Account (tabel tunggal): kunci = huruf kecil + spasi rapi
const TEXT_FIX = {
  'biaya non ops': 'Biaya Non Ops',
  'pendapatan non ops': 'Pendapatan Non Ops',
  'modal ditahan': 'Modal Ditahan',
  'pendapatan opersional': 'Pendapatan Operasional',
  'biaya adminstrasi dan umum': 'Biaya Administrasi dan Umum',
  'pendapatan lain-lain': 'Pendapatan Lain-lain',
};
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
function normHeaderText(raw) { const t = squash(raw); return TEXT_FIX[t.toLowerCase()] || t; }
// Nama akun: hanya merapikan spasi; huruf besar/kecil dibiarkan
const cleanName = raw => squash(raw);

// Taksonomi awal Master General Ledger = sheet "Update > Update Master Code" (sudah dalam penulisan baku). Urutan = urutan sheet.
const TAXONOMY = [
  ['ASET', 'Aktiva Lancar'], ['ASET', 'Aktiva Tetap'], ['ASET', 'Aktiva Tidak Lancar'],
  ['LIABILITAS', 'Kewajiban Lancar'], ['LIABILITAS', 'Kewajiban Jangka Panjang'],
  ['EKUITAS', 'Modal Disetor'], ['EKUITAS', 'Modal Ditahan'],
  ['REVENUE', 'Pendapatan Operasional', 'Pendapatan Forwarding'], ['REVENUE', 'Pendapatan Operasional', 'Pendapatan Trucking'],
  ['REVENUE', 'Pendapatan Non Ops', 'Pendapatan Reimbursement'], ['REVENUE', 'Pendapatan Non Ops', 'Pendapatan Lain-lain'],
  ['BEBAN', 'Biaya Operasional', 'Biaya Forwarding'], ['BEBAN', 'Biaya Operasional', 'Biaya Trucking'], ['BEBAN', 'Biaya Operasional', 'Biaya Pembelian Spare Part'],
  ['BEBAN', 'Biaya Operasional', 'Biaya Maintenance'], ['BEBAN', 'Biaya Operasional', 'Biaya Penyusutan'],
  ['BEBAN', 'Biaya Non Ops', 'Biaya Reimbursement'], ['BEBAN', 'Biaya Non Ops', 'Biaya Bunga'], ['BEBAN', 'Biaya Non Ops', 'Biaya Bank'], ['BEBAN', 'Biaya Non Ops', 'Biaya Lain'],
  ['BEBAN', 'Beban Operasi', 'Biaya Gaji dan Tunjangan'], ['BEBAN', 'Beban Operasi', 'Biaya Sewa Kantor'], ['BEBAN', 'Beban Operasi', 'Biaya Sewa Garasi'], ['BEBAN', 'Beban Operasi', 'Biaya ATK'],
  ['BEBAN', 'Beban Operasi', 'Biaya Marketing'], ['BEBAN', 'Beban Operasi', 'Biaya Utilitas Kantor'], ['BEBAN', 'Beban Operasi', 'Biaya Legalitas'], ['BEBAN', 'Beban Operasi', 'Biaya Administrasi dan Umum'],
].map(([jenis, sub_header, group_account = '']) => ({ jenis, sub_header, group_account }));

// Kode ganda di berkas sumber (keputusan sementara pemilik produk, menunggu konfirmasi): kode -> nama akun yang diimpor
const DUP_RESOLUTION = { 45155: 'CRANE', 45165: 'ADM LIFT ON' };

const headerKey = h => `${h.jenis}|${h.sub_header}|${h.group_account || ''}`;
const headerLabel = h => (h.group_account ? `${h.sub_header} › ${h.group_account}` : h.sub_header);

// Baris mentah [{row, code, name, jenis, sub_header, group}] -> { headers, accounts, conflicts, warnings }. Galat data = throw (tidak membuang diam-diam).
function buildSeed(raw, { resolution = DUP_RESOLUTION, taxonomy = TAXONOMY } = {}) {
  const warnings = [], conflicts = [], items = [];
  for (const r of raw) {
    if ([r.code, r.name, r.jenis, r.sub_header, r.group].every(v => v == null || String(v).trim() === '')) continue; // baris kosong
    const code = String(r.code ?? '').trim();
    if (!CODE_RE.test(code)) throw new Error(`Baris ${r.row}: kode "${code}" bukan 5 angka`);
    const name = cleanName(r.name);
    if (name.length < NAME_MIN || name.length > NAME_MAX) throw new Error(`Baris ${r.row}: nama akun ${code} tidak valid`);
    const jenis = normJenis(r.jenis);
    if (!jenis) throw new Error(`Baris ${r.row}: jenis "${r.jenis}" tidak dikenal`);
    const sub_header = normHeaderText(r.sub_header), group_account = normHeaderText(r.group);
    if (!sub_header) throw new Error(`Baris ${r.row}: Sub Header kosong (akun ${code})`);
    if (hasGroup(jenis) && !group_account) throw new Error(`Baris ${r.row}: ${jenisLabel(jenis)} wajib punya Group Account (akun ${code})`);
    if (!hasGroup(jenis) && group_account) { warnings.push(`Baris ${r.row}: Group Account "${group_account}" diabaikan untuk ${jenisLabel(jenis)} (akun ${code})`); }
    items.push({ row: r.row, code: +code, name, jenis, sub_header, group_account: hasGroup(jenis) ? group_account : '' });
  }
  // kode ganda: harus ada keputusan eksplisit, hasilnya dilaporkan
  const byCode = new Map();
  for (const it of items) (byCode.get(it.code) || byCode.set(it.code, []).get(it.code)).push(it);
  const accounts = [];
  for (const [code, list] of byCode) {
    if (list.length === 1) { accounts.push(list[0]); continue; }
    const keepName = resolution[code];
    const kept = list.find(x => x.name === keepName);
    if (!kept) throw new Error(`Kode ganda ${code} (${list.map(x => x.name).join(' / ')}) tanpa keputusan`);
    accounts.push(kept);
    conflicts.push({ code, kept: { row: kept.row, name: kept.name }, dropped: list.filter(x => x !== kept).map(x => ({ row: x.row, name: x.name })),
      reason: 'Kode dipakai dua akun; unik harus dijaga. Keputusan sementara, menunggu konfirmasi pemilik produk.' });
  }
  accounts.sort((a, b) => a.code - b.code);
  // kelompok = taksonomi + kombinasi yang muncul di data (urutan: taksonomi dulu, lalu urutan kemunculan di data)
  const seen = new Map();
  for (const t of taxonomy) seen.set(headerKey(t), { ...t });
  for (const a of accounts) { const k = headerKey(a); if (!seen.has(k)) seen.set(k, { jenis: a.jenis, sub_header: a.sub_header, group_account: a.group_account }); }
  const order = Object.fromEntries(JENIS_CODES.map((c, i) => [c, i]));
  const headers = [...seen.values()].map((h, i) => ({ ...h, _i: i })).sort((a, b) => order[a.jenis] - order[b.jenis] || a._i - b._i);
  const perJenis = {}; for (const h of headers) { h.sort_order = (perJenis[h.jenis] = (perJenis[h.jenis] || 0) + 1) * 10; delete h._i; }
  return { headers, accounts: accounts.map(({ row, ...a }) => a), conflicts, warnings };
}

module.exports = { JENIS, JENIS_CODES, hasGroup, jenisLabel, CODE_RE, NAME_MIN, NAME_MAX, HEADER_MAX, normJenis, normHeaderText, cleanName, TAXONOMY, DUP_RESOLUTION, headerKey, headerLabel, buildSeed };
