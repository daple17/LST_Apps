// COA: Account Code + Master General Ledger (kelompok). Akun tidak dihapus, hanya dinonaktifkan (tidak ada DELETE / izin coa.delete).
const express = require('express');
const { wrap, httpError } = require('../lib/http');
const audit = require('../lib/audit');
const excel = require('../lib/excel');
const C = require('../lib/coa');

const PAGE = 50;
const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const note = s => String(s).slice(0, 1000);
const JENIS_ORDER = `FIELD(h.jenis, ${C.JENIS_CODES.map(c => `'${c}'`).join(',')})`;

module.exports = pool => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const SEL = `SELECT a.id, a.code, a.name, a.header_id, a.is_active, a.updated_at, h.jenis, h.sub_header, h.group_account, h.is_active header_active
    FROM coa_accounts a JOIN coa_headers h ON h.id = a.header_id`;
  const shape = a => ({ id: a.id, code: a.code, name: a.name, header_id: a.header_id, jenis: a.jenis, jenis_label: C.jenisLabel(a.jenis), sub_header: a.sub_header, group_account: a.group_account,
    header_label: C.headerLabel(a), is_active: !!a.is_active, updated_at: a.updated_at });

  function where(qs) {
    const w = [], p = [], s = squash(qs.q);
    if (s) { if (/^\d+$/.test(s)) { w.push('(a.code LIKE ? OR a.name LIKE ?)'); p.push(`${s}%`, `%${s}%`); } else { w.push('a.name LIKE ?'); p.push(`%${s}%`); } }
    if (C.JENIS_CODES.includes(qs.jenis)) { w.push('h.jenis=?'); p.push(qs.jenis); }
    if (qs.sub_header) { w.push('h.sub_header=?'); p.push(String(qs.sub_header)); }
    if (qs.group) { w.push('h.group_account=?'); p.push(String(qs.group)); }
    if (qs.status === 'active') w.push('a.is_active=1'); else if (qs.status === 'inactive') w.push('a.is_active=0');
    return [w.length ? ' WHERE ' + w.join(' AND ') : '', p];
  }

  r.get('/', wrap(async (req, res) => {
    const [cond, p] = where(req.query), page = Math.max(1, +req.query.page || 1);
    const total = (await one(`SELECT COUNT(*) n FROM coa_accounts a JOIN coa_headers h ON h.id=a.header_id${cond}`, p)).n;
    const rows = await q(`${SEL}${cond} ORDER BY a.code LIMIT ? OFFSET ?`, [...p, PAGE, (page - 1) * PAGE]);
    const per = await q('SELECT h.jenis, COUNT(*) n FROM coa_accounts a JOIN coa_headers h ON h.id=a.header_id GROUP BY h.jenis');
    const sum = await one('SELECT COUNT(*) total, SUM(is_active=1) active, SUM(is_active=0) inactive FROM coa_accounts');
    res.json({ rows: rows.map(shape), total, page, pages: Math.max(1, Math.ceil(total / PAGE)),
      summary: { total: sum.total, active: +sum.active || 0, inactive: +sum.inactive || 0, per_jenis: Object.fromEntries(C.JENIS_CODES.map(c => [c, per.find(x => x.jenis === c)?.n || 0])) } });
  }));

  r.get('/export', wrap(async (req, res) => {
    const [cond, p] = where(req.query), rows = await q(`${SEL}${cond} ORDER BY a.code`, p);
    await excel.send(res, `coa-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Account Code', columns: [
      { header: 'Account Code', key: 'code', width: 14 }, { header: 'Account Name', key: 'name', width: 40 }, { header: 'Jenis Account', key: 'jenis', width: 16 },
      { header: 'Sub Header', key: 'sub', width: 28 }, { header: 'Group Account', key: 'group', width: 30 }, { header: 'Status', key: 'status', width: 12 }],
      rows: rows.map(a => ({ code: a.code, name: a.name, jenis: C.jenisLabel(a.jenis), sub: a.sub_header, group: a.group_account, status: a.is_active ? 'Aktif' : 'Nonaktif' })) }]);
  }));

  /* ---------- kelompok (Master General Ledger) ---------- */
  const HSEL = `SELECT h.id, h.jenis, h.sub_header, h.group_account, h.sort_order, h.is_active, COUNT(a.id) accounts, COALESCE(SUM(a.is_active=1),0) active_accounts
    FROM coa_headers h LEFT JOIN coa_accounts a ON a.header_id=h.id`;
  const hshape = h => ({ id: h.id, jenis: h.jenis, jenis_label: C.jenisLabel(h.jenis), has_group: C.hasGroup(h.jenis), sub_header: h.sub_header, group_account: h.group_account, label: C.headerLabel(h),
    sort_order: h.sort_order, is_active: !!h.is_active, accounts: +h.accounts, active_accounts: +h.active_accounts });
  r.get('/headers', wrap(async (req, res) => {
    const rows = await q(`${HSEL} GROUP BY h.id ORDER BY ${JENIS_ORDER}, h.sort_order, h.id`);
    res.json(rows.map(hshape));
  }));
  const dupHeader = async (jenis, sub, grp, exceptId = 0) => one('SELECT id FROM coa_headers WHERE jenis=? AND sub_header=? AND group_account=? AND id<>?', [jenis, sub, grp, exceptId]);
  function headerFields(b, cur = null) {
    const jenis = b.jenis ?? cur?.jenis;
    if (!C.JENIS_CODES.includes(jenis)) throw invalid('jenis', 'Jenis account tidak valid');
    if (cur && jenis !== cur.jenis) throw invalid('jenis', 'Jenis kelompok tidak bisa diubah');
    const sub_header = squash(b.sub_header ?? cur?.sub_header);
    if (!sub_header) throw invalid('sub_header', 'Sub Header wajib diisi');
    if (sub_header.length > C.HEADER_MAX) throw invalid('sub_header', `Sub Header maksimal ${C.HEADER_MAX} karakter`);
    let group_account = '';
    if (C.hasGroup(jenis)) {
      group_account = squash(b.group_account ?? cur?.group_account);
      if (!group_account) throw invalid('group_account', `Group Account wajib diisi untuk ${C.jenisLabel(jenis)}`);
      if (group_account.length > C.HEADER_MAX) throw invalid('group_account', `Group Account maksimal ${C.HEADER_MAX} karakter`);
    }                                                                                // neraca: group selalu kosong (nilai yang dikirim diabaikan)
    return { jenis, sub_header, group_account };
  }
  r.post('/headers', wrap(async (req, res) => {
    const h = headerFields(req.body);
    if (await dupHeader(h.jenis, h.sub_header, h.group_account)) throw invalid(h.group_account ? 'group_account' : 'sub_header', 'Kelompok ini sudah ada');
    const next = ((await one('SELECT COALESCE(MAX(sort_order),0) m FROM coa_headers WHERE jenis=?', [h.jenis])).m || 0) + 10;
    const [ins] = await pool.query('INSERT INTO coa_headers (jenis, sub_header, group_account, sort_order, created_by, updated_by) VALUES (?,?,?,?,?,?)', [h.jenis, h.sub_header, h.group_account, next, req.user.id, req.user.id]);
    await audit.log(pool, { entity: 'coa_group', id: ins.insertId, action: 'Dibuat', note: note(`${C.jenisLabel(h.jenis)} › ${C.headerLabel(h)}`), user: req.user });
    res.json({ id: ins.insertId });
  }));
  r.put('/headers/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${HSEL} WHERE h.id=? GROUP BY h.id`, [req.params.id]);
    if (!cur) throw httpError(404, 'Kelompok tidak ditemukan');
    const h = headerFields(req.body, cur), active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    if (!active && +cur.active_accounts > 0) throw invalid('is_active', `Kelompok masih berisi ${cur.active_accounts} akun aktif. Pindahkan atau nonaktifkan akunnya dulu.`);
    if (await dupHeader(h.jenis, h.sub_header, h.group_account, cur.id)) throw invalid(h.group_account ? 'group_account' : 'sub_header', 'Kelompok ini sudah ada');
    await pool.query('UPDATE coa_headers SET sub_header=?, group_account=?, is_active=?, updated_by=? WHERE id=?', [h.sub_header, h.group_account, active ? 1 : 0, req.user.id, cur.id]);
    const diff = [];
    if (h.sub_header !== cur.sub_header) diff.push(`Sub Header: ${cur.sub_header} → ${h.sub_header}`);
    if (h.group_account !== cur.group_account) diff.push(`Group Account: ${cur.group_account || '-'} → ${h.group_account || '-'}`);
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    await audit.log(pool, { entity: 'coa_group', id: cur.id, action: !!cur.is_active !== active ? (active ? 'Diaktifkan' : 'Dinonaktifkan') : 'Diubah', note: note(`${C.jenisLabel(cur.jenis)} › ${C.headerLabel(cur)}${diff.length ? '; ' + diff.join('; ') : ''}`), user: req.user });
    res.json({ ok: true });
  }));

  /* ---------- akun ---------- */
  async function accountFields(b, cur = null) {
    const name = C.cleanName(b.name ?? cur?.name);
    if (name.length < C.NAME_MIN || name.length > C.NAME_MAX) throw invalid('name', `Nama akun ${C.NAME_MIN}-${C.NAME_MAX} karakter`);
    const header_id = +(b.header_id ?? cur?.header_id) || 0, h = header_id && await one('SELECT id, jenis, is_active FROM coa_headers WHERE id=?', [header_id]);
    if (!h) throw invalid('header_id', 'Kelompok wajib dipilih');
    if (!h.is_active && (!cur || cur.header_id !== header_id)) throw invalid('header_id', 'Kelompok nonaktif tidak bisa dipakai');
    return { name, header_id };
  }
  const logAcc = (req, id, action, text) => audit.log(pool, { entity: 'coa', id, action, note: note(text), user: req.user });

  r.post('/', wrap(async (req, res) => {
    const code = String(req.body.code ?? '').trim();
    if (!C.CODE_RE.test(code)) throw invalid('code', 'Kode akun harus 5 angka (tidak diawali 0)');
    const f = await accountFields(req.body);
    if (await one('SELECT id FROM coa_accounts WHERE code=?', [code])) throw invalid('code', 'Kode akun sudah dipakai');
    let id;
    try { [{ insertId: id }] = await pool.query('INSERT INTO coa_accounts (code, name, header_id, created_by, updated_by) VALUES (?,?,?,?,?)', [+code, f.name, f.header_id, req.user.id, req.user.id]); }
    catch (e) { if (e.code === 'ER_DUP_ENTRY') throw invalid('code', 'Kode akun sudah dipakai'); throw e; }
    const h = await one('SELECT jenis, sub_header, group_account FROM coa_headers WHERE id=?', [f.header_id]);
    await logAcc(req, id, 'Dibuat', `${code} ${f.name}; ${C.jenisLabel(h.jenis)} › ${C.headerLabel(h)}`);
    res.json({ id });
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE a.id=?`, [req.params.id]);
    if (!cur) throw httpError(404, 'Akun tidak ditemukan');
    if (req.body.code !== undefined && String(req.body.code).trim() !== String(cur.code)) throw invalid('code', 'Kode akun tidak bisa diubah');
    const f = await accountFields(req.body, cur), active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    const target = await one('SELECT jenis, sub_header, group_account, is_active FROM coa_headers WHERE id=?', [f.header_id]);
    if (active && !target.is_active) throw invalid('is_active', 'Kelompok akun ini nonaktif. Aktifkan kelompoknya dulu.');
    await pool.query('UPDATE coa_accounts SET name=?, header_id=?, is_active=?, updated_by=? WHERE id=?', [f.name, f.header_id, active ? 1 : 0, req.user.id, cur.id]);
    const diff = [];
    if (f.name !== cur.name) diff.push(`nama: ${cur.name} → ${f.name}`);
    if (f.header_id !== cur.header_id) diff.push(`kelompok: ${C.jenisLabel(cur.jenis)} › ${C.headerLabel(cur)} → ${C.jenisLabel(target.jenis)} › ${C.headerLabel(target)}`);
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    await logAcc(req, cur.id, !!cur.is_active !== active ? (active ? 'Diaktifkan' : 'Dinonaktifkan') : 'Diubah', `${cur.code} ${cur.name}${diff.length ? '; ' + diff.join('; ') : ''}`);
    res.json({ ok: true });
  }));
  return r;
};
