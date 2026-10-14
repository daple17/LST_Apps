// Handling Ops: tiket, Report Material, Trucking Delivery (surat jalan).
const express = require('express');
const rules = require('../lib/rules'), calc = require('../lib/calc'), fmt = require('../lib/format');
const numbering = require('../lib/numbering'), audit = require('../lib/audit'), files = require('../lib/files');
const { wrap, bad, httpError, tx } = require('../lib/http');
const { helpers } = require('./job-orders');

const nul = v => (v === '' || v === undefined ? null : v);
const num = v => (v === '' || v == null || isNaN(v) ? 0 : +v);
const uniq = a => [...new Set(a.filter(Boolean))];
const MAT_COLS = ['jo_id', 'product_no', 'description', 'spec', 'thickness', 'width', 'shape', 'kondisi', 'bl_no', 'net_weight', 'gross_weight', 'qty', 'unit', 'origin', 'destination'];
const NUM_COLS = ['net_weight', 'gross_weight'];
const WIB = 'INTERVAL 7 HOUR'; // tanggal filter menurut WIB (rules.TZ)

module.exports = pool => {
  const r = express.Router();
  const refStr = kind => `(SELECT GROUP_CONCAT(x.number ORDER BY x.sort, x.id SEPARATOR ', ') FROM jo_references x WHERE x.jo_id=j.id AND x.kind='${kind}')`;
  const ticketMaterials = 'FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id';

  /* ---------- tiket: ringkasan + progres ---------- */
  const TK = `SELECT t.id, t.ticket_no, t.created_at, t.done_at, t.pic_id, u.name pic_name,
    (SELECT COUNT(*) ${ticketMaterials} WHERE tj.ticket_id=t.id) mat_total,
    (SELECT COUNT(*) FROM material_reports r WHERE r.ticket_id=t.id AND r.status<>'NOT_CHECKED') mat_checked,
    (SELECT COALESCE(SUM(m.qty),0) ${ticketMaterials} WHERE tj.ticket_id=t.id) qty_total,
    (SELECT COALESCE(SUM(i.qty),0) FROM delivery_note_items i JOIN delivery_notes d ON d.id=i.dn_id WHERE d.ticket_id=t.id) qty_sent,
    (SELECT COALESCE(SUM(j.weight_kg),0) FROM ticket_job_orders tj JOIN job_orders j ON j.id=tj.jo_id WHERE tj.ticket_id=t.id) weight_kg
    FROM handling_tickets t JOIN users u ON u.id=t.pic_id`;

  async function jos(ticketIds) {
    ticketIds = ticketIds.map(Number);
    const map = new Map(ticketIds.map(i => [i, []]));
    if (!ticketIds.length) return map;
    const [rows] = await pool.query(`SELECT tj.ticket_id, j.id, j.no_jo, j.type, j.qty, j.unit, j.party_text, j.weight_kg, j.vessel, j.status, c.name customer_name,
      ${refStr('BL')} bl_no, ${refStr('INVOICE')} invoice_no, ${refStr('AJU')} aju_no,
      (SELECT COUNT(*) FROM jo_materials mm WHERE mm.jo_id=j.id) mat_count
      FROM ticket_job_orders tj JOIN job_orders j ON j.id=tj.jo_id JOIN customers c ON c.id=j.customer_id WHERE tj.ticket_id IN (?) ORDER BY j.id`, [ticketIds]);
    rows.forEach(x => map.get(x.ticket_id).push({ ...x, party: fmt.partyLabel(x.qty, x.unit, x.party_text), weight: calc.kgToTon(x.weight_kg) }));
    return map;
  }
  const withProgress = (t, joList, now = Date.now()) => {
    const mat_pct = calc.reportPct(t.mat_checked, t.mat_total), del_pct = calc.deliveryPct(+t.qty_sent, +t.qty_total);
    const customers = uniq(joList.map(j => j.customer_name)), vessels = uniq(joList.map(j => j.vessel));
    return { ...t, qty_total: +t.qty_total, qty_sent: +t.qty_sent, weight_kg: +t.weight_kg, weight: calc.kgToTon(t.weight_kg),
      mat_pct, del_pct, prog: calc.ticketProgress(mat_pct, del_pct, rules.PROGRESS_RULE), dwell_min: calc.dwellMinutes(t.created_at, t.done_at, now),
      customers, vessels, customer: customers.join(', '), vessel: vessels.join(', '), party: joList.map(j => j.party).filter(Boolean).join(', '), jo_numbers: joList.map(j => j.no_jo) };
  };
  async function ticketRow(id) {
    id = Number(id);
    const [[t]] = await pool.query(`${TK} WHERE t.id=?`, [id]);
    if (!t) return null;
    const js = (await jos([id])).get(id);
    return { ...withProgress(t, js), jos: js };
  }
  // dipanggil setiap material/surat jalan berubah: catat kapan tiket mencapai 100% (untuk dwelling time)
  async function refresh(ticketId) {
    const t = await ticketRow(ticketId);
    if (!t) return;
    await pool.query(t.prog >= 100 ? 'UPDATE handling_tickets SET done_at=COALESCE(done_at,NOW()) WHERE id=?' : 'UPDATE handling_tickets SET done_at=NULL WHERE id=?', [ticketId]);
  }

  async function ticketList(qs) {
    const w = ['1=1'], p = [];
    if (qs.q) {
      w.push(`(t.ticket_no LIKE ? OR u.name LIKE ? OR EXISTS (SELECT 1 FROM ticket_job_orders tj JOIN job_orders j ON j.id=tj.jo_id JOIN customers c ON c.id=j.customer_id
        WHERE tj.ticket_id=t.id AND (c.name LIKE ? OR j.vessel LIKE ? OR j.no_jo LIKE ?)))`);
      p.push(...Array(5).fill(`%${qs.q}%`));
    }
    if (qs.from) { w.push(`DATE(t.created_at + ${WIB})>=?`); p.push(qs.from); }
    if (qs.to) { w.push(`DATE(t.created_at + ${WIB})<=?`); p.push(qs.to); }
    const [rows] = await pool.query(`${TK} WHERE ${w.join(' AND ')} ORDER BY t.id DESC`, p);
    const js = await jos(rows.map(x => x.id)), now = Date.now();
    return rows.map(t => withProgress(t, js.get(t.id), now));
  }

  r.get('/tickets', wrap(async (req, res) => {
    const all = await ticketList(req.query), size = rules.LIMITS.PAGE_SIZE, page = Math.max(1, +req.query.page || 1);
    const counts = { all: all.length, done: 0, mid: 0, low: 0 };
    all.forEach(t => { counts[calc.progressBucket(t.prog)]++; });
    const list = req.query.progress ? all.filter(t => calc.progressBucket(t.prog) === req.query.progress) : all;
    res.json({ rows: list.slice((page - 1) * size, page * size), total: list.length, counts, page, pages: Math.ceil(list.length / size) });
  }));

  r.get('/tickets/export', wrap(async (req, res) => {
    let list = await ticketList(req.query);
    if (req.query.progress) list = list.filter(t => calc.progressBucket(t.prog) === req.query.progress);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Ticket', 'PIC', 'Customer', 'Vessel', 'Party', 'Weight (ton)', 'Dwelling time', 'Report Material %', 'Trucking Delivery %', 'Dibuat'];
    res.type('text/csv').send('﻿' + [head, ...list.map(t => [t.ticket_no, t.pic_name, t.customer, t.vessel, t.party, t.weight, calc.formatDwell(t.dwell_min), t.mat_pct, t.del_pct, t.created_at])].map(l => l.map(cell).join(',')).join('\r\n'));
  }));

  // JO yang boleh dipilih: belum Complete dan tidak sedang ada di tiket aktif lain (keputusan 9)
  r.get('/browse-jo', wrap(async (req, res) => {
    const q = `%${req.query.q || ''}%`, ex = +req.query.ticket || 0;
    const [rows] = await pool.query(`SELECT j.id, j.no_jo, j.type, c.name customer_name, j.qty, j.unit, j.party_text, j.weight_kg, j.vessel, j.status, ${refStr('BL')} bl_no, ${refStr('INVOICE')} invoice_no, ${refStr('AJU')} aju_no
      FROM job_orders j JOIN customers c ON c.id=j.customer_id
      WHERE j.status='NOT_COMP'
        AND (EXISTS (SELECT 1 FROM ticket_job_orders z WHERE z.jo_id=j.id AND z.ticket_id=?) OR NOT EXISTS (SELECT 1 FROM ticket_job_orders z JOIN handling_tickets zt ON zt.id=z.ticket_id WHERE z.jo_id=j.id AND zt.done_at IS NULL))
        AND (j.no_jo LIKE ? OR c.name LIKE ? OR j.vessel LIKE ? OR EXISTS (SELECT 1 FROM jo_references x WHERE x.jo_id=j.id AND x.number LIKE ?))
      ORDER BY j.id DESC LIMIT 40`, [ex, q, q, q, q]);
    res.json(rows.map(x => ({ ...x, party: fmt.partyLabel(x.qty, x.unit, x.party_text), weight: calc.kgToTon(x.weight_kg) })));
  }));

  r.get('/tickets/:id', wrap(async (req, res) => {
    const t = await ticketRow(req.params.id);
    if (!t) return res.sendStatus(404);
    const [[u]] = await pool.query('SELECT employee_no FROM users WHERE id=?', [t.pic_id]); t.employee_no = u?.employee_no;
    const [[s]] = await pool.query(`SELECT COALESCE(SUM(m.net_weight),0) net, COALESCE(SUM(m.gross_weight),0) gross, COALESCE(SUM(m.qty),0) qty ${ticketMaterials} WHERE tj.ticket_id=?`, [t.id]);
    t.totals = { net: +s.net, gross: +s.gross, qty: +s.qty };
    t.sj_count = (await pool.query('SELECT COUNT(*) n FROM delivery_notes WHERE ticket_id=?', [t.id]))[0][0].n;
    res.json(t);
  }));

  // set daftar JO tiket. Aturan: JO hanya di satu tiket AKTIF; JO yang sudah punya pemeriksaan/pengiriman tidak bisa dilepas
  async function setJos(conn, tid, ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))];
    if (!ids.length) throw httpError(400, 'Pilih minimal 1 Job Order');
    const [found] = await conn.query('SELECT id, no_jo, status FROM job_orders WHERE id IN (?)', [ids]);
    if (found.length !== ids.length) throw httpError(400, 'Ada Job Order yang tidak ditemukan');
    const [old] = await conn.query('SELECT jo_id FROM ticket_job_orders WHERE ticket_id=?', [tid]);
    const have = old.map(o => o.jo_id), add = ids.filter(i => !have.includes(i)), removed = have.filter(i => !ids.includes(i));
    for (const j of found.filter(x => add.includes(x.id))) {
      if (j.status === 'COMPLETE') throw httpError(400, `JO ${j.no_jo} sudah Complete`);
      const [[act]] = await conn.query('SELECT t.ticket_no FROM ticket_job_orders z JOIN handling_tickets t ON t.id=z.ticket_id WHERE z.jo_id=? AND t.done_at IS NULL AND t.id<>? LIMIT 1', [j.id, tid]);
      if (act) throw httpError(400, `JO ${j.no_jo} sudah ada di tiket aktif ${act.ticket_no}`);
    }
    if (removed.length) {
      const [[u]] = await conn.query(`SELECT COUNT(*) n FROM jo_materials m WHERE m.jo_id IN (?) AND (
        EXISTS (SELECT 1 FROM material_reports rr WHERE rr.material_id=m.id AND rr.ticket_id=? AND rr.status<>'NOT_CHECKED')
        OR EXISTS (SELECT 1 FROM delivery_note_items i JOIN delivery_notes d ON d.id=i.dn_id WHERE i.material_id=m.id AND d.ticket_id=?))`, [removed, tid, tid]);
      if (u.n) throw httpError(400, 'JO yang materialnya sudah diperiksa/dikirim tidak bisa dilepas dari tiket');
      await conn.query('DELETE FROM ticket_job_orders WHERE ticket_id=? AND jo_id IN (?)', [tid, removed]);
    }
    if (add.length) await conn.query('INSERT INTO ticket_job_orders (ticket_id, jo_id) VALUES ?', [add.map(i => [tid, i])]);
  }

  r.post('/tickets', wrap(async (req, res) => {
    const out = await tx(pool, async conn => {
      const [[u]] = await conn.query('SELECT pic_code FROM users WHERE id=?', [req.user.id]);
      const ticket_no = await numbering.ticketNumber(conn, u?.pic_code);
      const [ins] = await conn.query('INSERT INTO handling_tickets (ticket_no, pic_id, created_by) VALUES (?,?,?)', [ticket_no, req.user.id, req.user.id]);
      await setJos(conn, ins.insertId, req.body.jo_ids);
      await audit.log(conn, { entity: 'ticket', id: ins.insertId, action: 'Tiket dibuat', note: ticket_no, user: req.user });
      return { id: ins.insertId, ticket_no };
    });
    res.json(out);
  }));

  r.put('/tickets/:id/jos', wrap(async (req, res) => {
    await tx(pool, async conn => { await setJos(conn, +req.params.id, req.body.jo_ids); await audit.log(conn, { entity: 'ticket', id: +req.params.id, action: 'Daftar JO diubah', user: req.user }); });
    await refresh(req.params.id);
    res.json({ ok: true });
  }));

  r.delete('/tickets/:id', wrap(async (req, res) => {
    const id = +req.params.id;
    const [[s]] = await pool.query('SELECT COUNT(*) n FROM delivery_notes WHERE ticket_id=?', [id]);
    if (s.n) throw httpError(409, 'Ticket sudah punya Surat Jalan, hapus Surat Jalan terlebih dahulu');
    await tx(pool, async conn => {
      const rep = (await conn.query('SELECT id FROM material_reports WHERE ticket_id=?', [id]))[0].map(x => x.id);
      await files.removeByOwner(conn, 'material_report', rep);
      await conn.query('DELETE FROM handling_tickets WHERE id=?', [id]);
      await conn.query("DELETE FROM audit_log WHERE entity_type='ticket' AND entity_id=?", [id]);
    });
    res.json({ ok: true });
  }));

  /* ---------- Report Material ---------- */
  const MSEL = `SELECT m.*, j.no_jo jo_no, COALESCE(r.status,'NOT_CHECKED') check_status, r.remarks, r.checked_at, r.checked_by_name checked_by,
    (SELECT COALESCE(SUM(i.qty),0) FROM delivery_note_items i WHERE i.material_id=m.id) sent_qty,
    (SELECT GROUP_CONCAT(d.no_sj ORDER BY d.id SEPARATOR ', ') FROM delivery_note_items i JOIN delivery_notes d ON d.id=i.dn_id WHERE i.material_id=m.id) sj_nos
    FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id JOIN job_orders j ON j.id=m.jo_id
    LEFT JOIN material_reports r ON r.material_id=m.id AND r.ticket_id=tj.ticket_id`;

  r.get('/tickets/:id/materials', wrap(async (req, res) => {
    const size = rules.LIMITS.PAGE_SIZE, page = Math.max(1, +req.query.page || 1), w = ['tj.ticket_id=?'], p = [req.params.id];
    if (req.query.q) { w.push('(m.product_no LIKE ? OR m.description LIKE ? OR m.destination LIKE ? OR m.bl_no LIKE ?)'); p.push(...Array(4).fill(`%${req.query.q}%`)); }
    if (req.query.status) { w.push("COALESCE(r.status,'NOT_CHECKED')=?"); p.push(req.query.status); }
    const cond = ' WHERE ' + w.join(' AND ');
    const [[t]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(m.net_weight),0) net, COALESCE(SUM(m.gross_weight),0) gross, COALESCE(SUM(m.qty),0) qty
      FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id LEFT JOIN material_reports r ON r.material_id=m.id AND r.ticket_id=tj.ticket_id${cond}`, p);
    const [rows] = await pool.query(`${MSEL}${cond} ORDER BY m.id LIMIT ? OFFSET ?`, [...p, size, (page - 1) * size]);
    res.json({ rows, total: t.n, pages: Math.ceil(t.n / size), page, totals: { net: +t.net, gross: +t.gross, qty: +t.qty } });
  }));

  const inTicket = async (conn, tid, joId) => (await conn.query('SELECT 1 FROM ticket_job_orders WHERE ticket_id=? AND jo_id=?', [tid, joId]))[0].length > 0;
  const matValues = b => MAT_COLS.map(k => (NUM_COLS.includes(k) ? num(b[k]) : k === 'kondisi' ? nul(b[k]) || 'INTACT' : nul(b[k])));
  function checkMat(b) {
    if (!String(b.product_no ?? '').trim()) throw httpError(400, 'Product/Container No. wajib diisi');
    if (!(+b.qty >= 1)) throw httpError(400, 'Qty minimal 1');
    if (b.kondisi && !['INTACT', 'PARTIAL'].includes(b.kondisi)) throw httpError(400, 'Kondisi harus Intact atau Partial');
  }
  const dupMsg = e => (e.code === 'ER_DUP_ENTRY' ? httpError(400, 'Product No. sudah ada di JO ini') : e);

  // tambah material dari halaman tiket (material tersimpan di level JO)
  r.post('/tickets/:id/materials', wrap(async (req, res) => {
    const tid = +req.params.id, list = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
    if (!list.length) return bad(res, 'Tidak ada data');
    try {
      await tx(pool, async conn => {
        for (const [i, b] of list.entries()) {
          try { b.product_no = String(b.product_no ?? '').trim(); checkMat(b); if (!(await inTicket(conn, tid, b.jo_id))) throw httpError(400, 'Job Order tidak termasuk dalam ticket ini'); }
          catch (e) { throw httpError(400, `Baris ${i + 1}: ${e.message}`); }
          await conn.query(`INSERT INTO jo_materials (${MAT_COLS.join(',')}, created_by) VALUES (${MAT_COLS.map(() => '?').join(',')}, ?)`, [...matValues(b), req.user.id]);
        }
      });
    } catch (e) { throw dupMsg(e); }
    await refresh(tid);
    res.json({ ok: true, count: list.length });
  }));

  async function materialDetail(tid, mid) {
    const [[m]] = await pool.query(`${MSEL} WHERE tj.ticket_id=? AND m.id=?`, [tid, mid]);
    if (!m) return null;
    m.ticket_id = +tid;
    const [[rep]] = await pool.query('SELECT id FROM material_reports WHERE material_id=? AND ticket_id=?', [mid, tid]);
    m.photos = rep ? (await pool.query("SELECT id, path, filename FROM files WHERE owner_type='material_report' AND owner_id=? ORDER BY id", [rep.id]))[0] : [];
    m.ticket = (await pool.query('SELECT ticket_no FROM handling_tickets WHERE id=?', [tid]))[0][0]?.ticket_no;
    m.aju_no = (await pool.query(`SELECT GROUP_CONCAT(number SEPARATOR ', ') a FROM jo_references WHERE jo_id=? AND kind='AJU'`, [m.jo_id]))[0][0].a;
    return m;
  }
  r.get('/tickets/:tid/materials/:mid', wrap(async (req, res) => {
    const m = await materialDetail(req.params.tid, req.params.mid);
    return m ? res.json(m) : res.sendStatus(404);
  }));

  async function ensureReport(conn, tid, mid) {
    await conn.query('INSERT IGNORE INTO material_reports (material_id, ticket_id) VALUES (?,?)', [mid, tid]);
    return (await conn.query('SELECT id FROM material_reports WHERE material_id=? AND ticket_id=?', [mid, tid]))[0][0].id;
  }
  r.patch('/tickets/:tid/materials/:mid/report', wrap(async (req, res) => {
    const { check_status, remarks } = req.body, tid = +req.params.tid, mid = +req.params.mid;
    if (!['NOT_CHECKED', 'OK', 'DAMAGE'].includes(check_status)) return bad(res, 'Pilih Not Checked, Oke atau Damage');
    if (check_status === 'DAMAGE' && !String(remarks || '').trim()) return bad(res, 'Remarks wajib diisi untuk Damage');
    const m = await materialDetail(tid, mid);
    if (!m) return res.sendStatus(404);
    await tx(pool, async conn => {
      await ensureReport(conn, tid, mid);
      const checked = check_status !== 'NOT_CHECKED';
      await conn.query('UPDATE material_reports SET status=?, remarks=?, checked_at=?, checked_by=?, checked_by_name=? WHERE material_id=? AND ticket_id=?',
        [check_status, nul(remarks), checked ? new Date() : null, checked ? req.user.id : null, checked ? req.user.name : null, mid, tid]);
      await audit.log(conn, { entity: 'ticket', id: tid, action: 'Report material', note: `${m.product_no}: ${check_status}`, user: req.user });
    });
    await refresh(tid);
    res.json({ ok: true });
  }));

  r.post('/tickets/:tid/materials/:mid/photos', wrap(async (req, res) => {
    const tid = +req.params.tid, mid = +req.params.mid;
    if (!(await materialDetail(tid, mid))) return res.sendStatus(404);
    await tx(pool, async conn => {
      const rid = await ensureReport(conn, tid, mid);
      const [[n]] = await conn.query("SELECT COUNT(*) n FROM files WHERE owner_type='material_report' AND owner_id=?", [rid]);
      if (n.n >= rules.LIMITS.MATERIAL_PHOTOS) throw httpError(400, `Maksimal ${rules.LIMITS.MATERIAL_PHOTOS} foto`);
      await files.create(conn, { ownerType: 'material_report', ownerId: rid, kind: 'photo', filename: req.body.filename || 'foto.jpg', buffer: files.fromBase64(req.body.data), user: req.user, imagesOnly: true });
    });
    res.json({ ok: true });
  }));

  // material = data level JO; boleh diedit dari tiket
  r.put('/materials/:id', wrap(async (req, res) => {
    const b = req.body;
    checkMat(b);
    const [[m]] = await pool.query('SELECT jo_id FROM jo_materials WHERE id=?', [req.params.id]);
    if (!m) return res.sendStatus(404);
    b.jo_id = m.jo_id;
    const cols = MAT_COLS.filter(c => c !== 'jo_id');
    try { await pool.query(`UPDATE jo_materials SET ${cols.map(c => c + '=?').join(',')}, updated_by=? WHERE id=?`, [...cols.map(c => matValues(b)[MAT_COLS.indexOf(c)]), req.user.id, req.params.id]); }
    catch (e) { throw dupMsg(e); }
    res.json({ ok: true });
  }));
  r.delete('/materials/:id', wrap(async (req, res) => {
    const id = +req.params.id;
    const [[m]] = await pool.query('SELECT jo_id FROM jo_materials WHERE id=?', [id]);
    if (!m) return res.json({ ok: true });
    const [[s]] = await pool.query('SELECT COUNT(*) n FROM delivery_note_items WHERE material_id=?', [id]);
    if (s.n) throw httpError(409, 'Material sudah masuk Surat Jalan');
    const tickets = (await pool.query('SELECT ticket_id FROM ticket_job_orders WHERE jo_id=?', [m.jo_id]))[0].map(x => x.ticket_id);
    await tx(pool, async conn => {
      const rep = (await conn.query('SELECT id FROM material_reports WHERE material_id=?', [id]))[0].map(x => x.id);
      await files.removeByOwner(conn, 'material_report', rep);
      await conn.query('DELETE FROM jo_materials WHERE id=?', [id]);
    });
    for (const t of tickets) await refresh(t);
    res.json({ ok: true });
  }));

  // hapus foto (material report / surat jalan)
  r.delete('/files/:id', wrap(async (req, res) => {
    const [[f]] = await pool.query('SELECT id, owner_type FROM files WHERE id=?', [req.params.id]);
    if (f && ['material_report', 'delivery_note'].includes(f.owner_type)) await files.removeById(pool, f.id);
    res.json({ ok: true });
  }));

  /* ---------- Trucking Delivery / Surat Jalan ---------- */
  const DNSEL = `SELECT d.id, d.ticket_id, d.no_sj sj_no, d.nopol, d.driver, d.phone, d.vendor_id, d.start_loading start_at, d.finish_loading finish_at, d.entry_at, d.exit_at, d.created_by_name, d.created_at,
    v.code vendor_code, v.name vendor_name, COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.weight),0) net_weight,
    COALESCE(SUM(m.gross_weight*i.qty/NULLIF(m.qty,0)),0) gross_weight, MIN(m.unit) unit,
    GROUP_CONCAT(DISTINCT m.origin SEPARATOR ', ') origin, GROUP_CONCAT(DISTINCT m.destination SEPARATOR ', ') destination
    FROM delivery_notes d LEFT JOIN vendors v ON v.id=d.vendor_id LEFT JOIN delivery_note_items i ON i.dn_id=d.id LEFT JOIN jo_materials m ON m.id=i.material_id`;
  const dnOut = x => ({ ...x, qty: +x.qty, net_weight: +x.net_weight, gross_weight: +x.gross_weight, load_min: calc.loadMinutes(x.start_at, x.finish_at) });

  r.get('/tickets/:id/sj', wrap(async (req, res) => {
    const size = rules.LIMITS.PAGE_SIZE, page = Math.max(1, +req.query.page || 1), w = ['d.ticket_id=?'], p = [req.params.id];
    if (req.query.q) { w.push('(d.nopol LIKE ? OR d.driver LIKE ? OR d.no_sj LIKE ? OR v.code LIKE ? OR EXISTS (SELECT 1 FROM delivery_note_items ii JOIN jo_materials mm ON mm.id=ii.material_id WHERE ii.dn_id=d.id AND mm.destination LIKE ?))'); p.push(...Array(5).fill(`%${req.query.q}%`)); }
    const cond = ' WHERE ' + w.join(' AND ');
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM delivery_notes d LEFT JOIN vendors v ON v.id=d.vendor_id${cond}`, p);
    const [rows] = await pool.query(`${DNSEL}${cond} GROUP BY d.id ORDER BY d.id DESC LIMIT ? OFFSET ?`, [...p, size, (page - 1) * size]);
    const [[t]] = await pool.query(`SELECT COUNT(DISTINCT d.id) trips, COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.weight),0) net, COALESCE(SUM(m.gross_weight*i.qty/NULLIF(m.qty,0)),0) gross
      FROM delivery_notes d LEFT JOIN delivery_note_items i ON i.dn_id=d.id LEFT JOIN jo_materials m ON m.id=i.material_id WHERE d.ticket_id=?`, [req.params.id]);
    res.json({ rows: rows.map(dnOut), total: n, pages: Math.ceil(n / size), page, totals: { trips: t.trips, qty: +t.qty, net: +t.net, gross: +t.gross } });
  }));

  // material yang masih punya sisa qty (ex = surat jalan yang sedang diedit)
  r.get('/tickets/:id/available', wrap(async (req, res) => {
    const q = `%${req.query.q || ''}%`, ex = +req.query.ex || 0;
    const [rows] = await pool.query(`SELECT * FROM (SELECT m.id, m.product_no, m.description, m.spec, m.bl_no, m.qty, m.unit, m.net_weight, m.gross_weight, m.destination, COALESCE(r.status,'NOT_CHECKED') check_status,
      m.qty-(SELECT COALESCE(SUM(i.qty),0) FROM delivery_note_items i WHERE i.material_id=m.id AND i.dn_id<>?) remain
      FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id LEFT JOIN material_reports r ON r.material_id=m.id AND r.ticket_id=tj.ticket_id
      WHERE tj.ticket_id=? AND (m.product_no LIKE ? OR m.description LIKE ? OR m.destination LIKE ?)) x WHERE remain>0 ORDER BY id LIMIT 50`, [ex, req.params.id, q, q, q]);
    res.json(rows);
  }));

  async function dnItems(conn, dnId, tid, items) {
    if (!Array.isArray(items) || !items.length) throw httpError(400, 'Tambahkan minimal 1 material');
    const ids = items.map(i => +i.material_id);
    if (new Set(ids).size !== ids.length) throw httpError(400, 'Material duplikat dalam Surat Jalan');
    const [ms] = await conn.query(`SELECT m.id, m.product_no, m.qty, tj.ticket_id,
      (SELECT COALESCE(SUM(i.qty),0) FROM delivery_note_items i WHERE i.material_id=m.id AND i.dn_id<>?) used,
      COALESCE((SELECT rr.status FROM material_reports rr WHERE rr.material_id=m.id AND rr.ticket_id=?),'NOT_CHECKED') st
      FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id AND tj.ticket_id=? WHERE m.id IN (?) FOR UPDATE`, [dnId, tid, tid, ids]);
    const rows = [];
    for (const it of items) {
      const m = ms.find(x => x.id === +it.material_id);
      if (!m) throw httpError(400, 'Material tidak valid');
      if (!(+it.qty >= 1) || +it.qty > m.qty - m.used) throw httpError(400, `Qty ${m.product_no} melebihi sisa (${m.qty - m.used})`);
      if (!(num(it.weight) >= 0)) throw httpError(400, 'Weight tidak valid');
      rows.push([dnId, m.id, +it.qty, num(it.weight), m.st === 'DAMAGE' ? 'DAMAGE' : m.st === 'OK' ? 'GOOD' : null]);
    }
    await conn.query('DELETE FROM delivery_note_items WHERE dn_id=?', [dnId]);
    await conn.query('INSERT INTO delivery_note_items (dn_id, material_id, qty, weight, mark) VALUES ?', [rows]);
  }
  const dnHead = b => {
    if (!String(b.nopol || '').trim() || !String(b.driver || '').trim()) throw httpError(400, 'Nomor polisi dan nama driver wajib diisi');
    return [String(b.nopol).trim().toUpperCase(), String(b.driver).trim(), nul(b.phone), nul(b.vendor_id), nul(b.entry_at), nul(b.exit_at)];
  };

  r.post('/tickets/:id/sj', wrap(async (req, res) => {
    const tid = +req.params.id, b = req.body;
    const out = await tx(pool, async conn => {
      const head = dnHead(b), no_sj = await numbering.sjNumber(conn);
      const start = b.start_at && !isNaN(Date.parse(b.start_at)) ? new Date(b.start_at) : new Date();
      const [ins] = await conn.query('INSERT INTO delivery_notes (no_sj, ticket_id, nopol, driver, phone, vendor_id, entry_at, exit_at, start_loading, finish_loading, created_by_name, created_by) VALUES (?,?,?,?,?,?,?,?,?,NOW(),?,?)',
        [no_sj, tid, ...head, start, req.user.name, req.user.id]);
      await dnItems(conn, ins.insertId, tid, b.items);
      await audit.log(conn, { entity: 'ticket', id: tid, action: 'Surat jalan dibuat', note: no_sj, user: req.user });
      return { id: ins.insertId, sj_no: no_sj };
    });
    await refresh(tid);
    res.json(out);
  }));

  r.put('/sj/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query('SELECT ticket_id FROM delivery_notes WHERE id=?', [req.params.id]);
    if (!s) return res.sendStatus(404);
    await tx(pool, async conn => {
      await conn.query('UPDATE delivery_notes SET nopol=?, driver=?, phone=?, vendor_id=?, entry_at=?, exit_at=?, updated_by=? WHERE id=?', [...dnHead(req.body), req.user.id, req.params.id]);
      if (req.body.items) await dnItems(conn, +req.params.id, s.ticket_id, req.body.items);
    });
    await refresh(s.ticket_id);
    res.json({ ok: true });
  }));

  r.get('/sj/:id', wrap(async (req, res) => {
    const [[s0]] = await pool.query(`${DNSEL} WHERE d.id=? GROUP BY d.id`, [req.params.id]);
    if (!s0) return res.sendStatus(404);
    const s = dnOut(s0);
    s.items = (await pool.query(`SELECT i.id, i.material_id, i.qty, i.weight, i.mark, m.product_no, m.description, m.spec, m.bl_no, m.unit, m.qty mat_qty, m.destination, m.origin, m.jo_id, j.no_jo jo_no,
      COALESCE(r.status,'NOT_CHECKED') check_status FROM delivery_note_items i JOIN jo_materials m ON m.id=i.material_id JOIN job_orders j ON j.id=m.jo_id
      LEFT JOIN material_reports r ON r.material_id=m.id AND r.ticket_id=? WHERE i.dn_id=? ORDER BY i.id`, [s.ticket_id, s.id]))[0];
    s.photos = (await pool.query("SELECT id, path, filename FROM files WHERE owner_type='delivery_note' AND owner_id=? ORDER BY id", [s.id]))[0];
    Object.assign(s, (await pool.query('SELECT t.ticket_no, u.name pic_name, u.employee_no FROM handling_tickets t JOIN users u ON u.id=t.pic_id WHERE t.id=?', [s.ticket_id]))[0][0]);
    const jids = uniq(s.items.map(i => i.jo_id));
    s.jos = jids.length ? (await pool.query(`SELECT j.no_jo jo_no, ${refStr('INVOICE')} invoice_no, ${refStr('BL')} bl_no, j.vessel, j.qty, j.unit, j.party_text, j.weight_kg, ${refStr('AJU')} aju_no, c.name customer_name
      FROM job_orders j JOIN customers c ON c.id=j.customer_id WHERE j.id IN (?)`, [jids]))[0].map(x => ({ ...x, party: fmt.partyLabel(x.qty, x.unit, x.party_text), weight: calc.kgToTon(x.weight_kg) })) : [];
    res.json(s);
  }));

  r.delete('/sj/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query('SELECT ticket_id FROM delivery_notes WHERE id=?', [req.params.id]);
    if (!s) return res.json({ ok: true });
    await tx(pool, async conn => { await files.removeByOwner(conn, 'delivery_note', +req.params.id); await conn.query('DELETE FROM delivery_notes WHERE id=?', [req.params.id]); });
    await refresh(s.ticket_id);
    res.json({ ok: true });
  }));

  r.post('/sj/:id/photos', wrap(async (req, res) => {
    const id = +req.params.id;
    await tx(pool, async conn => {
      const [[n]] = await conn.query("SELECT COUNT(*) n FROM files WHERE owner_type='delivery_note' AND owner_id=?", [id]);
      if (n.n >= rules.LIMITS.SJ_PHOTOS) throw httpError(400, `Maksimal ${rules.LIMITS.SJ_PHOTOS} foto`);
      await files.create(conn, { ownerType: 'delivery_note', ownerId: id, kind: 'photo', filename: req.body.filename || 'foto.jpg', buffer: files.fromBase64(req.body.data), user: req.user, imagesOnly: true });
    });
    res.json({ ok: true });
  }));

  /* ---------- ekspor & Copy Report (CSV sementara; xlsx di tahap 10) ---------- */
  r.get('/tickets/:id/export', wrap(async (req, res) => {
    const [rows] = await pool.query(`${MSEL} WHERE tj.ticket_id=? ORDER BY m.id`, [req.params.id]);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, st = { NOT_CHECKED: '-', OK: 'OK', DAMAGE: 'DM' };
    const head = ['JO', 'Product/Container No', 'Description', 'Spec', 'Thickness', 'Width', 'No. BL', 'Net Weight', 'Gross Weight', 'Qty', 'Satuan', 'Dari', 'Tujuan', 'Status', 'Remarks', 'Surat Jalan'];
    res.type('text/csv').send('﻿' + [head.join(','), ...rows.map(x => [x.jo_no, x.product_no, x.description, x.spec, x.thickness, x.width, x.bl_no, x.net_weight, x.gross_weight, x.qty, x.unit, x.origin, x.destination, st[x.check_status], x.remarks, x.sj_nos].map(cell).join(','))].join('\r\n'));
  }));

  r.get('/tickets/:id/report-text', wrap(async (req, res) => {
    const t = await ticketRow(req.params.id);
    if (!t) return res.sendStatus(404);
    const [[m]] = await pool.query(`SELECT SUM(COALESCE(r.status,'NOT_CHECKED')='OK') ok, SUM(r.status='DAMAGE') dm, SUM(COALESCE(r.status,'NOT_CHECKED')='NOT_CHECKED') nc
      FROM jo_materials m JOIN ticket_job_orders tj ON tj.jo_id=m.jo_id LEFT JOIN material_reports r ON r.material_id=m.id AND r.ticket_id=tj.ticket_id WHERE tj.ticket_id=?`, [t.id]);
    const [sj] = await pool.query(`${DNSEL} WHERE d.ticket_id=? GROUP BY d.id ORDER BY d.id`, [t.id]);
    const n = v => fmt.fmtNum(v, 0);
    res.json({ text: [`HANDLING OPS - ${t.ticket_no}`, `PIC: ${t.pic_name}`, `Customer: ${t.customer}`, `Vessel: ${t.vessel || '-'}`, `Party: ${t.party || '-'} | Weight: ${fmt.fmtNum(t.weight)} ton`,
      `Report Material: ${t.mat_pct}% (OK ${m.ok || 0}, Damage ${m.dm || 0}, Belum dicek ${m.nc || 0})`, `Trucking Delivery: ${t.del_pct}% (${sj.length} rit, ${n(t.qty_sent)}/${n(t.qty_total)} qty)`,
      ...sj.map((s, i) => `${i + 1}. ${s.nopol} ${s.driver} (${s.vendor_code || '-'}) SJ ${s.sj_no} - ${s.qty} ${s.unit || ''} - ${n(s.net_weight)} kg -> ${s.destination || '-'}`)].join('\n') });
  }));

  r.refresh = refresh;
  return r;
};
