// COA: kelompok (Master General Ledger) dan akun. Hanya menambah. Data awal masuk SEKALI, hanya bila coa_accounts kosong.
const path = require('path');

async function seedCoa(m, file = path.join(__dirname, 'data', 'coa-seed.json')) {
  const { q, count, log } = m;
  if (await count('coa_accounts')) return false;                      // tidak menimpa data pengguna
  const seed = require(file);
  const rows = seed.headers.map(h => [h.jenis, h.sub_header, h.group_account || '', h.sort_order]);
  await q('INSERT IGNORE INTO coa_headers (jenis, sub_header, group_account, sort_order) VALUES ?', [rows]);
  const ids = new Map((await q('SELECT id, jenis, sub_header, group_account FROM coa_headers')).map(h => [`${h.jenis}|${h.sub_header}|${h.group_account}`, h.id]));
  const accounts = seed.accounts.map(a => {
    const id = ids.get(`${a.jenis}|${a.sub_header}|${a.group_account || ''}`);
    if (!id) throw new Error(`Kelompok akun ${a.code} tidak ditemukan`);
    return [a.code, a.name, id];
  });
  await q('INSERT INTO coa_accounts (code, name, header_id) VALUES ?', [accounts]);
  log(`COA: ${accounts.length} akun, ${rows.length} kelompok diimpor dari ${seed.source}`);
  for (const c of seed.conflicts || []) log(`COA: KODE GANDA ${c.code}: diimpor ${c.kept.name}; TIDAK diimpor ${c.dropped.map(d => d.name).join(', ')} (menunggu konfirmasi pemilik produk)`);
  return true;
}

exports.seedCoa = seedCoa;
exports.up = async m => {
  const { q, hasTable } = m;
  if (!(await hasTable('coa_headers'))) await q(`CREATE TABLE coa_headers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jenis ENUM('ASET','LIABILITAS','EKUITAS','REVENUE','BEBAN') NOT NULL,
    sub_header VARCHAR(80) NOT NULL,
    group_account VARCHAR(80) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT NULL, updated_by INT NULL,
    UNIQUE KEY uq_coa_header (jenis, sub_header, group_account))`);
  if (!(await hasTable('coa_accounts'))) await q(`CREATE TABLE coa_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code INT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    header_id INT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT NULL, updated_by INT NULL,
    UNIQUE KEY uq_coa_code (code), INDEX idx_coa_header (header_id, is_active), INDEX idx_coa_name (name),
    FOREIGN KEY (header_id) REFERENCES coa_headers(id))`);
  await seedCoa(m);
};
