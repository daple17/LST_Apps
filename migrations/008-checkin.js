// Check In & Daily Report: absensi harian dan baris laporan harian. Hanya menambah. Tidak ada data awal.
exports.up = async m => {
  const { q, one, hasTable, addCol } = m;
  if (!(await hasTable('attendance'))) await q(`CREATE TABLE attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    work_date DATE NOT NULL,
    status ENUM('WFO','WFH','ALF','SCK','OTH') NOT NULL,
    check_in_at DATETIME NULL,
    lat DECIMAL(10,7) NULL, lng DECIMAL(10,7) NULL, accuracy_m INT NULL,
    note VARCHAR(255) NULL,
    source ENUM('SELF','HR') NOT NULL DEFAULT 'SELF',
    created_by INT NULL, updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_att_user_day (user_id, work_date), INDEX idx_att_date (work_date),
    FOREIGN KEY (user_id) REFERENCES users(id))`);
  if (!(await hasTable('daily_report_items'))) await q(`CREATE TABLE daily_report_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    work_date DATE NOT NULL,
    start_time TIME NOT NULL, end_time TIME NULL,
    activity VARCHAR(255) NOT NULL,
    created_by INT NULL, updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dr_user_day (user_id, work_date), FOREIGN KEY (user_id) REFERENCES users(id))`);
  // tanggal bergabung (UTC): alfa otomatis hanya dihitung sejak pegawai ada. User lama = tanggal migrasi ini.
  await addCol('users', 'created_at', 'DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())');
  // pegawai lama berrole PIC Operasional boleh check in (role contoh dibuat migrasi 005; role buatan sendiri tidak disentuh)
  const pic = await one("SELECT id FROM roles WHERE name='PIC Operasional' AND is_system=0");
  if (pic) await q('INSERT IGNORE INTO role_permissions (role_id, permission) VALUES ?', [['checkin.view', 'checkin.create', 'checkin.update'].map(p => [pic.id, p])]);
};
