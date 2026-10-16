// Job Order & Doc: daftar, form, detail, dokumen, checklist.
const express = require('express');
const rules = require('../lib/rules'), calc = require('../lib/calc'), fmt = require('../lib/format');
const numbering = require('../lib/numbering'), audit = require('../lib/audit'), files = require('../lib/files');
const excel = require('../lib/excel'), exportsLib = require('../lib/exports'), { validateJo, changedFields } = require('../lib/jo-validate');
const { wrap, bad, httpError, tx } = require('../lib/http');

const TYPES = rules.JO_TYPES.map(t => t.code);
const REF_KINDS = rules.REF_KINDS.map(k => k.code);
// "Belum lengkap" = ada isian wajib (rules.FIELD_RULES, tipe-nya) yang kosong. delivery_plan tidak dihitung: tidak ada di sistem lama dan diisi saat operasional.
function incompleteSql() {
  const types = f => Object.entries(rules.FIELD_RULES[f] || {}).filter(([, v]) => v === 'R').map(([t]) => `'${t}'`).join(',');
  const part = (f, cond) => (types(f) ? `(j.type IN (${types(f)}) AND (${cond}))` : null);
  const ref = k => part(k, `NOT EXISTS (SELECT 1 FROM jo_references x WHERE x.jo_id=j.id AND x.kind='${k}' AND x.number<>'')`);
  return [part('jenis_muatan', 'j.jenis_muatan IS NULL'), part('type_bc', 'j.type_bc IS NULL'), part('vessel', "j.vessel IS NULL OR j.vessel=''"), part('eta_etd', 'j.eta_etd IS NULL'),
    part('containers', 'j.container_count IS NULL OR j.container_count<=0 OR j.container_type IS NULL'), part('weight', 'j.weight_kg IS NULL'),
    part('qty', 'NOT ((j.qty IS NOT NULL AND j.unit IS NOT NULL) OR j.party_text IS NOT NULL)'), ...rules.REF_KINDS.map(x => ref(x.code))].filter(Boolean).join(' OR ') || '0';
}
const INCOMPLETE = incompleteSql();
const BASE = `SELECT j.*, c.name customer_name, c.code customer_code, s.name shipper_name, pl.name port_loading_name, pd.name port_dest_name, tp.name tps_name, (${INCOMPLETE}) incomplete
  FROM job_orders j JOIN customers c ON c.id=j.customer_id LEFT JOIN shippers s ON s.id=j.shipper_id LEFT JOIN ports pl ON pl.id=j.port_loading_id LEFT JOIN ports pd ON pd.id=j.port_dest_id LEFT JOIN tps_warehouses tp ON tp.id=j.tps_id`;
// tanggal acuan periode: ETA/ETD, dan bila kosong tanggal dibuat (WIB) — agar JO tanpa ETA tidak hilang dari daftar default
const PERIOD = '(COALESCE(j.eta_etd, DATE(j.created_at + INTERVAL 7 HOUR)))';
const nul = v => (v === '' || v === undefined ? null : v);
const numOrNull = (v, name) => { v = nul(v); if (v == null) return null; if (isNaN(v)) throw httpError(400, `${name} harus angka`); return Number(v); };

function failIfInvalid(b, opts) {
  const errs = validateJo(b, opts);
  if (errs.length) throw Object.assign(new Error(errs.map(e => e.message).join('; ')), { status: 400, fields: errs.map(e => e.field) });
}
// baris JO dari DB -> bentuk API
function shape(j) {
  const w = j.weight_kg == null ? null : Number(j.weight_kg);
  return { ...j, incomplete: !!j.incomplete, weight_kg: w, weight: w == null ? null : calc.kgToTon(w), party: fmt.partyLabel(j.qty, j.unit, j.party_text) };
}
async function loadRefs(pool, ids) {
  const map = new Map(ids.map(i => [i, []]));
  if (ids.length) for (const r of (await pool.query('SELECT id, jo_id, kind, number, ref_date, file_id FROM jo_references WHERE jo_id IN (?) ORDER BY sort, id', [ids]))[0]) map.get(r.jo_id).push(r);
  return map;
}
const refSummary = refs => Object.fromEntries(REF_KINDS.map(k => [k, refs.filter(r => r.kind === k).map(r => r.number)]));

