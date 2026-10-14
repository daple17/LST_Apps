// Job Order: referensi ganda, checklist per baris, berkas polimorfik, penomoran atomik, audit log.
const fs = require('fs'), path = require('path');
const rules = require('../lib/rules');
const { parseParty, splitRefs } = require('../lib/format');
const cfg = require('../config');

const CAT_TO_DOC = { 'Bill of Lading': 'BL', Invoice: 'INVOICE', 'Packing List': 'OTHERS', 'SI / PO': 'SI_PO', 'PIB / PEB': 'PIB_PEB', DO: 'SI_DO', 'Faktur Pajak': 'FAKTUR_PAJAK', Lainnya: 'OTHERS' };
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

exports.up = async m => {
  const { q, one, hasColumn, hasTable, addCol, dropCol } = m;

  // 1. tabel pendukung
  await q(`CREATE TABLE IF NOT EXISTS counters (name VARCHAR(20) NOT NULL, period VARCHAR(10) NOT NULL DEFAULT '', last INT NOT NULL DEFAULT 0, PRIMARY KEY (name, period))`);
  await q(`CREATE TABLE IF NOT EXISTS files (
    id INT AUTO_INCREMENT PRIMARY KEY, owner_type VARCHAR(30) NOT NULL, owner_id INT NOT NULL, kind VARCHAR(30) NULL,
    filename VARCHAR(255) NOT NULL, path VARCHAR(255) NOT NULL, size INT NULL, mime VARCHAR(100) NULL, uploaded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_files_owner (owner_type, owner_id))`);
  await q(`CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id INT NOT NULL, action VARCHAR(60) NOT NULL, note VARCHAR(255) NULL,
    user_id INT NULL, user_name VARCHAR(100) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_audit_entity (entity_type, entity_id))`);
  await q(`CREATE TABLE IF NOT EXISTS jo_references (
    id INT AUTO_INCREMENT PRIMARY KEY, jo_id INT NOT NULL, kind ENUM('AJU','INVOICE','BL','SI_DO','SI_PO') NOT NULL, number VARCHAR(80) NOT NULL,
    ref_date DATE NULL, file_id INT NULL, sort INT NOT NULL DEFAULT 0, created_by INT NULL, updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ref_number (number), INDEX idx_ref_jo (jo_id, kind), FOREIGN KEY (jo_id) REFERENCES job_orders(id) ON DELETE CASCADE)`);
  await q(`CREATE TABLE IF NOT EXISTS jo_checklist (
    id INT AUTO_INCREMENT PRIMARY KEY, jo_id INT NOT NULL, item VARCHAR(30) NOT NULL, inv TINYINT(1) NOT NULL DEFAULT 0, fp TINYINT(1) NOT NULL DEFAULT 0,
    inv_by VARCHAR(100) NULL, inv_at TIMESTAMP NULL, fp_by VARCHAR(100) NULL, fp_at TIMESTAMP NULL,
    UNIQUE KEY uq_jo_item (jo_id, item), FOREIGN KEY (jo_id) REFERENCES job_orders(id) ON DELETE CASCADE)`);

  // 2. kolom baru job_orders
  const before = await m.count('job_orders');
  await addCol('job_orders', 'legacy_no', 'VARCHAR(20) NULL');
  await addCol('job_orders', 'nickname', 'VARCHAR(100) NULL');
  await addCol('job_orders', 'type_bc', 'VARCHAR(10) NULL');
  await addCol('job_orders', 'jenis_muatan', "ENUM('FCL','LCL_BB') NULL");
  await addCol('job_orders', 'container_count', 'INT NULL');
  await addCol('job_orders', 'container_type', 'VARCHAR(10) NULL');
  await addCol('job_orders', 'weight_kg', 'DECIMAL(14,2) NULL');
  await addCol('job_orders', 'qty', 'INT NULL');
  await addCol('job_orders', 'unit', 'VARCHAR(10) NULL');
  await addCol('job_orders', 'party_text', 'VARCHAR(100) NULL');
  await addCol('job_orders', 'cbm', 'DECIMAL(10,2) NULL');
  await addCol('job_orders', 'updated_by', 'INT NULL');

  // 3. rename kolom
  if (await hasColumn('job_orders', 'jo_no')) await q('ALTER TABLE job_orders CHANGE jo_no no_jo VARCHAR(20) NOT NULL');
  if (await hasColumn('job_orders', 'cargo_type')) await q('ALTER TABLE job_orders CHANGE cargo_type cargo_desc VARCHAR(80) NULL');
  if (await hasColumn('job_orders', 'eta')) await q('ALTER TABLE job_orders CHANGE eta eta_etd DATE NULL');

  // 4. nomor JO: 0027-BTU -> 0027BTU (nomor lama disimpan di legacy_no)
  await q("UPDATE job_orders SET legacy_no=no_jo, no_jo=REPLACE(no_jo,'-','') WHERE legacy_no IS NULL AND no_jo LIKE '%-%'");

  // 5. tipe lama -> tipe baru + Type BC
  const ct = await m.columnType('job_orders', 'type');
  if (ct && !/^enum/i.test(ct)) {
    const olds = (await q('SELECT DISTINCT type FROM job_orders')).map(r => r.type);
    const unknown = olds.filter(t => !rules.LEGACY_TYPE[t]);
    if (unknown.length) throw new Error(`Tipe JO lama tidak dikenal: ${unknown.join(', ')} — tentukan pemetaannya di lib/rules.js (LEGACY_TYPE)`);
    for (const t of olds) { const [nt, bc] = rules.LEGACY_TYPE[t]; await q('UPDATE job_orders SET type_bc=?, type=? WHERE type=?', [bc, nt, t]); }
    await q(`ALTER TABLE job_orders MODIFY type ENUM(${rules.JO_TYPES.map(t => `'${t.code}'`).join(',')}) NOT NULL`);
  }

  // 6. berat: ton -> kg
  if (await hasColumn('job_orders', 'weight')) await q('UPDATE job_orders SET weight_kg=ROUND(weight*1000,2) WHERE weight_kg IS NULL AND weight IS NOT NULL');

  // 7. party "300 CL" -> qty + satuan (yang tidak dikenali disimpan apa adanya di party_text)
  if (await hasColumn('job_orders', 'party')) {
    for (const r of await q('SELECT id, party FROM job_orders WHERE party IS NOT NULL AND party<>"" AND qty IS NULL AND party_text IS NULL')) {
      const p = parseParty(r.party);
      await q('UPDATE job_orders SET qty=?, unit=?, party_text=? WHERE id=?', [p.qty, p.unit, p.text, r.id]);
    }
  }

  // 8. referensi (invoice/BL/SI-PO/aju) -> jo_references
  const refCols = { INVOICE: 'invoice_no', BL: 'bl_no', SI_PO: 'si_po_no', AJU: 'aju_no' };
  let expectedRefs = 0;
  if (await hasColumn('job_orders', 'invoice_no')) {
    for (const r of await q('SELECT * FROM job_orders j WHERE NOT EXISTS (SELECT 1 FROM jo_references x WHERE x.jo_id=j.id)')) {
      let sort = 0;
      for (const [kind, col] of Object.entries(refCols)) {
        for (const n of splitRefs(r[col])) { await q('INSERT INTO jo_references (jo_id, kind, number, sort) VALUES (?,?,?,?)', [r.id, kind, n.slice(0, 80), sort++]); expectedRefs++; }
      }
    }
  }

  // 9. checklist 12 item (JSON) -> jo_checklist 9 item (digabung OR)
  if (await hasColumn('job_orders', 'checklist')) {
    for (const r of await q('SELECT id, checklist FROM job_orders j WHERE NOT EXISTS (SELECT 1 FROM jo_checklist x WHERE x.jo_id=j.id)')) {
      let c = r.checklist; if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = {}; } } c = c || {};
      for (const it of rules.CHECKLIST_ITEMS) {
        const inv = it.legacy.some(k => c[k]?.inv) ? 1 : 0, fp = it.legacy.some(k => c[k]?.fp) ? 1 : 0;
        await q('INSERT INTO jo_checklist (jo_id, item, inv, fp) VALUES (?,?,?,?)', [r.id, it.code, inv, fp]);
      }
    }
  }

  // 10. berkas dokumen -> files
  if (await hasColumn('jo_documents', 'path')) {
    await addCol('jo_documents', 'doc_type', "VARCHAR(20) NOT NULL DEFAULT 'OTHERS'");
    await addCol('jo_documents', 'doc_no', 'VARCHAR(80) NULL');
    await addCol('jo_documents', 'file_id', 'INT NULL');
    await addCol('jo_documents', 'created_by', 'INT NULL');
    await addCol('jo_documents', 'updated_by', 'INT NULL');
    await addCol('jo_documents', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    for (const d of await q('SELECT * FROM jo_documents WHERE file_id IS NULL')) {
      let size = null; try { size = fs.statSync(path.join(cfg.uploadDir, d.path)).size; } catch { /* berkas fisik tidak ada */ }
      const [f] = await m.pool.query('INSERT INTO files (owner_type, owner_id, kind, filename, path, size, mime) VALUES (?,?,?,?,?,?,?)',
        ['jo_document', d.id, null, d.filename, d.path, size, MIME[path.extname(d.filename).toLowerCase()] || 'application/octet-stream']);
      await q('UPDATE jo_documents SET file_id=?, doc_type=? WHERE id=?', [f.insertId, CAT_TO_DOC[d.category] || 'OTHERS', d.id]);
    }
    const left = await m.count('jo_documents', 'file_id IS NULL');
    if (left) throw new Error('Dokumen JO belum seluruhnya dipindahkan ke tabel files');
    await dropCol('jo_documents', 'filename'); await dropCol('jo_documents', 'path'); await dropCol('jo_documents', 'category');
  }

  // 11. jo_logs -> audit_log
  if (await hasTable('jo_logs')) {
    await q(`INSERT INTO audit_log (entity_type, entity_id, action, note, user_name, created_at)
      SELECT 'job_order', l.jo_id, l.action, l.note, l.user_name, l.created_at FROM jo_logs l
      WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type='job_order' AND a.entity_id=l.jo_id AND a.action=l.action AND a.created_at=l.created_at)`);
  }

  // 12. verifikasi sebelum membuang kolom/tabel lama
  const after = await m.count('job_orders');
  if (after !== before) throw new Error(`Jumlah JO berubah: ${before} -> ${after}`);
  if (expectedRefs && (await m.count('jo_references')) < expectedRefs) throw new Error('Jumlah referensi hasil migrasi kurang dari yang diharapkan');
  const noItems = await one('SELECT COUNT(*) n FROM job_orders j WHERE (SELECT COUNT(*) FROM jo_checklist c WHERE c.jo_id=j.id) <> ?', [rules.CHECKLIST_ITEMS.length]);
  if (noItems.n) throw new Error('Ada JO tanpa 9 baris checklist');
  for (const c of ['invoice_no', 'bl_no', 'si_po_no', 'aju_no', 'checklist', 'weight', 'party']) await dropCol('job_orders', c);
  if (await hasTable('jo_logs')) await q('DROP TABLE jo_logs');

  // 13. penghitung nomor: lanjutkan dari nomor tertinggi yang ada
  const mx = await one("SELECT COALESCE(MAX(CAST(REGEXP_SUBSTR(no_jo,'^[0-9]+') AS UNSIGNED)),0) n FROM job_orders");
  await q("INSERT INTO counters (name, period, last) VALUES ('JO','',?) ON DUPLICATE KEY UPDATE last=GREATEST(last, VALUES(last))", [mx.n]);
};
