// User Management: akun, email login, role. Aturan dijaga di server (bukan hanya di tampilan).
const express = require('express'), bcrypt = require('bcryptjs'), crypto = require('crypto');
const { wrap, httpError } = require('../lib/http');
const audit = require('../lib/audit');
const { SUPER_ADMIN } = require('../lib/roles-seed');

const PAGE = 20, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/, PIC_RE = /^[A-Z]{2}$/;
const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const note = s => String(s).slice(0, 250);
const genPassword = () => { const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join(''); };

module.exports = pool => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const SEL = `SELECT u.id, u.username, u.name, u.email, u.employee_no, u.pic_code, u.role_id, r.name role_name, r.is_system role_system, u.is_active, u.must_change_password, u.last_login_at
    FROM users u LEFT JOIN roles r ON r.id = u.role_id`;
  const isSuperRow = u => !!u.role_system && u.role_name === SUPER_ADMIN;
  const shape = u => ({ ...u, is_active: !!u.is_active, must_change_password: !!u.must_change_password, role_system: !!u.role_system, locked: isSuperRow(u) });
  const actorIsSuper = req => req.user.role?.is_system && req.user.role.name === SUPER_ADMIN;
  const activeSupers = async excludeId => (await one(`SELECT COUNT(*) n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.is_system=1 AND r.name=? AND u.is_active=1 AND u.id<>?`, [SUPER_ADMIN, excludeId]))?.n || 0;
  const picUsage = async u => (await one('SELECT COUNT(*) n FROM handling_tickets WHERE pic_id=? OR (? IS NOT NULL AND RIGHT(ticket_no, 2)=?)', [u.id, u.pic_code, u.pic_code])).n;

  // jejak transaksi: semua kolom created_by/updated_by/pic_id/user_id di tabel lain yang menunjuk user ini
  async function traces(id) {
    const cols = await q("SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('created_by','updated_by','pic_id','user_id') AND TABLE_NAME<>'users' AND DATA_TYPE IN ('int','bigint')");
    let n = 0; for (const { t, c } of cols) n += (await one(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${c}\`=?`, [id])).n;
    return n;
  }

  async function body(b, { id = null, current = null } = {}) {
    const out = {};
    out.name = String(b.name ?? current?.name ?? '').trim();
    if (!out.name) throw invalid('name', 'Nama lengkap wajib diisi');
    out.username = String(b.username ?? current?.username ?? '').trim();
    if (!USERNAME_RE.test(out.username)) throw invalid('username', 'Username 3-50 karakter: huruf, angka, titik, strip, garis bawah');
    out.email = String(b.email ?? current?.email ?? '').trim().toLowerCase();
    if (!out.email) throw invalid('email', 'Email login wajib diisi');
    if (!EMAIL_RE.test(out.email)) throw invalid('email', 'Format email tidak valid');
    out.employee_no = String(b.employee_no ?? current?.employee_no ?? '').trim() || null;
    if (out.employee_no && out.employee_no.length > 20) throw invalid('employee_no', 'No. ID maksimal 20 karakter');
    out.pic_code = String(b.pic_code ?? current?.pic_code ?? '').trim().toUpperCase();
    if (out.pic_code !== (current?.pic_code || '') && !PIC_RE.test(out.pic_code)) throw invalid('pic_code', 'Kode PIC harus 2 huruf kapital');
    if (!out.pic_code) throw invalid('pic_code', 'Kode PIC wajib diisi');
    out.role_id = +(b.role_id ?? current?.role_id) || null;
    if (!out.role_id || !(await one('SELECT id FROM roles WHERE id=?', [out.role_id]))) throw invalid('role_id', 'Role wajib dipilih');
    // duplikat (pesan per kolom)
    for (const [col, label] of [['username', 'Username'], ['email', 'Email'], ['pic_code', 'Kode PIC']]) {
      if (await one(`SELECT id FROM users WHERE ${col}=? AND id<>?`, [out[col], id || 0])) throw invalid(col, `${label} sudah dipakai user lain`);
    }
    if (b.password) { if (String(b.password).length < 8) throw invalid('password', 'Password minimal 8 karakter'); out.password = String(b.password); }
    return out;
  }
  const dupToFields = e => { if (e.code === 'ER_DUP_ENTRY') throw invalid(/email/.test(e.message) ? 'email' : 'username', 'Data sudah dipakai user lain'); throw e; };

  r.get('/', wrap(async (req, res) => {
    const where = [], p = [];
    const s = String(req.query.q || '').trim();
    if (s) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.pic_code LIKE ? OR u.username LIKE ? OR u.employee_no LIKE ?)'); p.push(...Array(5).fill(`%${s}%`)); }
    if (+req.query.role_id) { where.push('u.role_id=?'); p.push(+req.query.role_id); }
    const st = req.query.status;
    if (st === 'active') where.push('u.is_active=1'); else if (st === 'inactive') where.push('u.is_active=0'); else if (st === 'pending') where.push('u.is_active=1 AND u.last_login_at IS NULL');
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const page = Math.max(1, +req.query.page || 1);
    const total = (await one(`SELECT COUNT(*) n FROM users u ${W}`, p)).n;
    const rows = await q(`${SEL} ${W} ORDER BY u.is_active DESC, u.name LIMIT ? OFFSET ?`, [...p, PAGE, (page - 1) * PAGE]);
    const sum = await one('SELECT COUNT(*) total, SUM(is_active=1) active, SUM(is_active=0) inactive, SUM(is_active=1 AND last_login_at IS NULL) never FROM users');
    res.json({ rows: rows.map(shape), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), summary: { total: sum.total, active: +sum.active || 0, inactive: +sum.inactive || 0, never: +sum.never || 0 } });
  }));

  // daftar role + ringkasan izin untuk pilihan role di form user
  r.get('/roles', wrap(async (req, res) => {
    const roles = await q('SELECT r.id, r.name, r.description, r.is_system, r.data_scope, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) users FROM roles r ORDER BY r.is_system DESC, r.name');
    const perms = await q('SELECT role_id, permission FROM role_permissions');
    res.json(roles.map(x => ({ ...x, is_system: !!x.is_system, permissions: perms.filter(p => p.role_id === x.id).map(p => p.permission) })));
  }));

  r.get('/:id(\\d+)', wrap(async (req, res) => {
    const u = await one(`${SEL} WHERE u.id=?`, [req.params.id]);
    if (!u) throw httpError(404, 'User tidak ditemukan');
    const tr = await traces(u.id), pic = await picUsage(u);
    res.json({ ...shape(u), pic_used: pic, traces: tr, is_self: u.id === req.user.id, deletable: !tr && u.id !== req.user.id && !isSuperRow(u),
      delete_block: u.id === req.user.id ? 'Tidak bisa menghapus akun sendiri' : isSuperRow(u) ? 'User Super Admin tidak bisa dihapus' : tr ? `User sudah punya ${tr} jejak transaksi/audit, jadi dinonaktifkan, bukan dihapus permanen` : null });
  }));

  r.post('/', wrap(async (req, res) => {
    const b = await body(req.body), role = await one('SELECT name, is_system FROM roles WHERE id=?', [req.body.role_id]);
    if (role.is_system && role.name === SUPER_ADMIN && !actorIsSuper(req)) throw httpError(403, 'Hanya Super Admin yang boleh membuat Super Admin');
    const temp = b.password ? null : genPassword();
    const must = req.body.must_change_password === undefined ? 1 : (req.body.must_change_password ? 1 : 0);
    let id;
    try {
      const [ins] = await pool.query('INSERT INTO users (username,password,name,email,employee_no,pic_code,role_id,is_active,must_change_password) VALUES (?,?,?,?,?,?,?,?,?)',
        [b.username, bcrypt.hashSync(b.password || temp, 10), b.name, b.email, b.employee_no, b.pic_code, b.role_id, req.body.is_active === false || req.body.is_active === 0 ? 0 : 1, must]);
      id = ins.insertId;
    } catch (e) { dupToFields(e); }
    await audit.log(pool, { entity: 'user', id, action: 'Dibuat', note: note(`${b.username} · ${b.email} · role ${role.name}`), user: req.user });
    res.json({ id, ...(temp ? { temp_password: temp } : {}) }); // password sementara hanya ditampilkan sekali, tidak disimpan/di-log
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const id = +req.params.id, cur = await one(`${SEL} WHERE u.id=?`, [id]);
    if (!cur) throw httpError(404, 'User tidak ditemukan');
    const self = id === req.user.id, targetSuper = isSuperRow(cur);
    if (targetSuper && !actorIsSuper(req)) throw httpError(403, 'Hanya Super Admin yang boleh mengubah user Super Admin');
    const b = await body(req.body, { id, current: cur });
    const newRole = await one('SELECT name, is_system FROM roles WHERE id=?', [b.role_id]), toSuper = newRole.is_system && newRole.name === SUPER_ADMIN;
    if (toSuper && !targetSuper && !actorIsSuper(req)) throw httpError(403, 'Hanya Super Admin yang boleh memberi role Super Admin');
    if (self && b.role_id !== cur.role_id) throw httpError(400, 'Tidak bisa mengganti role akun sendiri');
    const active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    if (self && !active) throw httpError(400, 'Tidak bisa menonaktifkan akun sendiri');
    if (targetSuper && (b.role_id !== cur.role_id || !active) && !(await activeSupers(id))) throw httpError(400, 'Sistem harus punya minimal satu Super Admin aktif');
    if (b.pic_code !== (cur.pic_code || '')) {
      const used = await picUsage(cur); if (used) throw invalid('pic_code', `Kode PIC terkunci karena sudah dipakai di ${used} nomor tiket`);
    }
    const sets = ['username=?', 'name=?', 'email=?', 'employee_no=?', 'pic_code=?', 'role_id=?', 'is_active=?'], p = [b.username, b.name, b.email, b.employee_no, b.pic_code, b.role_id, active ? 1 : 0];
    if (b.password) { sets.push('password=?'); p.push(bcrypt.hashSync(b.password, 10)); }
    if (req.body.must_change_password !== undefined) { sets.push('must_change_password=?'); p.push(req.body.must_change_password ? 1 : 0); }
    try { await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=?`, [...p, id]); } catch (e) { dupToFields(e); }
    const diff = [];
    for (const [k, l] of [['name', 'nama'], ['username', 'username'], ['email', 'email'], ['employee_no', 'no. ID'], ['pic_code', 'kode PIC']]) if ((cur[k] || null) !== (b[k] || null)) diff.push(`${l}: ${cur[k] || '-'} → ${b[k] || '-'}`);
    if (b.role_id !== cur.role_id) diff.push(`role: ${cur.role_name || '-'} → ${newRole.name}`);
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    if (b.password) diff.push('password diganti');
    await audit.log(pool, { entity: 'user', id, action: 'Diubah', note: note(diff.join('; ') || 'tanpa perubahan'), user: req.user });
    res.json({ ok: true });
  }));

  const setActive = on => wrap(async (req, res) => {
    const id = +req.params.id, cur = await one(`${SEL} WHERE u.id=?`, [id]);
    if (!cur) throw httpError(404, 'User tidak ditemukan');
    if (!on) {
      if (id === req.user.id) throw httpError(400, 'Tidak bisa menonaktifkan akun sendiri');
      if (isSuperRow(cur) && !actorIsSuper(req)) throw httpError(403, 'Hanya Super Admin yang boleh menonaktifkan Super Admin');
      if (isSuperRow(cur) && !(await activeSupers(id))) throw httpError(400, 'Sistem harus punya minimal satu Super Admin aktif');
    }
    await pool.query('UPDATE users SET is_active=? WHERE id=?', [on ? 1 : 0, id]);
    await audit.log(pool, { entity: 'user', id, action: on ? 'Diaktifkan' : 'Dinonaktifkan', user: req.user });
    res.json({ ok: true });
  });
  r.post('/:id(\\d+)/deactivate', setActive(false));
  r.post('/:id(\\d+)/activate', setActive(true));

  r.delete('/:id(\\d+)', wrap(async (req, res) => {
    const id = +req.params.id, cur = await one(`${SEL} WHERE u.id=?`, [id]);
    if (!cur) throw httpError(404, 'User tidak ditemukan');
    if (id === req.user.id) throw httpError(400, 'Tidak bisa menghapus akun sendiri');
    if (isSuperRow(cur)) throw httpError(400, 'User Super Admin tidak bisa dihapus; nonaktifkan bila perlu');
    const tr = await traces(id);
    if (tr) throw httpError(400, `User sudah punya ${tr} jejak transaksi/audit, jadi tidak bisa dihapus permanen. Nonaktifkan saja.`);
    await pool.query('DELETE FROM users WHERE id=?', [id]);
    await audit.log(pool, { entity: 'user', id, action: 'Dihapus', note: note(`${cur.username} · ${cur.email}`), user: req.user });
    res.json({ ok: true });
  }));
  return r;
};