// kolom JO dari body (validasi dasar; aturan wajib per tipe di tahap 4)
function fields(b, legacyCur = null) {
  const f = {
    type: b.type, type_bc: nul(b.type_bc), shipper_id: nul(b.shipper_id), nickname: nul(b.nickname), jenis_muatan: nul(b.jenis_muatan), cargo_desc: nul(b.cargo_desc),
    vessel: nul(b.vessel), eta_etd: nul(b.eta_etd), delivery_plan: nul(b.delivery_plan), container_count: numOrNull(b.container_count, 'Jumlah kontainer'),
    container_type: nul(b.container_type), cbm: numOrNull(b.cbm, 'CBM'), remarks: nul(b.remarks),
  };
  if (!TYPES.includes(f.type)) throw httpError(400, 'Tipe JO tidak valid');
  if (f.jenis_muatan && !rules.JENIS_MUATAN.some(x => x.code === f.jenis_muatan)) throw httpError(400, 'Jenis muatan tidak valid');
  // berat: input ton -> simpan kg (keputusan 7); boleh juga langsung weight_kg
  const kg = b.weight_kg != null && b.weight_kg !== '' ? numOrNull(b.weight_kg, 'Weight') : (nul(b.weight) == null ? null : calc.tonToKg(numOrNull(b.weight, 'Weight')));
  if (kg != null && kg < 0) throw httpError(400, 'Weight tidak boleh negatif');
  f.weight_kg = kg;
  // party: qty + satuan terstruktur; teks bebas ("300 CL", "12x40ft") di-parse
  if (nul(b.qty) != null || nul(b.unit) != null) { f.qty = numOrNull(b.qty, 'Quantity'); f.unit = nul(b.unit); f.party_text = null; }
  else { const p = fmt.parseParty(b.party); f.qty = p.qty; f.unit = p.unit; f.party_text = p.text; }
  if (f.unit && !rules.UNITS.some(u => u.code === f.unit) && !(legacyCur && legacyCur.unit === f.unit)) throw httpError(400, 'Satuan tidak valid');   // satuan data lama yang tidak diubah boleh tetap
  return f;
}

// sinkron baris referensi (cocokkan lewat id, bila tidak ada lewat kind+nomor agar file lama tetap menempel)
async function syncRefs(conn, joId, list, user) {
  const old = (await conn.query('SELECT * FROM jo_references WHERE jo_id=?', [joId]))[0], keep = new Set(), ids = [];
  let sort = 0;
  for (const x of list) {
    const kind = x.kind, number = String(x.number ?? '').trim();
    if (!number) continue;
    if (!REF_KINDS.includes(kind)) throw httpError(400, `Jenis referensi tidak valid: ${kind}`);
    const hit = old.find(o => !keep.has(o.id) && (x.id ? o.id === +x.id : o.kind === kind && o.number === number));
    if (hit) {
      keep.add(hit.id); ids.push(hit.id);
      await conn.query('UPDATE jo_references SET kind=?, number=?, ref_date=?, sort=?, updated_by=? WHERE id=?', [kind, number.slice(0, 80), nul(x.ref_date), sort++, user.id, hit.id]);
    } else {
      const [r] = await conn.query('INSERT INTO jo_references (jo_id, kind, number, ref_date, sort, created_by) VALUES (?,?,?,?,?,?)', [joId, kind, number.slice(0, 80), nul(x.ref_date), sort++, user.id]);
      keep.add(r.insertId); ids.push(r.insertId);
    }
  }
  const gone = old.filter(o => !keep.has(o.id));
  if (gone.length) {
    for (const g of gone) await unlinkRefFile(conn, g);
    await conn.query('DELETE FROM jo_references WHERE id IN (?)', [gone.map(g => g.id)]);
  }
  return ids; // id baris referensi, urut sesuai input (baris kosong dilewati) — dipakai form untuk mengunggah file
}
// lepas file referensi: hapus berkas dan baris Dokumen yang otomatis dibuat darinya
async function unlinkRefFile(conn, ref) {
  if (!ref.file_id) return;
  await conn.query('DELETE FROM jo_documents WHERE file_id=?', [ref.file_id]);
  await files.removeById(conn, ref.file_id);
  await conn.query('UPDATE jo_references SET file_id=NULL WHERE id=?', [ref.id]);
}
const REF_DOC = { INVOICE: 'INVOICE', BL: 'BL', SI_DO: 'SI_DO', SI_PO: 'SI_PO' }; // NOPEN & AJU tidak punya file

