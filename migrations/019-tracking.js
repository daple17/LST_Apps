// Tracking progres surat jalan (docs/prompt-tracking-messi.md): status + riwayat event + kolom tautan driver. Aditif dan idempoten.
const crypto = require('crypto');
exports.up = async m => {
  const { q, addCol, hasTable } = m;
  await addCol('vendors', 'is_own_fleet', 'TINYINT(1) NOT NULL DEFAULT 0');
  await q("UPDATE vendors SET is_own_fleet=1 WHERE code='LST' AND is_own_fleet=0");
  await addCol('delivery_notes', 'track_status', "ENUM('PLANNING','READY','STARTED','ARRIVED_PICKUP','LOADED','IN_TRANSIT','ARRIVED_DEST','DELIVERED','COMPLETED') NOT NULL DEFAULT 'PLANNING'");
  for (const [c, d] of [['track_status_at', 'TIMESTAMP NULL'], ['track_nonce', "CHAR(16) NOT NULL DEFAULT ''"], ['link_revoked_at', 'TIMESTAMP NULL'], ['link_opened_at', 'TIMESTAMP NULL'], ['link_verified_at', 'TIMESTAMP NULL'],
    ['verify_fails', 'TINYINT NOT NULL DEFAULT 0'], ['link_locked', 'TINYINT(1) NOT NULL DEFAULT 0'], ['received_by', 'VARCHAR(100) NULL'], ['completed_at', 'TIMESTAMP NULL'], ['completed_by', 'INT NULL']]) await addCol('delivery_notes', c, d);
  if (!(await hasTable('delivery_note_events'))) await q(`CREATE TABLE delivery_note_events (id INT AUTO_INCREMENT PRIMARY KEY, dn_id INT NOT NULL,
    status ENUM('PLANNING','READY','STARTED','ARRIVED_PICKUP','LOADED','IN_TRANSIT','ARRIVED_DEST','DELIVERED','COMPLETED') NOT NULL, source ENUM('OPS','DRIVER','SYSTEM') NOT NULL,
    by_user_id INT NULL, by_label VARCHAR(100) NULL, at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, manual TINYINT(1) NOT NULL DEFAULT 0,
    lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL, skipped TINYINT(1) NOT NULL DEFAULT 0, note VARCHAR(255) NULL, voided_at TIMESTAMP NULL, voided_by INT NULL, void_reason VARCHAR(255) NULL,
    INDEX idx_dne_dn (dn_id, id), CONSTRAINT fk_dne_dn FOREIGN KEY (dn_id) REFERENCES delivery_notes(id) ON DELETE CASCADE)`);
  // nonce untuk baris yang belum punya
  for (const r of await q("SELECT id FROM delivery_notes WHERE track_nonce=''")) await q('UPDATE delivery_notes SET track_nonce=? WHERE id=?', [crypto.randomBytes(8).toString('hex'), r.id]);
  // data lama (hasil impor): date_finish (= finish_loading) terisi -> COMPLETED, selain itu PLANNING; tanpa tautan driver aktif (ditandai dicabut)
  await q("UPDATE delivery_notes SET track_status='COMPLETED', completed_at=COALESCE(completed_at, finish_loading), track_status_at=COALESCE(track_status_at, finish_loading) WHERE origin='LEGACY' AND finish_loading IS NOT NULL AND track_status='PLANNING'");
  await q("UPDATE delivery_notes SET link_revoked_at=COALESCE(link_revoked_at, NOW()) WHERE origin='LEGACY'");
  // riwayat awal untuk surat jalan yang belum punya event
  await q(`INSERT INTO delivery_note_events (dn_id, status, source, by_label, at, note)
    SELECT d.id, d.track_status, 'SYSTEM', 'Sistem', COALESCE(d.track_status_at, d.created_at), IF(d.origin='LEGACY', 'Status dari data lama', 'Status awal')
    FROM delivery_notes d WHERE NOT EXISTS (SELECT 1 FROM delivery_note_events e WHERE e.dn_id=d.id)`);
};
