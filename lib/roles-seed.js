// Role bawaan. Super Admin selalu memegang SEMUA izin (juga modul baru di masa depan): disinkronkan tiap server start.
const { ALL_PERMISSIONS, levelPerms } = require('./permissions');

const SUPER_ADMIN = 'Super Admin';
const PIC_OPERASIONAL = { name: 'PIC Operasional', description: 'Mengelola JO dan Handling Ops.', perms: [...levelPerms('jo', 'manage'), ...levelPerms('ho', 'manage'), 'home.view'] };

async function ensureRole(db, name, description, isSystem) {
  const [[r]] = await db.query('SELECT id FROM roles WHERE name=?', [name]);
  if (r) return r.id;
  const [ins] = await db.query('INSERT INTO roles (name, description, is_system) VALUES (?,?,?)', [name, description, isSystem ? 1 : 0]);
  return ins.insertId;
}
const setPerms = async (db, roleId, perms) => {
  await db.query('DELETE FROM role_permissions WHERE role_id=? AND permission NOT IN (?)', [roleId, perms.length ? perms : ['']]);
  if (perms.length) await db.query('INSERT IGNORE INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [roleId, p])]);
};

// Idempoten. Dipanggil oleh migrasi 005 dan saat server start (setelah data master).
async function syncSystemRoles(db) {
  const sa = await ensureRole(db, SUPER_ADMIN, 'Akses penuh ke semua menu dan pengaturan.', true);
  await setPerms(db, sa, ALL_PERMISSIONS);
  // role contoh: dibuat sekali, isinya tidak ditimpa bila sudah diubah admin
  const [[had]] = await db.query('SELECT id FROM roles WHERE name=?', [PIC_OPERASIONAL.name]);
  if (!had) { const id = await ensureRole(db, PIC_OPERASIONAL.name, PIC_OPERASIONAL.description, false); await setPerms(db, id, PIC_OPERASIONAL.perms); }
  const [[pic]] = await db.query('SELECT id FROM roles WHERE name=?', [PIC_OPERASIONAL.name]);
  // admin = Super Admin; user lain yang belum punya role = PIC Operasional (agar tidak ada yang terkunci)
  await db.query("UPDATE users SET role_id=? WHERE username='admin' AND role_id IS NULL", [sa]);
  await db.query("UPDATE users SET email='admin@gmail.com' WHERE username='admin' AND email IS NULL");
  await db.query("UPDATE users SET role_id=? WHERE username<>'admin' AND role_id IS NULL", [pic.id]);
  return { superAdminId: sa, picId: pic.id };
}
module.exports = { SUPER_ADMIN, syncSystemRoles };
