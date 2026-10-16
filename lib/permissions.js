// Daftar izin (RBAC): satu sumber kebenaran. Kode izin = "modul.aksi", mis. "jo.update".
// available=false: layar modulnya belum ada ("segera"), tetapi izinnya sudah bisa diatur dan tersimpan.
const ACTION_LABEL = { view: 'Lihat', create: 'Tambah', update: 'Ubah', delete: 'Hapus', export: 'Ekspor', approve: 'Approval' };
const CRUD = ['view', 'create', 'update', 'delete'];
const OPS = ['view', 'create', 'update', 'delete', 'export'];
const GROUPS = ['HOME', 'OPERASIONAL', 'APPROVAL', 'HR (SDM)', 'DATA MASTER', 'ADMINISTRATOR'];

const MODULES = [
  { key: 'home', label: 'Dashboard', group: 'HOME', actions: ['view'], available: true },
  { key: 'jo', label: 'Job Order & Doc', group: 'OPERASIONAL', actions: OPS, available: true },
  { key: 'ho', label: 'Handling Ops', group: 'OPERASIONAL', actions: OPS, available: true },
  { key: 'trucking', label: 'Trucking', group: 'OPERASIONAL', actions: OPS, available: false },
  { key: 'submission', label: 'Submission', group: 'OPERASIONAL', actions: ['view', 'create', 'update'], available: false },
  { key: 'settlement', label: 'Settlement', group: 'OPERASIONAL', actions: ['view', 'create', 'update'], available: false },
  { key: 'job_complete', label: 'Job Complete', group: 'OPERASIONAL', actions: ['view', 'update'], available: false },
  { key: 'approval', label: 'Approval pengajuan', group: 'APPROVAL', actions: ['view', 'approve'], available: false },
  { key: 'checkin', label: 'Check In & Daily Report', group: 'HR (SDM)', actions: ['view', 'create', 'update'], available: true },      // data milik sendiri
  { key: 'checkin_rekap', label: 'Rekap Absensi', group: 'HR (SDM)', actions: ['view', 'update', 'export'], available: true },    // semua pegawai (HR)
  { key: 'coa', label: 'COA', group: 'DATA MASTER', actions: ['view', 'create', 'update', 'delete', 'export'], available: true }, // delete = hapus KELOMPOK kosong; akun tidak pernah dihapus (hanya dinonaktifkan)
  { key: 'customer', label: 'Customer', group: 'DATA MASTER', actions: OPS, available: true },
  { key: 'vendor', label: 'Vendor', group: 'DATA MASTER', actions: CRUD, available: true },
  { key: 'shipper', label: 'Shipper', group: 'DATA MASTER', actions: CRUD, available: true },
  { key: 'unit', label: 'Unit', group: 'DATA MASTER', actions: CRUD, available: false },
  { key: 'user', label: 'User Management', group: 'ADMINISTRATOR', actions: CRUD, available: true },
  { key: 'role', label: 'Role Management', group: 'ADMINISTRATOR', actions: CRUD, available: true },
];

const codeOf = (mod, action) => `${mod}.${action}`;
const ALL_PERMISSIONS = MODULES.flatMap(m => m.actions.map(a => codeOf(m.key, a)));
const VALID = new Set(ALL_PERMISSIONS);
const isValid = code => VALID.has(code);
const moduleOf = key => MODULES.find(m => m.key === key);

// Level cepat di layar Role Management: Tanpa < Lihat < Kelola < Penuh. Kelola = lihat, tambah, ubah, ekspor (yang berlaku untuk modul itu).
const LEVELS = ['none', 'view', 'manage', 'full'];
const LEVEL_ACTIONS = {
  none: () => [],
  view: m => m.actions.filter(a => a === 'view'),
  manage: m => m.actions.filter(a => ['view', 'create', 'update', 'export'].includes(a)),
  full: m => [...m.actions],
};
const levelPerms = (mod, level) => LEVEL_ACTIONS[level](moduleOf(mod)).map(a => codeOf(mod, a));

// Dari kumpulan izin sebuah role -> level yang cocok, atau 'custom' bila tidak cocok dengan satu pun.
function levelOf(mod, perms) {
  const m = moduleOf(mod), have = new Set(m.actions.filter(a => perms.has ? perms.has(codeOf(mod, a)) : perms.includes(codeOf(mod, a))));
  for (const l of LEVELS) { const want = LEVEL_ACTIONS[l](m); if (want.length === have.size && want.every(a => have.has(a))) return l; }
  return 'custom';
}

// Dikirim ke frontend lewat /api/lookups
const client = { MODULES, GROUPS, ACTION_LABEL, LEVELS };
module.exports = { MODULES, GROUPS, ACTION_LABEL, ALL_PERMISSIONS, isValid, moduleOf, codeOf, LEVELS, levelPerms, levelOf, client };
