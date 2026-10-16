// API operasional tracking surat jalan (di bawah /api/ho, dijaga izin ho). Aturan: lib/tracking.js; DB: lib/tracking-db.js.
const T = require('../lib/tracking'), D = require('../lib/tracking-db'), audit = require('../lib/audit'), sjLink = require('../lib/sj-link'), qr = require('../lib/qr');
const { wrap, httpError, tx } = require('../lib/http');

module.exports = (r, pool) => {
  const reasonOf = (b, msg = 'Alasan wajib diisi') => { const s = String(b.reason ?? '').trim(); if (!s) throw httpError(400, msg); return s.slice(0, 255); };
  const lockDn = async (conn, id) => { const dn = await D.loadDn(conn, id, true); if (!dn) throw httpError(404, 'Surat jalan tidak ditemukan'); return dn; };
  const driverUrl = (req, dn) => `${sjLink.baseUrl(req)}/d/${D.driverToken(dn)}`;

  async function detail(req, id) {
    const dn = await D.loadDn(pool, id); if (!dn) return null;
    const evs = await D.events(pool, id), live = evs.filter(e => !e.voided_at), w = T.warnings({ status: dn.track_status, status_at: dn.status_at_ms }, evs, dn.now_ms);
    const steps = T.STATUSES.map(s => { const e = live.filter(x => x.status === s).at(-1); return { status: s, label: T.LABELS[s], state: e ? (e.skipped ? 'skipped' : s === dn.track_status ? 'current' : 'done') : s === dn.track_status ? 'current' : 'todo', event: e || null, needs_check: w.needsCheck.includes(s) }; });
    const undo = T.undoPlan(evs), state = D.linkState(dn);
    const [[pod]] = [(await pool.query("SELECT id, path, filename FROM files WHERE owner_type='delivery_note' AND kind='pod' AND owner_id=? ORDER BY id DESC LIMIT 1", [id]))[0]];
    return { id: dn.id, ticket_id: dn.ticket_id, no_sj: dn.no_sj, nopol: dn.nopol, driver: dn.driver, status: dn.track_status, label: T.LABELS[dn.track_status], status_at: dn.status_at_ms ? new Date(+dn.status_at_ms).toISOString() : null, own_fleet: !!dn.is_own_fleet,
      warnings: { needs_check: w.needsCheck, stalled: w.stalled, held_min: Math.floor(w.heldMs / 60000) }, steps, events: evs.map(e => ({ ...e, at: new Date(e.at_ms).toISOString(), at_ms: undefined })),
      link: { url: driverUrl(req, dn), state, opened_at: dn.link_opened_at, verified_at: dn.link_verified_at, fails: dn.verify_fails, locked: !!dn.link_locked, revoked: !!dn.link_revoked_at, legacy: dn.origin === 'LEGACY', has_phone: !!String(dn.phone || '').trim(), phone: dn.phone },
      can: { ready: dn.track_status === 'PLANNING' && !!String(dn.driver || '').trim() && /\d/.test(dn.nopol || ''), steps: T.nextAllowed(dn.track_status, !!dn.is_own_fleet).map(n => n.status), complete: dn.track_status === 'DELIVERED', reopen: dn.track_status === 'COMPLETED',
        undo: undo.ok && dn.track_status !== 'COMPLETED' && undo.status !== 'COMPLETED' }, pod: pod || null, received_by: dn.received_by };
  }

  r.get('/sj/:id/tracking', wrap(async (req, res) => { const d = await detail(req, +req.params.id); return d ? res.json(d) : res.sendStatus(404); }));

  r.post('/sj/:id/ready', wrap(async (req, res) => {
    await tx(pool, async conn => {
      const dn = await lockDn(conn, +req.params.id);
      if (!String(dn.driver || '').trim() || !/\d/.test(dn.nopol || '')) throw httpError(400, 'Nama driver dan nomor polisi (memuat angka) wajib diisi sebelum Ready');
      await D.applyStep(conn, dn, { to: 'READY', actor: 'OPS', user: req.user, label: req.user.name });
    });
    res.json(await detail(req, +req.params.id));
  }));

  r.post('/sj/:id/tracking/step', wrap(async (req, res) => {
    const b = req.body || {}; if (!T.DRIVER_STEPS.includes(b.status)) throw httpError(400, 'Status langkah driver tidak valid');
    await tx(pool, async conn => { const dn = await lockDn(conn, +req.params.id); await D.applyStep(conn, dn, { to: b.status, actor: 'OPS', user: req.user, label: req.user.name, note: b.note, at: b.at, lat: null, lng: null }); });
    res.json(await detail(req, +req.params.id));
  }));

  r.post('/sj/:id/tracking/undo', wrap(async (req, res) => {
    const reason = reasonOf(req.body || {});
    await tx(pool, async conn => {
      const dn = await lockDn(conn, +req.params.id);
      if (dn.track_status === 'COMPLETED') throw httpError(400, 'Surat jalan Completed terkunci; buka kembali dulu');
      const evs = await D.events(conn, dn.id), plan = T.undoPlan(evs);
      if (!plan.ok) throw httpError(400, plan.error);
      if (plan.status === 'COMPLETED') throw httpError(400, 'Langkah ini tidak bisa dibatalkan (sebelumnya Completed)');
      await conn.query('UPDATE delivery_note_events SET voided_at=NOW(), voided_by=?, void_reason=? WHERE id IN (?)', [req.user.id, reason, plan.ids]);
      const prev = evs.filter(e => !e.voided_at && !plan.ids.includes(e.id)).at(-1);
      await conn.query('UPDATE delivery_notes SET track_status=?, track_status_at=? WHERE id=?', [plan.status, prev ? new Date(prev.at_ms) : null, dn.id]);
      await audit.log(conn, { entity: 'ticket', id: dn.ticket_id, action: 'Tracking dibatalkan', note: `${dn.no_sj}: ${T.LABELS[dn.track_status]} → ${T.LABELS[plan.status]} (${reason})`, user: req.user });
    });
    res.json(await detail(req, +req.params.id));
  }));

  r.post('/sj/:id/complete', wrap(async (req, res) => {
    await tx(pool, async conn => { const dn = await lockDn(conn, +req.params.id); await D.applyStep(conn, dn, { to: 'COMPLETED', actor: 'OPS', user: req.user, label: req.user.name }); });
    res.json(await detail(req, +req.params.id));
  }));

  r.post('/sj/:id/reopen', wrap(async (req, res) => {
    const reason = reasonOf(req.body || {});
    await tx(pool, async conn => {
      const dn = await lockDn(conn, +req.params.id), ok = T.canReopen(dn.track_status, reason); if (!ok.ok) throw httpError(400, ok.error);
      await conn.query("INSERT INTO delivery_note_events (dn_id, status, source, by_user_id, by_label, manual, note) VALUES (?, 'DELIVERED', 'OPS', ?, ?, 1, ?)", [dn.id, req.user.id, req.user.name, `Dibuka kembali: ${reason}`.slice(0, 255)]);
      await conn.query("UPDATE delivery_notes SET track_status='DELIVERED', track_status_at=NOW(), completed_at=NULL, completed_by=NULL WHERE id=?", [dn.id]);
      await audit.log(conn, { entity: 'ticket', id: dn.ticket_id, action: 'Surat jalan dibuka kembali', note: `${dn.no_sj}: ${reason}`, user: req.user });
    });
    res.json(await detail(req, +req.params.id));
  }));

  const linkAction = (action, run) => wrap(async (req, res) => {
    await tx(pool, async conn => { const dn = await lockDn(conn, +req.params.id); await run(conn, dn); await audit.log(conn, { entity: 'ticket', id: dn.ticket_id, action, note: dn.no_sj, user: req.user }); });
    res.json(await detail(req, +req.params.id));
  });
  r.post('/sj/:id/tracking/link/revoke', linkAction('Tautan driver dicabut', (c, dn) => c.query('UPDATE delivery_notes SET link_revoked_at=NOW() WHERE id=?', [dn.id])));
  r.post('/sj/:id/tracking/link/regenerate', linkAction('Tautan driver dibuat ulang', (c, dn) => {
    if (dn.origin === 'LEGACY') throw httpError(400, 'Surat jalan data lama tidak punya tautan driver');
    return c.query('UPDATE delivery_notes SET track_nonce=?, link_revoked_at=NULL, link_opened_at=NULL, link_verified_at=NULL, verify_fails=0, link_locked=0 WHERE id=?', [T.newNonce(), dn.id]);
  }));
  r.post('/sj/:id/tracking/link/unlock', linkAction('Tautan driver dibuka kuncinya', (c, dn) => c.query('UPDATE delivery_notes SET verify_fails=0, link_locked=0 WHERE id=?', [dn.id])));

  r.get('/sj/:id/qr.svg', wrap(async (req, res) => {
    const dn = await D.loadDn(pool, +req.params.id); if (!dn) return res.sendStatus(404);
    if (D.linkState(dn) === 'dicabut') throw httpError(400, 'Tautan driver dicabut atau tidak tersedia');
    res.set('Cache-Control', 'no-store').type('image/svg+xml').send(qr.svg(driverUrl(req, dn), 6));
  }));
  r.tracking = { detail };
};
