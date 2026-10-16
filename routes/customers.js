// Data Master › Customer. Kode dibuat otomatis (3 huruf) saat dibuat dan TIDAK bisa diubah (dipakai di nomor JO). Customer yang sudah dipakai JO hanya dinonaktifkan.
const express = require('express');
const { wrap, httpError } = require('../lib/http');
const audit = require('../lib/audit');
const excel = require('../lib/excel');
const { suggestCode, CODE_RE } = require('../lib/customer-code');

const PAGE = 20, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const opt = (v, max, field, label) => { const s = squash(v); if (s.length > max) throw invalid(field, `${label} maksimal ${max} karakter`); return s || null; };
const note = s => String(s).slice(0, 1000);

module.exports = pool => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const SEL = 'SELECT c.id, c.code, c.name, c.email, c.phone, c.address, c.city, c.tax_no, c.is_active, c.needs_code_review, c.legacy_code, (SELECT COUNT(*) FROM job_orders j WHERE j.customer_id=c.id) jo_count FROM customers c';
  const shape = c => ({ ...c, is_active: !!c.is_active, needs_code_review: !!c.needs_code_review, jo_count: +c.jo_count });

  function where(qs) {
    const w = [], p = [], s = squash(qs.q);
    if (s) { w.push('(c.code LIKE ? OR c.name LIKE ? OR c.city LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.tax_no LIKE ?)'); p.push(...Array(6).fill(`%${s}%`)); }
    if (qs.status === 'active') w.push('c.is_active=1'); else if (qs.status === 'inactive') w.push('c.is_active=0'); else if (qs.status === 'review') w.push('c.needs_code_review=1');
    return [w.length ? ' WHERE ' + w.join(' AND ') : '', p];
  }
  async function fields(b, id = 0) {
    const name = squash(b.name);
    if (name.length < 2 || name.length > 150) throw invalid('name', 'Nama customer 2-150 karakter');
    if (await one('SELECT id FROM customers WHERE name=? AND id<>?', [name, id])) throw invalid('name', 'Customer dengan nama ini sudah ada');
    const email = opt(b.email, 150, 'email', 'Email'); if (email && !EMAIL_RE.test(email)) throw invalid('email', 'Format email tidak valid');
    return { name, email: email && email.toLowerCase(), phone: opt(b.phone, 50, 'phone', 'Telepon'), address: opt(b.address, 255, 'address', 'Alamat'), city: opt(b.city, 100, 'city', 'Kota'), tax_no: opt(b.tax_no, 30, 'tax_no', 'NPWP') };
  }
  const takenCodes = async () => new Set((await q('SELECT code FROM customers')).map(x => x.code.toUpperCase()));

  r.get('/', wrap(async (req, res) => {
    const [cond, p] = where(req.query), page = Math.max(1, +req.query.page || 1);
    const total = (await one(`SELECT COUNT(*) n FROM customers c${cond}`, p)).n;
    const rows = await q(`${SEL}${cond} ORDER BY c.is_active DESC, c.name LIMIT ? OFFSET ?`, [...p, PAGE, (page - 1) * PAGE]);
    const sum = await one('SELECT COUNT(*) total, SUM(is_active=1) active, SUM(is_active=0) inactive, SUM(needs_code_review=1) review FROM customers');
    res.json({ rows: rows.map(shape), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), summary: { total: sum.total, active: +sum.active || 0, inactive: +sum.inactive || 0, review: +sum.review || 0 } });
  }));

  r.get('/export', wrap(async (req, res) => {
    const [cond, p] = where(req.query), rows = await q(`${SEL}${cond} ORDER BY c.name`, p);
    await excel.send(res, `customer-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Customer', columns: [
      { header: 'Kode', key: 'code', width: 10 }, { header: 'Nama', key: 'name', width: 44 }, { header: 'Kota', key: 'city', width: 20 }, { header: 'Telepon', key: 'phone', width: 18 },
      { header: 'Email', key: 'email', width: 30 }, { header: 'NPWP', key: 'tax', width: 22 }, { header: 'Alamat', key: 'address', width: 44 }, { header: 'Jumlah JO', key: 'jo', width: 11 }, { header: 'Status', key: 'status', width: 12 }],
      rows: rows.map(c => ({ code: c.code, name: c.name, city: c.city, phone: c.phone, email: c.email, tax: c.tax_no, address: c.address, jo: +c.jo_count, status: c.is_active ? 'Aktif' : 'Nonaktif' })) }]);
  }));

  // usulan kode untuk form (kode final ditetapkan server saat disimpan)
  r.get('/suggest-code', wrap(async (req, res) => res.json({ code: suggestCode(req.query.name, await takenCodes()) })));

  r.get('/:id(\\d+)', wrap(async (req, res) => {
    const c = await one(`${SEL} WHERE c.id=?`, [req.params.id]); if (!c) throw httpError(404, 'Customer tidak ditemukan');
    res.json(shape(c));
  }));

  r.post('/', wrap(async (req, res) => {
    const f = await fields(req.body);
    let code = req.body.code ? squash(req.body.code).toUpperCase() : null;                 // kode manual hanya untuk pemanggil lama; form baru selalu otomatis
    if (code && !CODE_RE.test(code)) throw invalid('code', 'Kode customer harus 3 huruf');
    let id;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      const c = code || suggestCode(f.name, await takenCodes());
      try { [{ insertId: id }] = await pool.query('INSERT INTO customers (code, name, email, phone, address, city, tax_no) VALUES (?,?,?,?,?,?,?)', [c, f.name, f.email, f.phone, f.address, f.city, f.tax_no]); code = c; }
      catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; if (req.body.code) throw invalid('code', 'Kode sudah dipakai'); code = null; }   // bentrok kode (dua pembuatan bersamaan): hitung ulang
    }
    if (!id) throw httpError(409, 'Gagal membuat kode customer, coba lagi');
    await audit.log(pool, { entity: 'customer', id, action: 'Dibuat', note: note(`${code} ${f.name}`), user: req.user });
    res.json({ id, code });
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE c.id=?`, [req.params.id]); if (!cur) throw httpError(404, 'Customer tidak ditemukan');
    if (req.body.code !== undefined && squash(req.body.code).toUpperCase() !== cur.code.toUpperCase()) throw invalid('code', 'Kode customer tidak bisa diubah (dipakai di nomor JO)');
    const f = await fields(req.body, cur.id), active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    const review = req.body.needs_code_review === false || req.body.needs_code_review === 0 ? 0 : cur.needs_code_review;            // hanya bisa ditandai "sudah ditinjau"
    await pool.query('UPDATE customers SET name=?, email=?, phone=?, address=?, city=?, tax_no=?, is_active=?, needs_code_review=? WHERE id=?', [f.name, f.email, f.phone, f.address, f.city, f.tax_no, active ? 1 : 0, review, cur.id]);
    const diff = [];
    for (const [k, l] of [['name', 'nama'], ['email', 'email'], ['phone', 'telepon'], ['address', 'alamat'], ['city', 'kota'], ['tax_no', 'NPWP']]) if ((cur[k] || null) !== (f[k] || null)) diff.push(`${l}: ${cur[k] || '-'} → ${f[k] || '-'}`);
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    if (cur.needs_code_review && !review) diff.push('kode ditandai sudah ditinjau');
    await audit.log(pool, { entity: 'customer', id: cur.id, action: !!cur.is_active !== active ? (active ? 'Diaktifkan' : 'Dinonaktifkan') : 'Diubah', note: note(`${cur.code}${diff.length ? '; ' + diff.join('; ') : ''}`), user: req.user });
    res.json({ ok: true });
  }));

  const setActive = on => wrap(async (req, res) => {
    const cur = await one('SELECT id, code, is_active FROM customers WHERE id=?', [req.params.id]); if (!cur) throw httpError(404, 'Customer tidak ditemukan');
    await pool.query('UPDATE customers SET is_active=? WHERE id=?', [on ? 1 : 0, cur.id]);
    if (!!cur.is_active !== on) await audit.log(pool, { entity: 'customer', id: cur.id, action: on ? 'Diaktifkan' : 'Dinonaktifkan', note: cur.code, user: req.user });
    res.json({ ok: true });
  });
  r.post('/:id(\\d+)/deactivate', setActive(false));
  r.post('/:id(\\d+)/activate', setActive(true));

  r.delete('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE c.id=?`, [req.params.id]); if (!cur) throw httpError(404, 'Customer tidak ditemukan');
    if (+cur.jo_count) throw httpError(400, `Customer sudah dipakai ${cur.jo_count} Job Order, jadi tidak bisa dihapus. Nonaktifkan saja.`);
    await pool.query('DELETE FROM customers WHERE id=?', [cur.id]);
    await audit.log(pool, { entity: 'customer', id: cur.id, action: 'Dihapus', note: `${cur.code} ${cur.name}`, user: req.user });
    res.json({ ok: true });
  }));
  return r;
};
