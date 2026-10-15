// Kompatibilitas data sistem lama: tabel referensi baru dan kolom tambahan (semua boleh kosong). Hanya menambah; perilaku data baru tidak berubah.
// Penjelasan: docs/spec-migrasi-lama.md
exports.up = async m => {
  const { q, hasTable, hasIndex, fkOf, addCol, columnType } = m;
  const uniq = async (t, name, col) => { if (!(await hasIndex(t, name))) await q(`ALTER TABLE \`${t}\` ADD UNIQUE INDEX \`${name}\` (\`${col}\`)`); };
  const fk = async (t, col, ref, name) => { if (!(await fkOf(t, col)).length) await q(`ALTER TABLE \`${t}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${col}\`) REFERENCES \`${ref}\`(id)`); };

  /* ---- tabel referensi baru ---- */
  if (!(await hasTable('countries'))) await q(`CREATE TABLE countries (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, code INT NULL, legacy_id BIGINT NULL, UNIQUE KEY uq_countries_legacy (legacy_id))`);
  if (!(await hasTable('ports'))) await q(`CREATE TABLE ports (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, code VARCHAR(10) NULL, city VARCHAR(100) NULL, country_id INT NULL,
    is_foreign TINYINT(1) NOT NULL DEFAULT 0, legacy_id BIGINT NULL, UNIQUE KEY uq_ports_legacy (legacy_id), FOREIGN KEY (country_id) REFERENCES countries(id))`);
  if (!(await hasTable('tps_warehouses'))) await q(`CREATE TABLE tps_warehouses (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(10) NULL, name VARCHAR(100) NULL, location VARCHAR(100) NULL, legacy_id BIGINT NULL, UNIQUE KEY uq_tps_legacy (legacy_id))`);
  if (!(await hasTable('legacy_quarantine'))) await q(`CREATE TABLE legacy_quarantine (id INT AUTO_INCREMENT PRIMARY KEY, source_table VARCHAR(40) NOT NULL, legacy_id BIGINT NULL, reason VARCHAR(255) NOT NULL, payload JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at DATETIME NULL, resolved_note VARCHAR(255) NULL, INDEX idx_lq_source (source_table, legacy_id))`);
  if (!(await hasTable('import_runs'))) await q(`CREATE TABLE import_runs (id INT AUTO_INCREMENT PRIMARY KEY, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME NULL, mode VARCHAR(20) NOT NULL, summary JSON NULL)`);

  /* ---- job_orders ---- */
  for (const [c, d] of [['jo_date', 'DATE NULL'], ['completed_at', 'DATE NULL'], ['etd', 'DATE NULL'], ['port_loading_id', 'INT NULL'], ['port_dest_id', 'INT NULL'], ['tps_id', 'INT NULL'], ['legacy_status', 'TINYINT NULL'],
    ['origin', "ENUM('NEW','LEGACY') NOT NULL DEFAULT 'NEW'"], ['legacy_id', 'BIGINT NULL']]) await addCol('job_orders', c, d);
  await uniq('job_orders', 'uq_jo_legacy', 'legacy_id');
  await fk('job_orders', 'port_loading_id', 'ports', 'fk_jo_port_loading'); await fk('job_orders', 'port_dest_id', 'ports', 'fk_jo_port_dest'); await fk('job_orders', 'tps_id', 'tps_warehouses', 'fk_jo_tps');
  if (!(await hasTable('jo_containers'))) await q(`CREATE TABLE jo_containers (id INT AUTO_INCREMENT PRIMARY KEY, jo_id INT NOT NULL, size VARCHAR(5) NOT NULL, qty INT NOT NULL, INDEX idx_joc_jo (jo_id), FOREIGN KEY (jo_id) REFERENCES job_orders(id) ON DELETE CASCADE)`);
  // jenis referensi baru: HBL (pola sama dengan 003-nopen.js)
  const ct = await columnType('jo_references', 'kind');
  if (ct && !/HBL/i.test(ct)) await q("ALTER TABLE jo_references MODIFY kind ENUM('AJU','INVOICE','BL','SI_DO','SI_PO','NOPEN','HBL') NOT NULL");

  /* ---- master ---- */
  for (const [c, d] of [['email', 'VARCHAR(150) NULL'], ['phone', 'VARCHAR(50) NULL'], ['address', 'VARCHAR(255) NULL'], ['city', 'VARCHAR(100) NULL'], ['tax_no', 'VARCHAR(30) NULL'], ['legacy_code', 'VARCHAR(100) NULL'], ['needs_code_review', 'TINYINT(1) NOT NULL DEFAULT 0'], ['legacy_id', 'BIGINT NULL']]) await addCol('customers', c, d);
  await uniq('customers', 'uq_customers_legacy', 'legacy_id');
  for (const [c, d] of [['city', 'VARCHAR(100) NULL'], ['npwp', 'VARCHAR(30) NULL'], ['pic', 'VARCHAR(80) NULL'], ['country_id', 'INT NULL'], ['needs_code_review', 'TINYINT(1) NOT NULL DEFAULT 0'], ['legacy_id', 'BIGINT NULL']]) await addCol('vendors', c, d);
  await uniq('vendors', 'uq_vendors_legacy', 'legacy_id'); await fk('vendors', 'country_id', 'countries', 'fk_vendors_country');
  for (const [c, d] of [['city', 'VARCHAR(100) NULL'], ['country_id', 'INT NULL'], ['legacy_id', 'BIGINT NULL']]) await addCol('shippers', c, d);
  await uniq('shippers', 'uq_shippers_legacy', 'legacy_id'); await fk('shippers', 'country_id', 'countries', 'fk_shippers_country');

  /* ---- material, tiket, surat jalan, pengguna ---- */
  await addCol('jo_materials', 'container_no', 'VARCHAR(20) NULL'); await addCol('jo_materials', 'container_size', 'VARCHAR(5) NULL');
  await addCol('jo_materials', 'origin', "ENUM('NEW','LEGACY') NOT NULL DEFAULT 'NEW'"); await addCol('jo_materials', 'legacy_id', 'BIGINT NULL'); await uniq('jo_materials', 'uq_mat_legacy', 'legacy_id');
  await addCol('handling_tickets', 'origin', "ENUM('NEW','LEGACY') NOT NULL DEFAULT 'NEW'"); await addCol('handling_tickets', 'is_placeholder', 'TINYINT(1) NOT NULL DEFAULT 0'); await addCol('handling_tickets', 'legacy_id', 'BIGINT NULL'); await uniq('handling_tickets', 'uq_ht_legacy', 'legacy_id');
  await addCol('delivery_notes', 'destination', 'VARCHAR(100) NULL'); await addCol('delivery_notes', 'origin_address', 'VARCHAR(100) NULL'); await addCol('delivery_notes', 'legacy_status', 'TINYINT NULL');
  await addCol('delivery_notes', 'origin', "ENUM('NEW','LEGACY') NOT NULL DEFAULT 'NEW'"); await addCol('delivery_notes', 'legacy_id', 'BIGINT NULL'); await uniq('delivery_notes', 'uq_dn_legacy', 'legacy_id');
  await addCol('delivery_note_items', 'legacy_flag', 'TINYINT NULL'); await addCol('delivery_note_items', 'legacy_id', 'BIGINT NULL'); await uniq('delivery_note_items', 'uq_dni_legacy', 'legacy_id');
  await addCol('users', 'legacy_id', 'BIGINT NULL'); await uniq('users', 'uq_users_legacy', 'legacy_id');
};