// checklist: {item: {inv, fp}}; catat siapa & kapan setiap centang berubah
async function syncChecklist(conn, joId, input, user) {
  const old = Object.fromEntries((await conn.query('SELECT * FROM jo_checklist WHERE jo_id=?', [joId]))[0].map(r => [r.item, r]));
  for (const it of rules.CHECKLIST_ITEMS) {
    const cur = old[it.code], inc = input?.[it.code];
    if (!cur) await conn.query('INSERT INTO jo_checklist (jo_id, item) VALUES (?,?)', [joId, it.code]);
    if (!inc) continue;
    const inv = inc.inv ? 1 : 0, fp = inc.fp ? 1 : 0;
    if (!cur || cur.inv !== inv) await conn.query('UPDATE jo_checklist SET inv=?, inv_by=?, inv_at=NOW() WHERE jo_id=? AND item=?', [inv, user.name, joId, it.code]);
    if (!cur || cur.fp !== fp) await conn.query('UPDATE jo_checklist SET fp=?, fp_by=?, fp_at=NOW() WHERE jo_id=? AND item=?', [fp, user.name, joId, it.code]);
  }
}
const checklistOf = async (pool, joId) => {
  const rows = Object.fromEntries((await pool.query('SELECT * FROM jo_checklist WHERE jo_id=?', [joId]))[0].map(r => [r.item, r]));
  return rules.CHECKLIST_ITEMS.map(it => ({ item: it.code, label: it.label, inv: rows[it.code]?.inv || 0, fp: rows[it.code]?.fp || 0, inv_by: rows[it.code]?.inv_by || null, inv_at: rows[it.code]?.inv_at || null, fp_by: rows[it.code]?.fp_by || null, fp_at: rows[it.code]?.fp_at || null }));
};

