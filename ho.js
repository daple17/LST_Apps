// Handling Ops: ticket, report material, trucking delivery (surat jalan)
module.exports = ({ app, pool, wrap, bad, UP, fs, path }) => {
  const pad = (n, l) => String(n).padStart(l, '0');
  const num = v => (v === '' || v == null || isNaN(v) ? 0 : +v);
  const rmFile = p => fs.rmSync(path.join(UP, p), { force: true });
  const saveImg = (b, prefix) => {
    if (!b.data || !/\.(jpe?g|png|webp|gif)$/i.test(b.filename || '')) return null;
    const buf = Buffer.from(b.data, 'base64');
    if (buf.length > 8 * 1024 * 1024) return null;
    const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${path.extname(b.filename).toLowerCase()}`;
    fs.writeFileSync(path.join(UP, name), buf);
    return name;
  };

  // progress = rata-rata % report material dan % trucking delivery
  const TK = `SELECT t.id,t.ticket_no,t.created_at,t.done_at,t.pic_id,u.name pic_name,
    (SELECT GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id JOIN customers c ON c.id=j.customer_id WHERE tj.ticket_id=t.id) customer,
    (SELECT GROUP_CONCAT(DISTINCT j.vessel ORDER BY j.vessel SEPARATOR ', ') FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id WHERE tj.ticket_id=t.id) vessel,
    (SELECT GROUP_CONCAT(j.party ORDER BY j.id SEPARATOR ', ') FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id WHERE tj.ticket_id=t.id) party,
    (SELECT COALESCE(SUM(j.weight),0) FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id WHERE tj.ticket_id=t.id) weight,
    (SELECT COUNT(*) FROM materials m WHERE m.ticket_id=t.id) mat_total,
    (SELECT COUNT(*) FROM materials m WHERE m.ticket_id=t.id AND m.check_status<>'NOT_CHECKED') mat_checked,
    (SELECT COALESCE(SUM(m.qty),0) FROM materials m WHERE m.ticket_id=t.id) qty_total,
    (SELECT COALESCE(SUM(i.qty),0) FROM surat_jalan_items i JOIN surat_jalan s ON s.id=i.sj_id WHERE s.ticket_id=t.id) qty_sent
    FROM ho_tickets t JOIN users u ON u.id=t.pic_id`;
  const PCT = `SELECT x.*, IF(mat_total=0,0,ROUND(100*mat_checked/mat_total,2)) mat_pct,
    IF(qty_total=0,0,ROUND(100*LEAST(qty_sent,qty_total)/qty_total,2)) del_pct,
    TIMESTAMPDIFF(MINUTE,created_at,COALESCE(done_at,NOW())) dwell_min FROM (${TK}) x`;
  const PROG = `SELECT p.*, ROUND((mat_pct+del_pct)/2,2) prog FROM (${PCT}) p`;

  function tkWhere(q) {
    const w = ['1=1'], p = [];
    if (q.q) { w.push('(ticket_no LIKE ? OR pic_name LIKE ? OR customer LIKE ? OR vessel LIKE ?)'); p.push(...Array(4).fill(`%${q.q}%`)); }
    if (q.from) { w.push('DATE(created_at)>=?'); p.push(q.from); }
    if (q.to) { w.push('DATE(created_at)<=?'); p.push(q.to); }
    return [w.join(' AND '), p];
  }
  const progCond = { done: 'prog>=100', mid: 'prog>=50 AND prog<100', low: 'prog<50' };

  // setelah material/SJ berubah: catat kapan ticket 100% (untuk dwelling time)
  async function refresh(tid) {
    const [[r]] = await pool.query(`SELECT prog FROM (${PROG}) q WHERE id=?`, [tid]);
    if (!r) return;
    await pool.query(r.prog >= 100 ? 'UPDATE ho_tickets SET done_at=COALESCE(done_at,NOW()) WHERE id=?' : 'UPDATE ho_tickets SET done_at=NULL WHERE id=?', [tid]);
  }

  app.get('/api/vendors', wrap(async (req, res) => res.json((await pool.query('SELECT id,code,name FROM vendors ORDER BY code'))[0])));
  app.post('/api/vendors', wrap(async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase(), name = String(req.body.name || '').trim();
    if (!/^[A-Z0-9 ]{2,10}$/.test(code)) return bad(res, 'Kode vendor 2-10 huruf/angka');
    if (!name) return bad(res, 'Nama wajib diisi');
    const [[d]] = await pool.query('SELECT id FROM vendors WHERE code=?', [code]);
    if (d) return bad(res, 'Kode sudah dipakai');
    const [r] = await pool.query('INSERT INTO vendors (code,name) VALUES (?,?)', [code, name]);
    res.json({ id: r.insertId });
  }));

  /* ---------- Tickets ---------- */
  app.get('/api/ho/tickets', wrap(async (req, res) => {
    const page = Math.max(1, +req.query.page || 1), lim = 15, [w, p] = tkWhere(req.query);
    const [[c]] = await pool.query(`SELECT COUNT(*) \`all\`, SUM(prog>=100) done, SUM(prog>=50 AND prog<100) mid, SUM(prog<50) low FROM (${PROG}) q WHERE ${w}`, p);
    const pc = progCond[req.query.progress] ? ` AND ${progCond[req.query.progress]}` : '';
    const [rows] = await pool.query(`SELECT * FROM (${PROG}) q WHERE ${w}${pc} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, lim, (page - 1) * lim]);
    const total = { all: +c.all || 0, done: +c.done || 0, mid: +c.mid || 0, low: +c.low || 0 }[req.query.progress || 'all'];
    res.json({ rows, total, counts: { all: +c.all || 0, done: +c.done || 0, mid: +c.mid || 0, low: +c.low || 0 }, pages: Math.ceil(total / lim) });
  }));

  app.get('/api/ho/tickets/export', wrap(async (req, res) => {
    const [w, p] = tkWhere(req.query), pc = progCond[req.query.progress] ? ` AND ${progCond[req.query.progress]}` : '';
    const [rows] = await pool.query(`SELECT * FROM (${PROG}) q WHERE ${w}${pc} ORDER BY id DESC`, p);
    const cols = ['ticket_no', 'pic_name', 'customer', 'vessel', 'party', 'weight', 'dwell_min', 'mat_pct', 'del_pct', 'created_at'];
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.type('text/csv').send('﻿' + [['Ticket', 'PIC', 'Customer', 'Vessel', 'Party', 'Weight (ton)', 'Dwelling (menit)', 'Report Material %', 'Trucking Delivery %', 'Dibuat'].join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n'));
  }));

  app.get('/api/ho/browse-jo', wrap(async (req, res) => {
    const q = `%${req.query.q || ''}%`, ex = +req.query.ticket || 0;
    const [rows] = await pool.query(`SELECT j.id,j.jo_no,j.type,c.name customer_name,j.party,j.weight,j.bl_no,j.invoice_no,j.aju_no,j.vessel,j.status
      FROM job_orders j JOIN customers c ON c.id=j.customer_id LEFT JOIN ho_ticket_jos tj ON tj.jo_id=j.id
      WHERE (tj.jo_id IS NULL OR tj.ticket_id=?) AND j.status='NOT_COMP' AND (j.jo_no LIKE ? OR c.name LIKE ? OR j.vessel LIKE ? OR j.bl_no LIKE ? OR j.invoice_no LIKE ?)
      ORDER BY j.id DESC LIMIT 40`, [ex, q, q, q, q, q]);
    res.json(rows);
  }));

  const josOf = async tid => (await pool.query(`SELECT j.id,j.jo_no,j.type,j.party,j.weight,j.bl_no,j.invoice_no,j.aju_no,j.vessel,j.status,c.name customer_name,
    (SELECT COUNT(*) FROM materials m WHERE m.jo_id=j.id) mat_count
    FROM ho_ticket_jos tj JOIN job_orders j ON j.id=tj.jo_id JOIN customers c ON c.id=j.customer_id WHERE tj.ticket_id=? ORDER BY j.id`, [tid]))[0];

  app.get('/api/ho/tickets/:id', wrap(async (req, res) => {
    const [[t]] = await pool.query(`SELECT * FROM (${PROG}) q WHERE id=?`, [req.params.id]);
    if (!t) return res.sendStatus(404);
    t.jos = await josOf(t.id);
    const [[u]] = await pool.query('SELECT employee_no FROM users WHERE id=?', [t.pic_id]); t.employee_no = u.employee_no;
    const [[s]] = await pool.query(`SELECT COALESCE(SUM(net_weight),0) net, COALESCE(SUM(gross_weight),0) gross, COALESCE(SUM(qty),0) qty FROM materials WHERE ticket_id=?`, [t.id]);
    t.totals = { net: +s.net, gross: +s.gross, qty: +s.qty };
    const [[tr]] = await pool.query('SELECT COUNT(*) n FROM surat_jalan WHERE ticket_id=?', [t.id]); t.sj_count = tr.n;
    res.json(t);
  }));

  async function setJos(conn, tid, ids) {
    ids = [...new Set((ids || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new Error('Pilih minimal 1 Job Order');
    const [jos] = await conn.query('SELECT j.id,j.jo_no,j.status,tj.ticket_id tk FROM job_orders j LEFT JOIN ho_ticket_jos tj ON tj.jo_id=j.id WHERE j.id IN (?)', [ids]);
    if (jos.length !== ids.length) throw new Error('Ada Job Order yang tidak ditemukan');
    const used = jos.find(j => j.tk && j.tk !== tid);
    if (used) throw new Error(`JO ${used.jo_no} sudah dipakai ticket lain`);
    const [old] = await conn.query('SELECT jo_id FROM ho_ticket_jos WHERE ticket_id=?', [tid]);
    const removed = old.map(o => o.jo_id).filter(i => !ids.includes(i));
    if (removed.length) {
      const [[m]] = await conn.query('SELECT COUNT(*) n FROM materials WHERE jo_id IN (?)', [removed]);
      if (m.n) throw new Error('JO yang sudah punya material tidak bisa dilepas dari ticket');
      await conn.query('DELETE FROM ho_ticket_jos WHERE ticket_id=? AND jo_id IN (?)', [tid, removed]);
    }
    const add = ids.filter(i => !old.some(o => o.jo_id === i));
    if (add.length) await conn.query('INSERT INTO ho_ticket_jos (ticket_id,jo_id) VALUES ?', [add.map(i => [tid, i])]);
  }

  app.post('/api/ho/tickets', wrap(async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[u]] = await conn.query('SELECT pic_code FROM users WHERE id=?', [req.user.id]);
      const d = new Date(), ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
      const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM ho_tickets WHERE ticket_no LIKE ? FOR UPDATE', [ymd + '%']);
      const no = `${ymd}${pad(+n + 1, 2)}${u.pic_code || 'XX'}`;
      const [r] = await conn.query('INSERT INTO ho_tickets (ticket_no,pic_id) VALUES (?,?)', [no, req.user.id]);
      await setJos(conn, r.insertId, req.body.jo_ids);
      await conn.commit();
      res.json({ id: r.insertId, ticket_no: no });
    } catch (e) { await conn.rollback(); return bad(res, e.message); } finally { conn.release(); }
  }));

  app.put('/api/ho/tickets/:id/jos', wrap(async (req, res) => {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); await setJos(conn, +req.params.id, req.body.jo_ids); await conn.commit(); res.json({ ok: true }); }
    catch (e) { await conn.rollback(); return bad(res, e.message); } finally { conn.release(); }
  }));

  app.delete('/api/ho/tickets/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query('SELECT COUNT(*) n FROM surat_jalan WHERE ticket_id=?', [req.params.id]);
    if (s.n) return res.status(409).json({ error: 'Ticket sudah punya Surat Jalan, hapus Surat Jalan terlebih dahulu' });
    const [ph] = await pool.query('SELECT p.path FROM material_photos p JOIN materials m ON m.id=p.material_id WHERE m.ticket_id=?', [req.params.id]);
    await pool.query('DELETE FROM materials WHERE ticket_id=?', [req.params.id]);
    await pool.query('DELETE FROM ho_tickets WHERE id=?', [req.params.id]);
    ph.forEach(p => rmFile(p.path));
    res.json({ ok: true });
  }));

  /* ---------- Report Material ---------- */
  const MCOLS = ['jo_id', 'product_no', 'description', 'spec', 'thickness', 'width', 'bl_no', 'net_weight', 'gross_weight', 'qty', 'unit', 'origin', 'destination'];
  const MSEL = `SELECT m.*, j.jo_no,
    (SELECT COALESCE(SUM(i.qty),0) FROM surat_jalan_items i WHERE i.material_id=m.id) sent_qty,
    (SELECT GROUP_CONCAT(s.sj_no SEPARATOR ', ') FROM surat_jalan_items i JOIN surat_jalan s ON s.id=i.sj_id WHERE i.material_id=m.id) sj_nos
    FROM materials m JOIN job_orders j ON j.id=m.jo_id`;

  app.get('/api/ho/tickets/:id/materials', wrap(async (req, res) => {
    const page = Math.max(1, +req.query.page || 1), lim = 20, w = ['m.ticket_id=?'], p = [req.params.id];
    if (req.query.q) { w.push('(m.product_no LIKE ? OR m.description LIKE ? OR m.destination LIKE ? OR m.bl_no LIKE ?)'); p.push(...Array(4).fill(`%${req.query.q}%`)); }
    if (req.query.status) { w.push('m.check_status=?'); p.push(req.query.status); }
    const cond = ' WHERE ' + w.join(' AND ');
    const [[t]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(net_weight),0) net, COALESCE(SUM(gross_weight),0) gross, COALESCE(SUM(qty),0) qty FROM materials m${cond}`, p);
    const [rows] = await pool.query(`${MSEL}${cond} ORDER BY m.id LIMIT ? OFFSET ?`, [...p, lim, (page - 1) * lim]);
    res.json({ rows, total: t.n, pages: Math.ceil(t.n / lim), totals: { net: +t.net, gross: +t.gross, qty: +t.qty } });
  }));

  const NUMK = ['net_weight', 'gross_weight'];
  const mrow = (b, tid) => [tid, ...MCOLS.map(k => NUMK.includes(k) ? num(b[k]) : b[k] === '' || b[k] === undefined ? null : b[k])];
  async function checkMat(b, tid, res) {
    if (!b.product_no || !String(b.product_no).trim()) return bad(res, 'Product/Container No. wajib diisi');
    const [[j]] = await pool.query('SELECT 1 ok FROM ho_ticket_jos WHERE ticket_id=? AND jo_id=?', [tid, b.jo_id]);
    if (!j) return bad(res, 'Job Order tidak termasuk dalam ticket ini');
    if (!(+b.qty >= 1)) return bad(res, 'Qty minimal 1');
    return true;
  }
  app.post('/api/ho/tickets/:id/materials', wrap(async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body];
    if (!rows.length) return bad(res, 'Tidak ada data');
    try {
      for (const [i, b] of rows.entries()) {
        b.product_no = String(b.product_no || '').trim();
        await checkMat(b, req.params.id, { status: () => ({ json: e => { throw new Error(`Baris ${i + 1}: ${e.error}`); } }) });
      }
    } catch (e) { return bad(res, e.message); }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const b of rows) await conn.query(`INSERT INTO materials (ticket_id,${MCOLS.join(',')}) VALUES (?${',?'.repeat(MCOLS.length)})`, mrow(b, req.params.id));
      await conn.commit();
    } catch (e) { await conn.rollback(); return bad(res, e.code === 'ER_DUP_ENTRY' ? 'Product No. sudah ada di ticket ini' : e.message); } finally { conn.release(); }
    await refresh(req.params.id);
    res.json({ ok: true, count: rows.length });
  }));

  app.get('/api/materials/:id', wrap(async (req, res) => {
    const [[m]] = await pool.query(`${MSEL} WHERE m.id=?`, [req.params.id]);
    if (!m) return res.sendStatus(404);
    [m.photos] = await pool.query('SELECT id,path FROM material_photos WHERE material_id=?', [m.id]);
    [m.ticket] = (await pool.query('SELECT ticket_no FROM ho_tickets WHERE id=?', [m.ticket_id]))[0];
    const [[j]] = await pool.query('SELECT aju_no FROM job_orders WHERE id=?', [m.jo_id]); m.aju_no = j.aju_no;
    res.json(m);
  }));

  app.put('/api/materials/:id', wrap(async (req, res) => {
    const [[m]] = await pool.query('SELECT ticket_id FROM materials WHERE id=?', [req.params.id]);
    if (!m) return res.sendStatus(404);
    if ((await checkMat(req.body, m.ticket_id, res)) !== true) return;
    try { await pool.query(`UPDATE materials SET ${MCOLS.map(k => k + '=?').join(',')} WHERE id=?`, [...mrow(req.body, 0).slice(1), req.params.id]); }
    catch (e) { return bad(res, e.code === 'ER_DUP_ENTRY' ? 'Product No. sudah ada di ticket ini' : e.message); }
    res.json({ ok: true });
  }));

  app.delete('/api/materials/:id', wrap(async (req, res) => {
    const [[m]] = await pool.query('SELECT ticket_id FROM materials WHERE id=?', [req.params.id]);
    if (!m) return res.json({ ok: true });
    const [[s]] = await pool.query('SELECT COUNT(*) n FROM surat_jalan_items WHERE material_id=?', [req.params.id]);
    if (s.n) return res.status(409).json({ error: 'Material sudah masuk Surat Jalan' });
    const [ph] = await pool.query('SELECT path FROM material_photos WHERE material_id=?', [req.params.id]);
    await pool.query('DELETE FROM materials WHERE id=?', [req.params.id]);
    ph.forEach(p => rmFile(p.path));
    await refresh(m.ticket_id);
    res.json({ ok: true });
  }));

  app.patch('/api/materials/:id/report', wrap(async (req, res) => {
    const { check_status, remarks } = req.body;
    if (!['NOT_CHECKED', 'OK', 'DAMAGE'].includes(check_status)) return bad(res, 'Pilih Not Checked, Oke atau Damage');
    if (check_status === 'DAMAGE' && !String(remarks || '').trim()) return bad(res, 'Remarks wajib diisi untuk Damage');
    const [[m]] = await pool.query('SELECT ticket_id FROM materials WHERE id=?', [req.params.id]);
    if (!m) return res.sendStatus(404);
    await pool.query('UPDATE materials SET check_status=?,remarks=?,checked_at=IF(?="NOT_CHECKED",NULL,NOW()),checked_by=IF(?="NOT_CHECKED",NULL,?) WHERE id=?',
      [check_status, remarks || null, check_status, check_status, req.user.name, req.params.id]);
    await refresh(m.ticket_id);
    res.json({ ok: true });
  }));

  app.post('/api/materials/:id/photos', wrap(async (req, res) => {
    const [[n]] = await pool.query('SELECT COUNT(*) n FROM material_photos WHERE material_id=?', [req.params.id]);
    if (n.n >= 8) return bad(res, 'Maksimal 8 foto');
    const f = saveImg(req.body, 'mat');
    if (!f) return bad(res, 'File harus gambar (jpg/png/webp) maks 8 MB');
    await pool.query('INSERT INTO material_photos (material_id,path) VALUES (?,?)', [req.params.id, f]);
    res.json({ ok: true });
  }));
  app.delete('/api/material-photos/:id', wrap(async (req, res) => {
    const [[p]] = await pool.query('SELECT path FROM material_photos WHERE id=?', [req.params.id]);
    if (p) { rmFile(p.path); await pool.query('DELETE FROM material_photos WHERE id=?', [req.params.id]); }
    res.json({ ok: true });
  }));

  /* ---------- Trucking Delivery / Surat Jalan ---------- */
  const SJSEL = `SELECT s.*, v.code vendor_code, v.name vendor_name,
    COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.weight),0) net_weight,
    COALESCE(SUM(m.gross_weight*i.qty/NULLIF(m.qty,0)),0) gross_weight,
    MIN(m.unit) unit, GROUP_CONCAT(DISTINCT m.origin SEPARATOR ', ') origin, GROUP_CONCAT(DISTINCT m.destination SEPARATOR ', ') destination,
    TIMESTAMPDIFF(MINUTE,s.start_at,s.finish_at) load_min
    FROM surat_jalan s LEFT JOIN vendors v ON v.id=s.vendor_id LEFT JOIN surat_jalan_items i ON i.sj_id=s.id LEFT JOIN materials m ON m.id=i.material_id`;

  app.get('/api/ho/tickets/:id/sj', wrap(async (req, res) => {
    const page = Math.max(1, +req.query.page || 1), lim = 20, w = ['s.ticket_id=?'], p = [req.params.id];
    if (req.query.q) { w.push('(s.nopol LIKE ? OR s.driver LIKE ? OR s.sj_no LIKE ? OR v.code LIKE ?)'); p.push(...Array(4).fill(`%${req.query.q}%`)); }
    const cond = ' WHERE ' + w.join(' AND ');
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM surat_jalan s LEFT JOIN vendors v ON v.id=s.vendor_id${cond}`, p);
    const [rows] = await pool.query(`${SJSEL}${cond} GROUP BY s.id ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...p, lim, (page - 1) * lim]);
    const [[t]] = await pool.query(`SELECT COUNT(*) trips, COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.weight),0) net, COALESCE(SUM(m.gross_weight*i.qty/NULLIF(m.qty,0)),0) gross
      FROM surat_jalan s JOIN surat_jalan_items i ON i.sj_id=s.id JOIN materials m ON m.id=i.material_id WHERE s.ticket_id=?`, [req.params.id]);
    const [[tr]] = await pool.query('SELECT COUNT(*) n FROM surat_jalan WHERE ticket_id=?', [req.params.id]);
    res.json({ rows, total: n, pages: Math.ceil(n / lim), totals: { trips: tr.n, qty: +t.qty, net: +t.net, gross: +t.gross } });
  }));

  // material yang masih punya sisa qty untuk dikirim (ex = SJ yang sedang diedit)
  app.get('/api/ho/tickets/:id/available', wrap(async (req, res) => {
    const q = `%${req.query.q || ''}%`, ex = +req.query.ex || 0;
    const [rows] = await pool.query(`SELECT * FROM (SELECT m.id,m.product_no,m.description,m.spec,m.bl_no,m.qty,m.unit,m.net_weight,m.gross_weight,m.destination,m.check_status,
      m.qty-(SELECT COALESCE(SUM(i.qty),0) FROM surat_jalan_items i WHERE i.material_id=m.id AND i.sj_id<>?) remain
      FROM materials m WHERE m.ticket_id=? AND (m.product_no LIKE ? OR m.description LIKE ? OR m.destination LIKE ?)) x WHERE remain>0 ORDER BY id LIMIT 50`, [ex, req.params.id, q, q, q]);
    res.json(rows);
  }));

  async function sjItems(conn, sjid, tid, items) {
    if (!Array.isArray(items) || !items.length) throw new Error('Tambahkan minimal 1 material');
    const ids = items.map(i => +i.material_id);
    if (new Set(ids).size !== ids.length) throw new Error('Material duplikat dalam Surat Jalan');
    const [ms] = await conn.query(`SELECT m.id,m.product_no,m.qty,m.ticket_id,
      (SELECT COALESCE(SUM(i.qty),0) FROM surat_jalan_items i WHERE i.material_id=m.id AND i.sj_id<>?) used FROM materials m WHERE m.id IN (?) FOR UPDATE`, [sjid, ids]);
    for (const it of items) {
      const m = ms.find(x => x.id === +it.material_id);
      if (!m || m.ticket_id !== tid) throw new Error('Material tidak valid');
      if (!(+it.qty >= 1) || +it.qty > m.qty - m.used) throw new Error(`Qty ${m.product_no} melebihi sisa (${m.qty - m.used})`);
      if (!(num(it.weight) >= 0)) throw new Error('Weight tidak valid');
    }
    await conn.query('DELETE FROM surat_jalan_items WHERE sj_id=?', [sjid]);
    await conn.query('INSERT INTO surat_jalan_items (sj_id,material_id,qty,weight) VALUES ?', [items.map(i => [sjid, +i.material_id, +i.qty, num(i.weight)])]);
  }
  const sjHead = b => {
    if (!String(b.nopol || '').trim() || !String(b.driver || '').trim()) throw new Error('Nomor polisi dan nama driver wajib diisi');
    return [String(b.nopol).trim().toUpperCase(), String(b.driver).trim(), b.phone || null, b.vendor_id || null, b.entry_at || null, b.exit_at || null];
  };

  app.post('/api/ho/tickets/:id/sj', wrap(async (req, res) => {
    const tid = +req.params.id, b = req.body, conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const h = sjHead(b), d = new Date(), ym = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}`;
      const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM surat_jalan WHERE sj_no LIKE ? FOR UPDATE', [ym + '%']);
      const no = `${ym}${pad(+n + 1, 4)}`;
      const start = b.start_at && !isNaN(Date.parse(b.start_at)) ? new Date(b.start_at) : d;
      const [r] = await conn.query('INSERT INTO surat_jalan (sj_no,ticket_id,nopol,driver,phone,vendor_id,entry_at,exit_at,start_at,finish_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)',
        [no, tid, ...h, start, req.user.name]);
      await sjItems(conn, r.insertId, tid, b.items);
      await conn.commit();
      await refresh(tid);
      res.json({ id: r.insertId, sj_no: no });
    } catch (e) { await conn.rollback(); return bad(res, e.message); } finally { conn.release(); }
  }));

  app.put('/api/sj/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query('SELECT ticket_id FROM surat_jalan WHERE id=?', [req.params.id]);
    if (!s) return res.sendStatus(404);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE surat_jalan SET nopol=?,driver=?,phone=?,vendor_id=?,entry_at=?,exit_at=? WHERE id=?', [...sjHead(req.body), req.params.id]);
      if (req.body.items) await sjItems(conn, +req.params.id, s.ticket_id, req.body.items);
      await conn.commit();
      await refresh(s.ticket_id);
      res.json({ ok: true });
    } catch (e) { await conn.rollback(); return bad(res, e.message); } finally { conn.release(); }
  }));

  app.get('/api/sj/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query(`${SJSEL} WHERE s.id=? GROUP BY s.id`, [req.params.id]);
    if (!s) return res.sendStatus(404);
    [s.items] = await pool.query(`SELECT i.id,i.material_id,i.qty,i.weight,m.product_no,m.description,m.spec,m.bl_no,m.unit,m.qty mat_qty,m.destination,m.origin,m.check_status,m.jo_id,j.jo_no
      FROM surat_jalan_items i JOIN materials m ON m.id=i.material_id JOIN job_orders j ON j.id=m.jo_id WHERE i.sj_id=? ORDER BY i.id`, [s.id]);
    [s.photos] = await pool.query('SELECT id,path FROM sj_photos WHERE sj_id=?', [s.id]);
    const [[t]] = await pool.query(`SELECT t.ticket_no,u.name pic_name,u.employee_no FROM ho_tickets t JOIN users u ON u.id=t.pic_id WHERE t.id=?`, [s.ticket_id]);
    Object.assign(s, t);
    const jids = [...new Set(s.items.map(i => i.jo_id))];
    s.jos = jids.length ? (await pool.query(`SELECT j.jo_no,j.invoice_no,j.bl_no,j.vessel,j.party,j.weight,j.aju_no,c.name customer_name FROM job_orders j JOIN customers c ON c.id=j.customer_id WHERE j.id IN (?)`, [jids]))[0] : [];
    res.json(s);
  }));

  app.delete('/api/sj/:id', wrap(async (req, res) => {
    const [[s]] = await pool.query('SELECT ticket_id FROM surat_jalan WHERE id=?', [req.params.id]);
    if (!s) return res.json({ ok: true });
    const [ph] = await pool.query('SELECT path FROM sj_photos WHERE sj_id=?', [req.params.id]);
    await pool.query('DELETE FROM surat_jalan WHERE id=?', [req.params.id]);
    ph.forEach(p => rmFile(p.path));
    await refresh(s.ticket_id);
    res.json({ ok: true });
  }));

  app.post('/api/sj/:id/photos', wrap(async (req, res) => {
    const [[n]] = await pool.query('SELECT COUNT(*) n FROM sj_photos WHERE sj_id=?', [req.params.id]);
    if (n.n >= 3) return bad(res, 'Maksimal 3 foto');
    const f = saveImg(req.body, 'sj');
    if (!f) return bad(res, 'File harus gambar (jpg/png/webp) maks 8 MB');
    await pool.query('INSERT INTO sj_photos (sj_id,path) VALUES (?,?)', [req.params.id, f]);
    res.json({ ok: true });
  }));
  app.delete('/api/sj-photos/:id', wrap(async (req, res) => {
    const [[p]] = await pool.query('SELECT path FROM sj_photos WHERE id=?', [req.params.id]);
    if (p) { rmFile(p.path); await pool.query('DELETE FROM sj_photos WHERE id=?', [req.params.id]); }
    res.json({ ok: true });
  }));

  /* ---------- Report export ---------- */
  app.get('/api/ho/tickets/:id/export', wrap(async (req, res) => {
    const [rows] = await pool.query(`${MSEL} WHERE m.ticket_id=? ORDER BY m.id`, [req.params.id]);
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, st = { NOT_CHECKED: '-', OK: 'OK', DAMAGE: 'DM' };
    const head = ['JO', 'Product/Container No', 'Description', 'Spec', 'Thickness', 'Width', 'No. BL', 'Net Weight', 'Gross Weight', 'Qty', 'Satuan', 'Dari', 'Tujuan', 'Status', 'Remarks', 'Surat Jalan'];
    res.type('text/csv').send('﻿' + [head.join(','), ...rows.map(r => [r.jo_no, r.product_no, r.description, r.spec, r.thickness, r.width, r.bl_no, r.net_weight, r.gross_weight, r.qty, r.unit, r.origin, r.destination, st[r.check_status], r.remarks, r.sj_nos].map(cell).join(','))].join('\r\n'));
  }));

  app.get('/api/ho/tickets/:id/report-text', wrap(async (req, res) => {
    const [[t]] = await pool.query(`SELECT * FROM (${PROG}) q WHERE id=?`, [req.params.id]);
    if (!t) return res.sendStatus(404);
    const [[m]] = await pool.query(`SELECT SUM(check_status='OK') ok, SUM(check_status='DAMAGE') dm, SUM(check_status='NOT_CHECKED') nc FROM materials WHERE ticket_id=?`, [t.id]);
    const [sj] = await pool.query(`${SJSEL} WHERE s.ticket_id=? GROUP BY s.id ORDER BY s.id`, [t.id]);
    const n = v => Number(v || 0).toLocaleString('id-ID');
    res.json({ text: [`HANDLING OPS - ${t.ticket_no}`, `PIC: ${t.pic_name}`, `Customer: ${t.customer}`, `Vessel: ${t.vessel || '-'}`, `Party: ${t.party || '-'} | Weight: ${n(t.weight)} ton`,
      `Report Material: ${t.mat_pct}% (OK ${m.ok || 0}, Damage ${m.dm || 0}, Belum dicek ${m.nc || 0})`, `Trucking Delivery: ${t.del_pct}% (${sj.length} trip, ${n(t.qty_sent)}/${n(t.qty_total)} qty)`,
      ...sj.map((s, i) => `${i + 1}. ${s.nopol} ${s.driver} (${s.vendor_code || '-'}) SJ ${s.sj_no} - ${s.qty} ${s.unit || ''} - ${n(s.net_weight)} kg -> ${s.destination || '-'}`)].join('\n') });
  }));
};
