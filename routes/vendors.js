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
    (SELECT COUNT(*) FROM delivery_notes d WHERE d.vendor_id=v.id) sj_count, (SELECT COUNT(*) FROM vendor_rates t WHERE t.vendor_id=v.id) rate_count FROM vendors v LEFT JOIN countries co ON co.id=v.country_id`;
  const shape = v => ({ ...v, is_active: !!v.is_active, needs_code_review: !!v.needs_code_review, sj_count: +v.sj_count, rate_count: +v.rate_count });

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
    res.json({ ...shape(v), rates: await rateRows(v.id) });
  }));

  r.post('/', wrap(async (req, res) => {
    const f = await fields(req.body), rates = req.body.rates === undefined ? [] : rateList(req.body.rates);
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
    if (rates.length) await saveRates(id, rates, req.user);
    res.json({ id, code });
  }));

  r.put('/:id(\\d+)', wrap(async (req, res) => {
    const cur = await one(`${SEL} WHERE v.id=?`, [req.params.id]); if (!cur) throw httpError(404, 'Vendor tidak ditemukan');
    if (req.body.code !== undefined && squash(req.body.code).toUpperCase() !== cur.code.toUpperCase()) throw invalid('code', 'Kode vendor tidak bisa diubah (tampil di surat jalan)');
    const f = await fields(req.body, cur.id), rates = req.body.rates === undefined ? null : rateList(req.body.rates), active = req.body.is_active === undefined ? !!cur.is_active : !!req.body.is_active;
    const review = req.body.needs_code_review === false || req.body.needs_code_review === 0 ? 0 : cur.needs_code_review;
    await pool.query('UPDATE vendors SET name=?, city=?, npwp=?, pic=?, country_id=?, is_active=?, needs_code_review=? WHERE id=?', [f.name, f.city, f.npwp, f.pic, f.country_id, active ? 1 : 0, review, cur.id]);
    const diff = [];
    for (const [k, l] of [['name', 'nama'], ['city', 'kota'], ['pic', 'PIC'], ['npwp', 'NPWP']]) if ((cur[k] || null) !== (f[k] || null)) diff.push(`${l}: ${cur[k] || '-'} → ${f[k] || '-'}`);
    if ((cur.country_id || null) !== f.country_id) diff.push('negara diubah');
    if (!!cur.is_active !== active) diff.push(active ? 'diaktifkan' : 'dinonaktifkan');
    if (cur.needs_code_review && !review) diff.push('kode ditandai sudah ditinjau');
    if (rates) await saveRates(cur.id, rates, req.user);
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

  // Tarif per kota tujuan: jarak kota + tonase + ritase. Disimpan di sini; perhitungan ada di menu PO nanti.
  const money = (v, field, label, min) => { const n = v === '' || v == null ? 0 : Number(v); if (!Number.isFinite(n) || n < min || n > 9999999999999) throw invalid(field, `${label} ${min ? 'harus lebih dari 0' : 'tidak boleh negatif'}`); return Math.round(n * 100) / 100; };
  function rateList(raw) {
    if (!Array.isArray(raw)) throw invalid('rates', 'Tarif harus berupa daftar');
    if (raw.length > 200) throw invalid('rates', 'Maksimal 200 kota per vendor');
    const seen = new Set();
    return raw.map((x, i) => {
      const city = squash(x.city), k = `rates.${i}.`;
      if (!city || city.length > 100) throw invalid(k + 'city', 'Kota wajib diisi (maks. 100 karakter)');
      if (seen.has(city.toLowerCase())) throw invalid(k + 'city', `Kota ${city} diisi dua kali`); seen.add(city.toLowerCase());
      return [city, money(x.price_city, k + 'price_city', 'Tarif jarak kota', 1), money(x.price_ton, k + 'price_ton', 'Tarif tonase', 0), money(x.price_trip, k + 'price_trip', 'Tarif ritase', 0)];
    });
  }
  const rateRows = async vid => (await q('SELECT city, price_city, price_ton, price_trip FROM vendor_rates WHERE vendor_id=? ORDER BY city', [vid])).map(x => ({ city: x.city, price_city: +x.price_city, price_ton: +x.price_ton, price_trip: +x.price_trip }));
  async function saveRates(vid, list, user) {
    const old = await rateRows(vid), cn = await pool.getConnection();
    try {
      await cn.beginTransaction(); await cn.query('DELETE FROM vendor_rates WHERE vendor_id=?', [vid]);
      if (list.length) await cn.query('INSERT INTO vendor_rates (vendor_id, city, price_city, price_ton, price_trip) VALUES ?', [list.map(l => [vid, ...l])]);
      await cn.commit();
    } catch (e) { await cn.rollback(); throw e; } finally { cn.release(); }
    const key = x => `${x.city}|${x.price_city}|${x.price_ton}|${x.price_trip}`, before = new Set(old.map(key)), after = list.map(l => ({ city: l[0], price_city: l[1], price_ton: l[2], price_trip: l[3] }));
    const diff = [...after.filter(x => !before.has(key(x))).map(x => `${x.city}: kota ${x.price_city}, ton ${x.price_ton}, ritase ${x.price_trip}`), ...old.filter(x => !after.some(y => key(y) === key(x))).map(x => `hapus/ubah ${x.city}`)];
    if (diff.length) await audit.log(pool, { entity: 'vendor', id: vid, action: 'Tarif diubah', note: note(diff.join('; ')), user });
  }
  return r;
};