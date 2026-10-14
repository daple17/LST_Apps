// Role Management: role + izin. Role sistem (Super Admin) tidak bisa diubah/dihapus.
const express = require('express');
const { wrap, httpError, tx } = require('../lib/http');
const audit = require('../lib/audit');
const P = require('../lib/permissions');

const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });

// validasi + normalisasi: kode harus dikenal; aksi selain "lihat" otomatis menyertakan "lihat" bila modulnya punya aksi lihat
function cleanPerms(list) {
  if (!Array.isArray(list)) throw invalid('permissions', 'Daftar izin tidak valid');
  const set = new Set(list.map(String)), unknown = [...set].filter(c => !P.isValid(c));
  if (unknown.length) throw invalid('permissions', `Izin tidak dikenal: ${unknown.slice(0, 5).join(', ')}`);
  for (const m of P.MODULES) if (m.actions.includes('view') && m.actions.some(a => set.has(P.codeOf(m.key, a)))) set.add(P.codeOf(m.key, 'view'));
  return [...set].sort();
}
const activeModules = perms => new Set(perms.map(p => p.split('.')[0])).size;

module.exports = pool => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const loadPerms = async id => (await q('SELECT permission FROM role_permissions WHERE role_id=? ORDER BY permission', [id])).map(x => x.permission);
  const shape = (x, perms) => ({ id: x.id, name: x.name, description: x.description || '', is_system: !!x.is_system, data_scope: x.data_scope, users: x.users, updated_at: x.updated_at,
    perm_count: perms.length, active_modules: activeModules(perms) });
  const SEL = 'SELECT r.id, r.name, r.description, r.is_system, r.data_scope, r.updated_at, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) users FROM roles r';
  const must = async id => { const x = await one(`${SEL} WHERE r.id=?`, [id]); if (!x) throw httpError(404, 'Role tidak ditemukan'); return x; };
  const fields = async (b, id = 0, cur = null) => {
    const name = String(b.name ?? cur?.name ?? '').trim(), description = String(b.description ?? cur?.description ?? '').trim();
    if (name.length < 2 || name.length > 60) throw invalid('name', 'Nama role 2-60 karakter');
    if (description.length > 255) throw invalid('description', 'Deskripsi maksimal 255 karakter');
    if (await one('SELECT id FROM roles WHERE name=? AND id<>?', [name, id])) throw invalid('name', 'Nama role sudah dipakai');
    if (b.data_scope !== undefined && b.data_scope !== 'ALL') throw invalid('data_scope', 'Cakupan data saat ini hanya "Semua data"');
    return { name, description: description || null };
  };
  const permNote = (before, after) => {
    const add = after.filter(p => !before.includes(p)), del = before.filter(p => !after.includes(p));
    return `izin ${before.length} → ${after.length}${add.length ? `; ditambah: ${add.join(', ')}` : ''}${del.length ? `; dicabut: ${del.join(', ')}` : ''}`;
  };

  r.get('/', wrap(async (req, res) => {
    const roles = await q(`${SEL} ORDER BY r.is_system DESC, r.name`), perms = await q('SELECT role_id, permission FROM role_permissions');
    res.json(roles.map(x => shape(x, perms.filter(p => p.role_id === x.id).map(p => p.permission))));
  }));

  r.get('/:id(\\d+)', wrap(async (req, res) => {
    const x = await must(req.params.id), perms = await loadPerms(x.id);
    res.json({ ...shape(x, perms), permissions: perms });
  }));

  r.post('/', wrap(async (req, res) => {
    const f = await fields(req.body), perms = cleanPerms(req.body.permissions || []);
    const id = await tx(pool, async c => {
      const [ins] = await c.query('INSERT INTO roles (name, description, created_by, updated_by) VALUES (?,?,?,?)', [f.name, f.description, req.user.id, req.user.id]);
      if (perms.length) await c.query('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [ins.insertId, p])]);
      return ins.insertId;
    });
    await audit.log(pool, { entity: 'role', id, action: 'Dibuat', note: `${f.name}; ${permNote([], perms)}`, user: req.user });
    res.json({ id });
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await must(req.params.id);
    if (cur.is_system) throw httpError(403, 'Role sistem tidak bisa diubah');
    const f = await fields(req.body, cur.id, cur), before = await loadPerms(cur.id);
    const after = req.body.permissions === undefined ? before : cleanPerms(req.body.permissions);
    await tx(pool, async c => {
      await c.query('UPDATE roles SET name=?, description=?, updated_by=? WHERE id=?', [f.name, f.description, req.user.id, cur.id]);
      await c.query('DELETE FROM role_permissions WHERE role_id=?', [cur.id]);
      if (after.length) await c.query('INSERT INTO role_permissions (role_id, permission) VALUES ?', [after.map(p => [cur.id, p])]);
    });
    const parts = [];
    if (f.name !== cur.name) parts.push(`nama: ${cur.name} → ${f.name}`);
    if ((f.description || '') !== (cur.description || '')) parts.push('deskripsi diubah');
    if (before.join() !== after.join()) parts.push(permNote(before, after));
    await audit.log(pool, { entity: 'role', id: cur.id, action: before.join() !== after.join() ? 'Izin diubah' : 'Diubah', note: parts.join('; ') || 'tanpa perubahan', user: req.user });
    res.json({ ok: true, permissions: after });
  }));

  r.post('/:id(\\d+)/duplicate', wrap(async (req, res) => {
    const src = await must(req.params.id), perms = await loadPerms(src.id);
    let name = `${src.name} (salinan)`, n = 2;
    while (await one('SELECT id FROM roles WHERE name=?', [name])) name = `${src.name} (salinan ${n++})`;
    const id = await tx(pool, async c => {
      const [ins] = await c.query('INSERT INTO roles (name, description, created_by, updated_by) VALUES (?,?,?,?)', [name.slice(0, 60), src.description, req.user.id, req.user.id]);
      if (perms.length) await c.query('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [ins.insertId, p])]);
      return ins.insertId;
    });
    await audit.log(pool, { entity: 'role', id, action: 'Dibuat', note: `salinan dari ${src.name}; ${permNote([], perms)}`, user: req.user });
    res.json({ id, name });
  }));

  r.delete('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await must(req.params.id);
    if (cur.is_system) throw httpError(403, 'Role sistem tidak bisa dihapus');
    if (cur.users) throw httpError(400, `Role masih dipakai ${cur.users} user. Pindahkan user ke role lain dulu.`);
    await pool.query('DELETE FROM roles WHERE id=?', [cur.id]);
    await audit.log(pool, { entity: 'role', id: cur.id, action: 'Dihapus', note: cur.name, user: req.user });
    res.json({ ok: true });
  }));
  return r;
};
