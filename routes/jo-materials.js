// Material di level JO: daftar, Add data, template, Upload List (pratinjau lalu simpan).
const express = require('express');
const rules = require('../lib/rules'), audit = require('../lib/audit'), excel = require('../lib/excel'), exportsLib = require('../lib/exports');
const mv = require('../lib/material-validate'), { parseWorkbook } = require('../lib/material-import'), files = require('../lib/files');
const { wrap, httpError, tx } = require('../lib/http');

const COLS = ['product_no', 'kondisi', 'spec', 'description', 'thickness', 'width', 'shape', 'net_weight', 'gross_weight', 'qty', 'unit', 'origin', 'destination'];

module.exports = (pool, { refreshTickets = async () => {} } = {}) => {
  const r = express.Router();

  async function jo(conn, id, { editable = false } = {}) {
    const [[j]] = await conn.query('SELECT id, no_jo, status FROM job_orders WHERE id=?', [id]);
    if (!j) throw httpError(404, 'JO tidak ditemukan');
    if (editable && j.status === 'COMPLETE') throw httpError(409, 'JO sudah Complete, material tidak bisa diubah');
    return j;
  }
  const existingNos = async (conn, id, exceptId = 0) => new Set((await conn.query('SELECT product_no FROM jo_materials WHERE jo_id=? AND id<>?', [id, exceptId]))[0].map(x => x.product_no.toLowerCase()));
  const insertRow = (conn, id, m, user) => conn.query(`INSERT INTO jo_materials (jo_id, ${COLS.join(',')}, bl_no, created_by) VALUES (?${',?'.repeat(COLS.length)}, ?, ?)`,
    [id, ...COLS.map(c => m[c] ?? null), m.bl_no ?? null, user.id]);

  r.get('/:id/materials', wrap(async (req, res) => {
    const id = +req.params.id, size = rules.LIMITS.PAGE_SIZE, page = Math.max(1, +req.query.page || 1), w = ['m.jo_id=?'], p = [id];
    await jo(pool, id);
    if (req.query.q) { w.push('(m.product_no LIKE ? OR m.description LIKE ? OR m.destination LIKE ?)'); p.push(...Array(3).fill(`%${req.query.q}%`)); }
    const cond = ' WHERE ' + w.join(' AND ');
    const [[t]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(m.net_weight),0) net, COALESCE(SUM(m.gross_weight),0) gross, COALESCE(SUM(m.qty),0) qty FROM jo_materials m${cond}`, p);
    const [rows] = await pool.query(`SELECT m.*, (SELECT COUNT(*) FROM delivery_note_items i WHERE i.material_id=m.id) in_sj FROM jo_materials m${cond} ORDER BY m.id LIMIT ? OFFSET ?`, [...p, size, (page - 1) * size]);
    res.json({ rows, total: t.n, page, pages: Math.ceil(t.n / size), offset: (page - 1) * size, totals: { net: +t.net, gross: +t.gross, qty: +t.qty } });
  }));

  r.get('/:id/materials/:mid(\\d+)', wrap(async (req, res) => {
    const [[m]] = await pool.query('SELECT * FROM jo_materials WHERE id=? AND jo_id=?', [req.params.mid, req.params.id]);
    return m ? res.json(m) : res.sendStatus(404);
  }));

  r.get('/:id/materials/template', wrap(async (req, res) => {
    await jo(pool, +req.params.id);
    await excel.send(res, 'template-material.xlsx', exportsLib.materialTemplateSheets());
  }));

  r.post('/:id/materials', wrap(async (req, res) => {
    const id = +req.params.id, m = mv.normalize(req.body), v = mv.validate(m);
    if (v.errors.length) throw httpError(400, v.errors.join('; '));
    const out = await tx(pool, async conn => {
      const j = await jo(conn, id, { editable: true });
      if ((await existingNos(conn, id)).has(m.product_no.toLowerCase())) throw httpError(400, 'Nomor produk sudah ada di JO ini');
      const [ins] = await insertRow(conn, id, m, req.user);
      await audit.log(conn, { entity: 'job_order', id, action: 'Material ditambah', note: m.product_no, user: req.user });
      return { id: ins.insertId, warnings: v.warnings, no_jo: j.no_jo };
    });
    await refreshTickets(id);
    res.json(out);
  }));

  r.put('/:id/materials/:mid', wrap(async (req, res) => {
    const id = +req.params.id, mid = +req.params.mid, m = mv.normalize(req.body), v = mv.validate(m);
    if (v.errors.length) throw httpError(400, v.errors.join('; '));
    await tx(pool, async conn => {
      await jo(conn, id, { editable: true });
      const [[cur]] = await conn.query('SELECT id FROM jo_materials WHERE id=? AND jo_id=? FOR UPDATE', [mid, id]);
      if (!cur) throw httpError(404, 'Material tidak ditemukan');
      if ((await existingNos(conn, id, mid)).has(m.product_no.toLowerCase())) throw httpError(400, 'Nomor produk sudah ada di JO ini');
      await conn.query(`UPDATE jo_materials SET ${COLS.map(c => c + '=?').join(',')}, updated_by=? WHERE id=?`, [...COLS.map(c => m[c] ?? null), req.user.id, mid]);
      await audit.log(conn, { entity: 'job_order', id, action: 'Material diubah', note: m.product_no, user: req.user });
    });
    await refreshTickets(id);
    res.json({ ok: true, warnings: v.warnings });
  }));

  r.delete('/:id/materials/:mid', wrap(async (req, res) => {
    const id = +req.params.id, mid = +req.params.mid;
    await tx(pool, async conn => {
      await jo(conn, id, { editable: true });
      const [[m]] = await conn.query('SELECT product_no FROM jo_materials WHERE id=? AND jo_id=?', [mid, id]);
      if (!m) return;
      const [[s]] = await conn.query('SELECT COUNT(*) n FROM delivery_note_items WHERE material_id=?', [mid]);
      if (s.n) throw httpError(409, 'Material sudah masuk Surat Jalan, tidak bisa dihapus');
      await files.removeByOwner(conn, 'material_report', (await conn.query('SELECT id FROM material_reports WHERE material_id=?', [mid]))[0].map(x => x.id));
      await conn.query('DELETE FROM jo_materials WHERE id=?', [mid]);
      await audit.log(conn, { entity: 'job_order', id, action: 'Material dihapus', note: m.product_no, user: req.user });
    });
    await refreshTickets(id);
    res.json({ ok: true });
  }));

  // Upload List langkah 1: baca file, kembalikan pratinjau (belum menyimpan apa pun)
  r.post('/:id/materials/import/preview', wrap(async (req, res) => {
    const id = +req.params.id;
    await jo(pool, id);
    if (!req.body.data) throw httpError(400, 'File wajib diisi');
    const buf = files.fromBase64(req.body.data);
    if (buf.length > rules.LIMITS.FILE_MAX_MB * 1048576) throw httpError(400, `Ukuran file maks ${rules.LIMITS.FILE_MAX_MB} MB`);
    const parsed = await parseWorkbook(buf);
    const items = parsed.map(p => { const data = mv.normalize(p.raw), v = mv.validate(data); return { n: p.n, data, errors: v.errors, warnings: v.warnings }; });
    mv.markDuplicates(items, await existingNos(pool, id));
    const bad = items.filter(i => i.errors.length).length;
    res.json({ items, summary: { total: items.length, ok: items.length - bad, error: bad } });
  }));

  // Upload List langkah 2: simpan. Setiap baris diperiksa ulang di server; skip_invalid=true -> hanya baris valid
  r.post('/:id/materials/import', wrap(async (req, res) => {
    const id = +req.params.id, input = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!input.length) throw httpError(400, 'Tidak ada baris untuk disimpan');
    const out = await tx(pool, async conn => {
      await jo(conn, id, { editable: true });
      const items = input.map((raw, i) => { const data = mv.normalize(raw), v = mv.validate(data); return { n: raw._n ?? i + 1, data, errors: v.errors, warnings: v.warnings }; });
      mv.markDuplicates(items, await existingNos(conn, id));
      const bad = items.filter(i => i.errors.length);
      if (bad.length && !req.body.skip_invalid) throw httpError(400, `${bad.length} baris bermasalah (baris ${bad.slice(0, 5).map(b => b.n).join(', ')}${bad.length > 5 ? ', …' : ''}). Perbaiki atau pilih "simpan baris valid saja".`);
      const good = items.filter(i => !i.errors.length);
      for (const it of good) await insertRow(conn, id, it.data, req.user);
      await audit.log(conn, { entity: 'job_order', id, action: 'Upload List material', note: `${good.length} baris${bad.length ? `, ${bad.length} dilewati` : ''}`, user: req.user });
      return { imported: good.length, skipped: bad.length };
    });
    await refreshTickets(id);
    res.json(out);
  }));

  return r;
};
