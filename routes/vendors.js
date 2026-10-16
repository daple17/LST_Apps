// Data Master › Vendor. Kode dibuat otomatis (usulan 3 huruf dari nama) dan TIDAK bisa diubah (tampil di surat jalan). Vendor yang sudah dipakai surat jalan hanya dinonaktifkan.
const express = require('express');
const { wrap, httpError } = require('../lib/http');
const audit = require('../lib/audit');
const excel = require('../lib/excel');
const { suggestCode } = require('../lib/customer-code');

const PAGE = 20, MANUAL_CODE = /^[A-Z0-9 ]{2,10}$/;
const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const opt = (v, max, field, label) => { const s = squash(v); if (s.length > max) throw invalid(field, `${label} maksimal ${max} karakter`); return s || null; };
const note = s => String(s).slice(0, 1000);

module.exports = pool => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const SEL = `SELECT v.id, v.code, v.name, v.city, v.npwp, v.pic, v.country_id, co.name country_name, v.is_active, v.needs_code_review,
    (SELECT COUNT(*) FROM delivery_notes d WHERE d.vendor_id=v.id) sj_count FROM vendors v LEFT JOIN countries co ON co.id=v.country_id`;
  const shape = v => ({ ...v, is_active: !!v.is_active, needs_code_review: !!v.needs_code_review, sj_count: +v.sj_count });

  function where(qs) {
    const w = [], p = [], s = squash(qs.q);
    if (s) { w.push('(v.code LIKE ? OR v.name LIKE ? OR v.city LIKE ? OR v.pic LIKE ? OR v.npwp LIKE ? OR co.name LIKE ?)'); p.push(...Array(6).fill(`%${s}%`)); }
    if (qs.status === 'active') w.push('v.is_active=1'); else if (qs.status === 'inactive') w.push('v.is_active=0'); else if (qs.status === 'review') w.push('v.needs_code_review=1');
    return [w.length ? ' WHERE ' + w.join(' AND ') : '', p];
  }
  async function fields(b, id = 0) {
    const name = squash(b.name);
    if (name.length < 2 || name.length > 150) throw invalid('name', 'Nama vendor 2-150 karakter');
    if (await one('SELECT id FROM vendors WHERE name=? AND id<>?', [name, id])) throw invalid('name', 'Vendor dengan nama ini sudah ada');
    let country_id = b.country_id === '' || b.country_id == null ? null : +b.country_id;
    if (country_id != null && !(await one('SELECT id FROM countries WHERE id=?', [country_id]))) throw invalid('country_id', 'Negara tidak ditemukan');
    return { name, city: opt(b.city, 100, 'city', 'Kota'), npwp: opt(b.npwp, 30, 'npwp', 'NPWP'), pic: opt(b.pic, 80, 'pic', 'PIC'), country_id };
  }
  const takenCodes = async () => new Set((await q('SELECT code FROM vendors')).map(x => x.code.toUpperCase()));

  r.get('/', wrap(async (req, res) => {
    const [cond, p] = where(req.query), page = Math.max(1, +req.query.page || 1);
    const total = (await one(`SELECT COUNT(*) n FROM vendors v LEFT JOIN countries co ON co.id=v.country_id${cond}`, p)).n;
    const rows = await q(`${SEL}${cond} ORDER BY v.is_active DESC, v.name LIMIT ? OFFSET ?`, [...p, PAGE, (page - 1) * PAGE]);
    const sum = await one('SELECT COUNT(*) total, SUM(is_active=1) active, SUM(is_active=0) inactive, SUM(needs_code_review=1) review FROM vendors');
    res.json({ rows: rows.map(shape), total, page, pages: Math.max(1, Math.ceil(total / PAGE)), summary: { total: sum.total, active: +sum.active || 0, inactive: +sum.inactive || 0, review: +sum.review || 0 } });
  }));

  r.get('/export', wrap(async (req, res) => {
    const [cond, p] = where(req.query), rows = await q(`${SEL}${cond} ORDER BY v.name`, p);
    await excel.send(res, `vendor-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Vendor', columns: [
      { header: 'Kode', key: 'code', width: 10 }, { header: 'Nama', key: 'name', width: 44 }, { header: 'Kota', key: 'city', width: 20 }, { header: 'Negara', key: 'country', width: 18 },
      { header: 'PIC', key: 'pic', width: 22 }, { header: 'NPWP', key: 'npwp', width: 22 }, { header: 'Surat Jalan', key: 'sj', width: 12 }, { header: 'Status', key: 'status', width: 12 }],
      rows: rows.map(v => ({ code: v.code, name: v.name, city: v.city, country: v.country_name, pic: v.pic, npwp: v.npwp, sj: +v.sj_count, status: v.is_active ? 'Aktif' : 'Nonaktif' })) }]);
  }));

  r.get('/countries', wrap(async (req, res) => res.json(await q('SELECT id, name FROM countries ORDER BY name'))));
  r.get('/suggest-code', wrap(async (req, res) => res.json({ code: suggestCode(req.query.name, await takenCodes()) })));

  r.get('/:id(\\d+)', wrap(async (req, res) => {
    const v = await one(`${SEL} WHERE v.id=?`, [req.params.id]); if (!v) throw httpError(404, 'Vendor tidak ditemukan');
    res.json(shape(v));
  }));

  r.post('/', wrap(async (req, res) => {
    const f = await fields(req.body);
    let code = req.body.code ? squash(req.body.code).toUpperCase() : null;               // kode manual hanya untuk pemanggil lama; form baru selalu otomatis
    if (code && !MANUAL_CODE.test(code)) throw invalid('code', 'Kode vendor 2-10 huruf/angka');
    let id;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      const c = code || suggestCode(f.name, await takenCodes());
      try { [{ insertId: id }] = await pool.query('INSERT INTO vendors (code, name, city, npwp, pic, country_id) VALUES (?,?,?,?,?,?)', [c, f.name, f.city, f.npwp, f.pic, f.country_id]); code = c; }
      catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; if (req.body.code) throw invalid('code', 'Kode sudah dipakai'); code = null; }
    }
    if (!id) throw httpError(409, 'Gagal membuat kode vendor, coba lagi');
    await audit.log(pool, { entity: 'vendor', id, action: 'Dibuat', note: note(`${code} ${f.name}`), user: req.user });
    res.json({ id, code });
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE v.id=?`, [req.params.id]); if (!cur) throw httpError(404, 'Vendor tidak ditemukan');
    if (req.body.code !== undefined && squash(req.body.code).toUpperCase() !== cur.code.toUpperCase()) throw invalid('code', 'Kode vendor tidak bisa diubah (tampil di surat jalan)');
    const f = await fields(req.body, cur.id), active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    const review = req.body.needs_code_review === false || req.body.needs_code_review === 0 ? 0 : cur.needs_code_review;
    await pool.query('UPDATE vendors SET name=?, city=?, npwp=?, pic=?, country_id=?, is_active=?, needs_code_review=? WHERE id=?', [f.name, f.city, f.npwp, f.pic, f.country_id, active ? 1 : 0, review, cur.id]);
    const diff = [];
    for (const [k, l] of [['name', 'nama'], ['city', 'kota'], ['pic', 'PIC'], ['npwp', 'NPWP']]) if ((cur[k] || null) !== (f[k] || null)) diff.push(`${l}: ${cur[k] || '-'} → ${f[k] || '-'}`);
    if ((cur.country_id || null) !== f.country_id) diff.push('negara diubah');
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    if (cur.needs_code_review && !review) diff.push('kode ditandai sudah ditinjau');
    await audit.log(pool, { entity: 'vendor', id: cur.id, action: !!cur.is_active !== active ? (active ? 'Diaktifkan' : 'Dinonaktifkan') : 'Diubah', note: note(`${cur.code}${diff.length ? '; ' + diff.join('; ') : ''}`), user: req.user });
    res.json({ ok: true });
  }));

  const setActive = on => wrap(async (req, res) => {
    const cur = await one('SELECT id, code, is_active FROM vendors WHERE id=?', [req.params.id]); if (!cur) throw httpError(404, 'Vendor tidak ditemukan');
    await pool.query('UPDATE vendors SET is_active=? WHERE id=?', [on ? 1 : 0, cur.id]);
    if (!!cur.is_active !== on) await audit.log(pool, { entity: 'vendor', id: cur.id, action: on ? 'Diaktifkan' : 'Dinonaktifkan', note: cur.code, user: req.user });
    res.json({ ok: true });
  });
  r.post('/:id(\\d+)/deactivate', setActive(false));
  r.post('/:id(\\d+)/activate', setActive(true));

  r.delete('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE v.id=?`, [req.params.id]); if (!cur) throw httpError(404, 'Vendor tidak ditemukan');
    if (+cur.sj_count) throw httpError(400, `Vendor sudah dipakai ${cur.sj_count} surat jalan, jadi tidak bisa dihapus. Nonaktifkan saja.`);
    await pool.query('DELETE FROM vendors WHERE id=?', [cur.id]);
    await audit.log(pool, { entity: 'vendor', id: cur.id, action: 'Dihapus', note: `${cur.code} ${cur.name}`, user: req.user });
    res.json({ ok: true });
  }));
  return r;
};
