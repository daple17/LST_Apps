// Handling Ops: tiket multi-JO, material di level JO + material_reports per tiket, surat jalan, foto -> files.
const fs = require('fs'), path = require('path');
const cfg = require('../config');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const sizeOf = p => { try { return fs.statSync(path.join(cfg.uploadDir, p)).size; } catch { return null; } };

exports.up = async m => {
  const { q, one, hasColumn, hasTable, hasIndex, fkOf, addCol, dropCol, renameTable, count } = m;
  const snap = { tickets: await count('ho_tickets') + await count('handling_tickets'), mats: await count('materials') + await count('jo_materials'), sj: await count('surat_jalan') + await count('delivery_notes'), items: await count('surat_jalan_items') + await count('delivery_note_items') };

  // A. nama tabel sesuai spesifikasi
  await renameTable('ho_tickets', 'handling_tickets'); await renameTable('ho_ticket_jos', 'ticket_job_orders'); await renameTable('materials', 'jo_materials');
  await renameTable('surat_jalan', 'delivery_notes'); await renameTable('surat_jalan_items', 'delivery_note_items');

  // B. handling_tickets: jejak pengguna
  await addCol('handling_tickets', 'created_by', 'INT NULL'); await addCol('handling_tickets', 'updated_by', 'INT NULL');
  await addCol('handling_tickets', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await q('UPDATE handling_tickets SET created_by=pic_id WHERE created_by IS NULL');

  // C. satu JO boleh ada di tiket lama yang sudah selesai: lepas UNIQUE(jo_id), aturan "tiket aktif" dijaga di server
  if (!(await hasIndex('ticket_job_orders', 'idx_tjo_jo'))) await q('ALTER TABLE ticket_job_orders ADD INDEX idx_tjo_jo (jo_id)');
  if (await hasIndex('ticket_job_orders', 'jo_id')) await q('ALTER TABLE ticket_job_orders DROP INDEX jo_id');

  // D. jo_materials
  await addCol('jo_materials', 'shape', 'VARCHAR(10) NULL');
  await addCol('jo_materials', 'kondisi', "ENUM('INTACT','PARTIAL') NOT NULL DEFAULT 'INTACT'");
  await addCol('jo_materials', 'created_by', 'INT NULL'); await addCol('jo_materials', 'updated_by', 'INT NULL');
  await addCol('jo_materials', 'created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  await addCol('jo_materials', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  // E. material_reports (satu per material per tiket)
  await q(`CREATE TABLE IF NOT EXISTS material_reports (
    id INT AUTO_INCREMENT PRIMARY KEY, material_id INT NOT NULL, ticket_id INT NOT NULL,
    status ENUM('NOT_CHECKED','OK','DAMAGE') NOT NULL DEFAULT 'NOT_CHECKED', remarks TEXT NULL,
    checked_by INT NULL, checked_by_name VARCHAR(100) NULL, checked_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_report (material_id, ticket_id),
    FOREIGN KEY (material_id) REFERENCES jo_materials(id) ON DELETE CASCADE, FOREIGN KEY (ticket_id) REFERENCES handling_tickets(id) ON DELETE CASCADE)`);

  // F. status lama (melekat di material) -> material_reports
  if (await hasColumn('jo_materials', 'check_status')) {
    await q(`INSERT INTO material_reports (material_id, ticket_id, status, remarks, checked_by_name, checked_at)
      SELECT id, ticket_id, check_status, remarks, checked_by, checked_at FROM jo_materials mm
      WHERE ticket_id IS NOT NULL AND (check_status<>'NOT_CHECKED' OR ${(await hasTable('material_photos')) ? 'EXISTS (SELECT 1 FROM material_photos p WHERE p.material_id=mm.id)' : '0'})
      ON DUPLICATE KEY UPDATE material_id=material_id`);
  }

  // G. foto material -> files (pemilik: material_report)
  if (await hasTable('material_photos')) {
    const photos = await q('SELECT p.*, (SELECT r.id FROM material_reports r WHERE r.material_id=p.material_id LIMIT 1) rid FROM material_photos p');
    for (const p of photos) {
      if (!p.rid) throw new Error(`Foto ${p.id} tidak punya material_report`);
      const dup = await one("SELECT id FROM files WHERE owner_type='material_report' AND owner_id=? AND path=?", [p.rid, p.path]);
      if (!dup) await q('INSERT INTO files (owner_type, owner_id, kind, filename, path, size, mime) VALUES (?,?,?,?,?,?,?)', ['material_report', p.rid, 'photo', path.basename(p.path), p.path, sizeOf(p.path), MIME[path.extname(p.path).toLowerCase()] || 'image/jpeg']);
    }
    if ((await count('files', "owner_type='material_report'")) < photos.length) throw new Error('Foto material belum seluruhnya dipindahkan');
    await q('DROP TABLE material_photos');
  }

  // H. unik per JO (bukan per tiket); buang kolom yang pindah ke material_reports
  if (await hasColumn('jo_materials', 'ticket_id')) {
    const dup = await one('SELECT COUNT(*) n FROM (SELECT 1 FROM jo_materials GROUP BY jo_id, product_no HAVING COUNT(*)>1) d');
    if (dup.n) throw new Error(`Ada ${dup.n} nomor produk ganda dalam satu JO — rapikan dulu sebelum migrasi`);
    if (!(await hasIndex('jo_materials', 'uq_jo_product'))) await q('ALTER TABLE jo_materials ADD UNIQUE KEY uq_jo_product (jo_id, product_no)');
    for (const fk of await fkOf('jo_materials', 'ticket_id')) await q(`ALTER TABLE jo_materials DROP FOREIGN KEY \`${fk}\``);
    if (await hasIndex('jo_materials', 'uq_mat')) await q('ALTER TABLE jo_materials DROP INDEX uq_mat');
    for (const c of ['ticket_id', 'check_status', 'remarks', 'checked_at', 'checked_by']) await dropCol('jo_materials', c);
  }

  // I. surat jalan -> delivery_notes
  if (await hasColumn('delivery_notes', 'sj_no')) await q('ALTER TABLE delivery_notes CHANGE sj_no no_sj VARCHAR(20) NOT NULL');
  if (await hasColumn('delivery_notes', 'start_at')) await q('ALTER TABLE delivery_notes CHANGE start_at start_loading TIMESTAMP NULL');
  if (await hasColumn('delivery_notes', 'finish_at')) await q('ALTER TABLE delivery_notes CHANGE finish_at finish_loading TIMESTAMP NULL');
  if (/char/i.test((await m.columnType('delivery_notes', 'created_by')) || '')) await q('ALTER TABLE delivery_notes CHANGE created_by created_by_name VARCHAR(100) NULL');
  await addCol('delivery_notes', 'created_by', 'INT NULL'); await addCol('delivery_notes', 'updated_by', 'INT NULL');
  await addCol('delivery_notes', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  if (await hasColumn('delivery_note_items', 'sj_id')) await q('ALTER TABLE delivery_note_items CHANGE sj_id dn_id INT NOT NULL');
  await addCol('delivery_note_items', 'mark', "ENUM('GOOD','DAMAGE') NULL");
  await q(`UPDATE delivery_note_items i JOIN delivery_notes dn ON dn.id=i.dn_id JOIN material_reports r ON r.material_id=i.material_id AND r.ticket_id=dn.ticket_id
    SET i.mark = CASE r.status WHEN 'DAMAGE' THEN 'DAMAGE' WHEN 'OK' THEN 'GOOD' ELSE NULL END WHERE i.mark IS NULL`);

  // J. foto surat jalan -> files
  if (await hasTable('sj_photos')) {
    const ph = await q('SELECT * FROM sj_photos');
    for (const p of ph) {
      const dup = await one("SELECT id FROM files WHERE owner_type='delivery_note' AND owner_id=? AND path=?", [p.sj_id, p.path]);
      if (!dup) await q('INSERT INTO files (owner_type, owner_id, kind, filename, path, size, mime) VALUES (?,?,?,?,?,?,?)', ['delivery_note', p.sj_id, 'photo', path.basename(p.path), p.path, sizeOf(p.path), MIME[path.extname(p.path).toLowerCase()] || 'image/jpeg']);
    }
    if ((await count('files', "owner_type='delivery_note'")) < ph.length) throw new Error('Foto surat jalan belum seluruhnya dipindahkan');
    await q('DROP TABLE sj_photos');
  }

  // K. penghitung nomor: tiket per bulan, surat jalan per bulan
  for (const r of await q("SELECT LEFT(ticket_no,6) p, COUNT(*) n FROM handling_tickets WHERE ticket_no REGEXP '^[0-9]{6}' GROUP BY LEFT(ticket_no,6)"))
    await q("INSERT INTO counters (name, period, last) VALUES ('TICKET',?,?) ON DUPLICATE KEY UPDATE last=GREATEST(last, VALUES(last))", [r.p, r.n]);
  for (const r of await q("SELECT LEFT(no_sj,6) p, MAX(CAST(SUBSTRING(no_sj,7) AS UNSIGNED)) n FROM delivery_notes WHERE no_sj REGEXP '^[0-9]{10}$' GROUP BY LEFT(no_sj,6)"))
    await q("INSERT INTO counters (name, period, last) VALUES ('SJ',?,?) ON DUPLICATE KEY UPDATE last=GREATEST(last, VALUES(last))", [r.p, r.n]);

  // L. verifikasi jumlah baris
  const now = { tickets: await count('handling_tickets'), mats: await count('jo_materials'), sj: await count('delivery_notes'), items: await count('delivery_note_items') };
  for (const k of Object.keys(snap)) if (snap[k] !== now[k]) throw new Error(`Jumlah ${k} berubah: ${snap[k]} -> ${now[k]}`);
};
