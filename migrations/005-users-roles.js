// Role & izin (RBAC) + kolom akun di users. Hanya menambah; tidak ada data atau kolom yang dihapus.
exports.up = async m => {
  const { q, hasTable, hasIndex, fkOf, addCol } = m;
  if (!(await hasTable('roles'))) await q(`CREATE TABLE roles (
    id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL UNIQUE, description VARCHAR(255) NULL,
    is_system TINYINT(1) NOT NULL DEFAULT 0, data_scope ENUM('ALL','OWN') NOT NULL DEFAULT 'ALL',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT NULL, updated_by INT NULL)`);
  if (!(await hasTable('role_permissions'))) await q(`CREATE TABLE role_permissions (
    role_id INT NOT NULL, permission VARCHAR(60) NOT NULL, PRIMARY KEY (role_id, permission),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE)`);

  await addCol('users', 'email', 'VARCHAR(150) NULL');
  await addCol('users', 'role_id', 'INT NULL');
  await addCol('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addCol('users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addCol('users', 'last_login_at', 'DATETIME NULL');
  if (!(await hasIndex('users', 'uq_users_email'))) await q('ALTER TABLE users ADD UNIQUE INDEX uq_users_email (email)'); // NULL boleh banyak (user lama)
  if (!(await hasIndex('users', 'idx_users_role'))) await q('ALTER TABLE users ADD INDEX idx_users_role (role_id)');
  if (!(await fkOf('users', 'role_id')).length) await q('ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)');

  await require('../lib/roles-seed').syncSystemRoles(m.pool);
};