module.exports = pool => {
  const r = express.Router();

  function where(qs, { withType = true } = {}) {
    const { q = '', status = '', type = '', customer_id = '', from = '', to = '', origin = '', incomplete = '' } = qs, w = ['1=1'], p = [];
    if (origin === 'LEGACY' || origin === 'NEW') { w.push('j.origin=?'); p.push(origin); }
    if (incomplete === '1') w.push(`(${INCOMPLETE})`);
    if (q) {
      w.push(`(j.no_jo LIKE ? OR j.legacy_no LIKE ? OR j.nickname LIKE ? OR c.name LIKE ? OR j.vessel LIKE ? OR EXISTS (SELECT 1 FROM jo_references x WHERE x.jo_id=j.id AND x.number LIKE ?))`);
      p.push(...Array(6).fill(`%${q}%`));
    }
    if (status) { w.push('j.status=?'); p.push(status); }
    if (withType && type) { w.push('j.type=?'); p.push(type); }
    if (customer_id) { w.push('j.customer_id=?'); p.push(customer_id); }
    if (from) { w.push(`${PERIOD}>=?`); p.push(from); }
    if (to) { w.push(`${PERIOD}<=?`); p.push(to); }
    return [' WHERE ' + w.join(' AND '), p];
  }
  const SORT = { no_jo: 'j.no_jo', eta: 'j.eta_etd', delivery_plan: 'j.delivery_plan', customer: 'c.name', created: 'j.id' };
  const order = qs => `${SORT[qs.sort] || 'j.id'} ${qs.dir === 'asc' ? 'ASC' : 'DESC'}, j.id DESC`;
  const JOIN_C = 'FROM job_orders j JOIN customers c ON c.id=j.customer_id';

  r.get('/', wrap(async (req, res) => {
    const size = rules.LIMITS.PAGE_SIZE, page = Math.max(1, +req.query.page || 1);
    const [cond, p] = where(req.query), [condNoType, pn] = where(req.query, { withType: false });
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) n ${JOIN_C}${cond}`, p);
    const [rows] = await pool.query(`${BASE}${cond} ORDER BY ${order(req.query)} LIMIT ? OFFSET ?`, [...p, size, (page - 1) * size]);
    const [cnt] = await pool.query(`SELECT j.type, COUNT(*) n ${JOIN_C}${condNoType} GROUP BY j.type`, pn);
    const counts = Object.fromEntries(TYPES.map(t => [t, 0])); cnt.forEach(c => { counts[c.type] = c.n; });
    counts.ALL = cnt.reduce((s, c) => s + c.n, 0);
    const refs = await loadRefs(pool, rows.map(x => x.id));
    res.json({ rows: rows.map(x => ({ ...shape(x), references: refs.get(x.id), refs: refSummary(refs.get(x.id)) })), total: n, page, pages: Math.ceil(n / size), counts });
  }));

  r.get('/summary', wrap(async (req, res) => {
    const [[s]] = await pool.query(`SELECT COUNT(*) total, SUM(status='NOT_COMP') open_jo, SUM(status='COMPLETE') done,
      SUM(status='NOT_COMP' AND eta_etd BETWEEN CURDATE() AND CURDATE()+INTERVAL 7 DAY) eta_week,
      SUM(status='NOT_COMP' AND delivery_plan < CURDATE()) late FROM job_orders`);
    res.json(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v || 0])));
  }));

  // Excel: semua baris hasil filter (bukan hanya halaman yang tampil) + semua nomor referensi
  r.get('/export', wrap(async (req, res) => {
    const [cond, p] = where(req.query);
    const [rows] = await pool.query(`${BASE}${cond} ORDER BY ${order(req.query)}`, p);
    const refs = await loadRefs(pool, rows.map(x => x.id));
    await excel.send(res, `job-order-${new Date().toISOString().slice(0, 10)}.xlsx`, exportsLib.joSheets(rows.map(shape), refs));
  }));

  // peringatan (bukan blokir): nomor BL / aju / invoice ... sudah dipakai JO lain?
  r.get('/check-refs', wrap(async (req, res) => {
    const { kind, number, exclude = 0 } = req.query;
    if (!REF_KINDS.includes(kind) || !String(number || '').trim()) return res.json([]);
    const [rows] = await pool.query(`SELECT DISTINCT j.id, j.no_jo FROM jo_references x JOIN job_orders j ON j.id=x.jo_id WHERE x.kind=? AND x.number=? AND j.id<>? LIMIT 5`, [kind, String(number).trim(), +exclude]);
    res.json(rows);
  }));

  // file milik baris referensi (invoice/BL/SI) — otomatis muncul juga di tab Dokumen
  r.post('/:id/references/:refId/file', wrap(async (req, res) => {
    const id = +req.params.id, refId = +req.params.refId, { filename, data } = req.body;
    if (!filename || !data) return bad(res, 'File wajib diisi');
    await tx(pool, async conn => {
      const [[ref]] = await conn.query('SELECT * FROM jo_references WHERE id=? AND jo_id=? FOR UPDATE', [refId, id]);
      if (!ref) throw httpError(404, 'Referensi tidak ditemukan');
      await unlinkRefFile(conn, ref); // ganti file lama
      const fid = await files.create(conn, { ownerType: 'jo_reference', ownerId: refId, kind: ref.kind, filename, buffer: files.fromBase64(data), user: req.user });
      await conn.query('UPDATE jo_references SET file_id=?, updated_by=? WHERE id=?', [fid, req.user.id, refId]);
      if (REF_DOC[ref.kind]) await conn.query('INSERT INTO jo_documents (jo_id, doc_type, doc_no, file_id, created_by) VALUES (?,?,?,?,?)', [id, REF_DOC[ref.kind], ref.number, fid, req.user.id]);
      await audit.log(conn, { entity: 'job_order', id, action: 'Upload dokumen', note: `${ref.kind} ${ref.number}: ${filename}`, user: req.user });
    });
    res.json({ ok: true });
  }));
  r.delete('/:id/references/:refId/file', wrap(async (req, res) => {
    await tx(pool, async conn => {
      const [[ref]] = await conn.query('SELECT * FROM jo_references WHERE id=? AND jo_id=? FOR UPDATE', [req.params.refId, req.params.id]);
      if (ref) await unlinkRefFile(conn, ref);
    });
    res.json({ ok: true });
  }));

  // centang checklist satu per satu; catat siapa & kapan (hanya yang berubah)
  r.put('/:id/checklist', wrap(async (req, res) => {
    const id = +req.params.id, { item, inv, fp } = req.body;
    if (!rules.CHECKLIST_ITEMS.some(i => i.code === item)) return bad(res, 'Item checklist tidak valid');
    if (inv === undefined && fp === undefined) return bad(res, 'Tidak ada perubahan');
    await tx(pool, async conn => {
      const [[j]] = await conn.query('SELECT id FROM job_orders WHERE id=? FOR UPDATE', [id]);
      if (!j) throw httpError(404, 'JO tidak ditemukan');
      await conn.query('INSERT IGNORE INTO jo_checklist (jo_id, item) VALUES (?,?)', [id, item]);
      const [[cur]] = await conn.query('SELECT inv, fp FROM jo_checklist WHERE jo_id=? AND item=?', [id, item]);
      const label = rules.CHECKLIST_ITEMS.find(i => i.code === item).label, notes = [];
      for (const [field, val] of [['inv', inv], ['fp', fp]]) {
        if (val === undefined || (val ? 1 : 0) === cur[field]) continue;
        await conn.query(`UPDATE jo_checklist SET ${field}=?, ${field}_by=?, ${field}_at=NOW() WHERE jo_id=? AND item=?`, [val ? 1 : 0, req.user.name, id, item]);
        notes.push(`${label} ${field.toUpperCase()}: ${val ? 'dicentang' : 'dibatalkan'}`);
      }
      for (const n of notes) await audit.log(conn, { entity: 'job_order', id, action: 'Checklist', note: n, user: req.user });
    });
    res.json({ ok: true, checklist: await checklistOf(pool, id) });
  }));

  r.patch('/:id/remarks', wrap(async (req, res) => {
    const id = +req.params.id, remarks = nul(String(req.body.remarks ?? '').slice(0, 5000));
    const [r2] = await pool.query('UPDATE job_orders SET remarks=?, updated_by=? WHERE id=?', [remarks, req.user.id, id]);
    if (!r2.affectedRows) throw httpError(404, 'JO tidak ditemukan');
    await audit.log(pool, { entity: 'job_order', id, action: 'Remarks diubah', user: req.user });
    res.json({ ok: true });
  }));

  r.get('/:id', wrap(async (req, res) => {
    const [[jo]] = await pool.query(`${BASE} WHERE j.id=?`, [req.params.id]);
    if (!jo) return res.sendStatus(404);
    const out = shape(jo);
    out.references = (await loadRefs(pool, [jo.id])).get(jo.id); out.refs = refSummary(out.references);
    out.checklist = await checklistOf(pool, jo.id);
    out.documents = (await pool.query(`SELECT d.id, d.doc_type, d.doc_no, d.created_at, f.id file_id, f.filename, f.path, f.size, f.mime, u.name uploaded_by FROM jo_documents d JOIN files f ON f.id=d.file_id LEFT JOIN users u ON u.id=f.uploaded_by WHERE d.jo_id=? ORDER BY d.id`, [jo.id]))[0];
    out.logs = (await pool.query("SELECT user_name, action, note, created_at FROM audit_log WHERE entity_type='job_order' AND entity_id=? ORDER BY id DESC LIMIT 50", [jo.id]))[0];
    const [[m]] = await pool.query('SELECT COUNT(*) n, COALESCE(SUM(net_weight),0) net FROM jo_materials WHERE jo_id=?', [jo.id]);
    out.material_count = m.n; out.material_net_kg = Number(m.net);
    out.weight_mismatch = calc.weightMismatch(out.weight_kg, out.material_net_kg, rules.LIMITS.WEIGHT_MISMATCH_PCT);
    out.checklist_complete = out.checklist.every(c => c.inv && c.fp);
    res.json(out);
  }));

  r.post('/', wrap(async (req, res) => {
    const b = req.body;
    if (!b.customer_id) throw httpError(400, 'Customer wajib diisi');
    const f = fields(b);
    failIfInvalid(b);
    const out = await tx(pool, async conn => {
      const [[c]] = await conn.query('SELECT code, is_active FROM customers WHERE id=?', [b.customer_id]);
      if (!c) throw httpError(400, 'Customer tidak ditemukan');
      if (!c.is_active) throw httpError(400, 'Customer nonaktif tidak bisa dipakai untuk JO baru');
      const no_jo = await numbering.joNumber(conn, c.code);
      const cols = ['no_jo', 'customer_id', 'created_by', ...Object.keys(f)];
      const [ins] = await conn.query(`INSERT INTO job_orders (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [no_jo, b.customer_id, req.user.id, ...Object.values(f)]);
      const reference_ids = await syncRefs(conn, ins.insertId, b.references || [], req.user);
      await syncChecklist(conn, ins.insertId, b.checklist, req.user);
      await audit.log(conn, { entity: 'job_order', id: ins.insertId, action: 'Dibuat', user: req.user });
      return { id: ins.insertId, no_jo, reference_ids };
    });
    res.json(out);
  }));

  // duplikat: salin isian utama; referensi, tanggal dan checklist dikosongkan (seperti sebelumnya)
  r.post('/:id/duplicate', wrap(async (req, res) => {
    const [[o]] = await pool.query('SELECT * FROM job_orders WHERE id=?', [req.params.id]);
    if (!o) return res.sendStatus(404);
    const out = await tx(pool, async conn => {
      const [[c]] = await conn.query('SELECT code FROM customers WHERE id=?', [o.customer_id]);
      const no_jo = await numbering.joNumber(conn, c.code);
      const f = { type: o.type, type_bc: o.type_bc, shipper_id: o.shipper_id, nickname: o.nickname, jenis_muatan: o.jenis_muatan, cargo_desc: o.cargo_desc, vessel: o.vessel, container_type: o.container_type,
        weight_kg: o.weight_kg, qty: o.qty, unit: o.unit, party_text: o.party_text, cbm: o.cbm, remarks: o.remarks };
      const cols = ['no_jo', 'customer_id', 'created_by', ...Object.keys(f)];
      const [ins] = await conn.query(`INSERT INTO job_orders (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [no_jo, o.customer_id, req.user.id, ...Object.values(f)]);
      await syncChecklist(conn, ins.insertId, null, req.user);
      await audit.log(conn, { entity: 'job_order', id: ins.insertId, action: 'Dibuat', note: `Duplikat dari ${o.no_jo}`, user: req.user });
      return { id: ins.insertId, no_jo };
    });
    res.json(out);
  }));

  r.put('/:id', wrap(async (req, res) => {
    const b = req.body, id = +req.params.id;
    let reference_ids = [];
    await tx(pool, async conn => {
      const [[cur]] = await conn.query('SELECT * FROM job_orders WHERE id=? FOR UPDATE', [id]);
      if (!cur) throw httpError(404, 'JO tidak ditemukan');
      if (cur.status === 'COMPLETE') throw httpError(409, 'JO sudah Complete, tidak bisa diubah');
      const legacy = cur.origin === 'LEGACY', f = fields({ ...b, type: b.type || cur.type }, legacy ? cur : null);
      const curRefs = (await conn.query('SELECT kind, number FROM jo_references WHERE jo_id=?', [id]))[0], refsForCheck = b.references || curRefs;
      // data lama: kolom wajib yang tidak disentuh tidak divalidasi; kolom yang diubah divalidasi penuh. Data baru: tidak berubah
      if (legacy && f.type === cur.type) {
        if (f.weight_kg != null && cur.weight_kg != null && Math.abs(f.weight_kg - Number(cur.weight_kg)) <= 5) f.weight_kg = Number(cur.weight_kg);    // pembulatan ton di form tidak boleh mengubah berat lama
        failIfInvalid({ ...b, references: refsForCheck, type: f.type, customer_id: cur.customer_id }, { only: changedFields(f, cur, b.references, curRefs) });
      } else failIfInvalid({ ...b, references: refsForCheck, type: f.type, customer_id: cur.customer_id });
      if (f.type !== cur.type) {
        const [[m]] = await conn.query('SELECT COUNT(*) n FROM jo_materials WHERE jo_id=?', [id]);
        if (m.n) throw httpError(409, 'Tipe tidak bisa diubah setelah JO punya material');
      }
      const cols = Object.keys(f);
      await conn.query(`UPDATE job_orders SET ${cols.map(c => c + '=?').join(',')}, updated_by=? WHERE id=?`, [...Object.values(f), req.user.id, id]);
      if (b.references) reference_ids = await syncRefs(conn, id, b.references, req.user);
      if (b.checklist) await syncChecklist(conn, id, b.checklist, req.user);
      await audit.log(conn, { entity: 'job_order', id, action: 'Diedit', user: req.user });
    });
    res.json({ ok: true, reference_ids });
  }));

  r.patch('/:id/status', wrap(async (req, res) => {
    if (!['NOT_COMP', 'COMPLETE'].includes(req.body.status)) return bad(res, 'Status tidak valid');
    await pool.query('UPDATE job_orders SET status=?, updated_by=? WHERE id=?', [req.body.status, req.user.id, req.params.id]);
    await audit.log(pool, { entity: 'job_order', id: +req.params.id, action: req.body.status === 'COMPLETE' ? 'Ditandai Complete' : 'Dibuka kembali', user: req.user });
    res.json({ ok: true });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const id = +req.params.id;
    const [[t]] = await pool.query('SELECT COUNT(*) n FROM ticket_job_orders WHERE jo_id=?', [id]);
    if (t.n) throw httpError(409, 'JO sudah dipakai tiket Handling Ops, tidak bisa dihapus');
    await tx(pool, async conn => {
      const [[cur]] = await conn.query('SELECT status FROM job_orders WHERE id=? FOR UPDATE', [id]);
      if (!cur) return;
      if (cur.status === 'COMPLETE') throw httpError(409, 'JO sudah Complete, tidak bisa dihapus');
      const refIds = (await conn.query('SELECT id FROM jo_references WHERE jo_id=?', [id]))[0].map(x => x.id);
      const docIds = (await conn.query('SELECT id FROM jo_documents WHERE jo_id=?', [id]))[0].map(x => x.id);
      await files.removeByOwner(conn, 'jo_reference', refIds); await files.removeByOwner(conn, 'jo_document', docIds);
      await conn.query('DELETE FROM job_orders WHERE id=?', [id]);
      await conn.query("DELETE FROM audit_log WHERE entity_type='job_order' AND entity_id=?", [id]);
    });
    res.json({ ok: true });
  }));

  // dokumen: {filename, data(base64), doc_type, doc_no}
  r.post('/:id/documents', wrap(async (req, res) => {
    const { filename, data, doc_type = 'OTHERS', doc_no = null } = req.body, id = +req.params.id;
    if (!filename || !data) return bad(res, 'File wajib diisi');
    if (!rules.DOC_TYPES.some(d => d.code === doc_type)) return bad(res, 'Jenis dokumen tidak valid');
    const [[jo]] = await pool.query('SELECT id FROM job_orders WHERE id=?', [id]);
    if (!jo) throw httpError(404, 'JO tidak ditemukan');
    await tx(pool, async conn => {
      const [d] = await conn.query('INSERT INTO jo_documents (jo_id, doc_type, doc_no, file_id, created_by) VALUES (?,?,?,0,?)', [id, doc_type, nul(doc_no), req.user.id]);
      const fid = await files.create(conn, { ownerType: 'jo_document', ownerId: d.insertId, filename, buffer: files.fromBase64(data), user: req.user });
      await conn.query('UPDATE jo_documents SET file_id=? WHERE id=?', [fid, d.insertId]);
      await audit.log(conn, { entity: 'job_order', id, action: 'Upload dokumen', note: `${doc_type}: ${filename}`, user: req.user });
    });
    res.json({ ok: true });
  }));

  return r;
};

// dokumen: ganti file / hapus (router terpisah supaya path-nya /api/documents/:id)
module.exports.documentsRouter = pool => {
  const r = express.Router();
  // "Upload" di daftar dokumen = ganti file; baris dan nomor dokumen tetap
  r.put('/:id/file', wrap(async (req, res) => {
    const { filename, data } = req.body;
    if (!filename || !data) throw httpError(400, 'File wajib diisi');
    await tx(pool, async conn => {
      const [[d]] = await conn.query('SELECT d.id, d.jo_id, d.file_id, d.doc_type FROM jo_documents d WHERE d.id=? FOR UPDATE', [req.params.id]);
      if (!d) throw httpError(404, 'Dokumen tidak ditemukan');
      const [[old]] = await conn.query('SELECT owner_type, owner_id, kind FROM files WHERE id=?', [d.file_id]);
      const fid = await files.create(conn, { ownerType: old?.owner_type || 'jo_document', ownerId: old?.owner_id || d.id, kind: old?.kind || null, filename, buffer: files.fromBase64(data), user: req.user });
      await conn.query('UPDATE jo_documents SET file_id=?, updated_by=? WHERE id=?', [fid, req.user.id, d.id]);
      await conn.query('UPDATE jo_references SET file_id=? WHERE file_id=?', [fid, d.file_id]); // dokumen yang berasal dari form referensi ikut diganti
      await files.removeById(conn, d.file_id);
      await audit.log(conn, { entity: 'job_order', id: d.jo_id, action: 'Ganti file dokumen', note: filename, user: req.user });
    });
    res.json({ ok: true });
  }));
  r.delete('/:id', wrap(async (req, res) => {
    const [[d]] = await pool.query('SELECT d.id, d.jo_id, d.file_id, f.filename FROM jo_documents d JOIN files f ON f.id=d.file_id WHERE d.id=?', [req.params.id]);
    if (d) await tx(pool, async conn => {
      await conn.query('UPDATE jo_references SET file_id=NULL WHERE file_id=?', [d.file_id]); // file dari form referensi ikut terlepas
      await conn.query('DELETE FROM jo_documents WHERE id=?', [d.id]);
      await files.removeById(conn, d.file_id);
      await audit.log(conn, { entity: 'job_order', id: d.jo_id, action: 'Hapus dokumen', note: d.filename, user: req.user });
    });
    res.json({ ok: true });
  }));
  return r;
};
module.exports.helpers = { shape, loadRefs, refSummary };
