// API publik driver (tanpa login): /api/pub/d/:token. Akses = token tautan (HMAC + nonce) + verifikasi 4 angka nopol, lalu sesi bertanda tangan per surat jalan.
// Hanya aksi status dan unggah foto bukti terima. Tidak ada data customer/berat/nama. Token tidak pernah ditulis ke log.
const express = require('express');
const cfg = require('../config'), { TRACKING } = require('../lib/rules');
const T = require('../lib/tracking'), D = require('../lib/tracking-db'), files = require('../lib/files'), { loginLimiter } = require('../lib/authz');
const { tx } = require('../lib/http');

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, extra });
module.exports = pool => {
  const r = express.Router(), limiter = loginLimiter({ max: 30, windowMs: 15 * 60 * 1000 });   // per IP: token salah/verifikasi gagal
  r.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }); next(); });
  r.use(express.json({ limit: '12mb' }));
  const handler = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    if (e.status) return res.status(e.status).json({ error: e.message, ...e.extra });
    console.error('[driver] kesalahan:', e.message);                                           // hanya pesan, tanpa URL/token
    res.status(500).json({ error: 'Terjadi kesalahan' });
  });
  const bad = (req) => { limiter.fail(req.ip, 'bad:' + req.ip); return fail(404, 'Tautan tidak valid'); };       // sama untuk format salah / nonce salah / surat jalan tidak ada

  // token -> surat jalan (404 generik bila tidak valid)
  async function byToken(req, db = pool, lock = false) {
    if (limiter.blocked(req.ip, 'bad:' + req.ip)) throw fail(429, 'Terlalu banyak percobaan, coba lagi nanti');
    const p = T.parseToken(req.params.token); if (!p) throw bad(req);
    const dn = await D.loadDn(db, p.dnId, lock); if (!dn || !T.checkToken(p, dn.track_nonce, cfg.secret)) throw bad(req);
    return dn;
  }
  const readySession = (req, dn) => {
    const s = T.verifySession((req.headers.authorization || '').replace(/^Bearer /, ''), cfg.secret);
    if (!s || s.dnId !== dn.id || s.nonce !== dn.track_nonce) throw fail(401, 'Sesi berakhir, verifikasi ulang', { state: D.linkState(dn) });
    const st = D.linkState(dn); if (st !== 'aktif') throw fail(409, stateMsg[st], { state: st });
  };
  const stateMsg = { belum_siap: 'Surat jalan belum siap. Hubungi operasional.', terkunci: 'Tautan terkunci. Hubungi operasional.', dicabut: 'Tautan tidak berlaku. Hubungi operasional.', selesai: 'Pengiriman sudah selesai.' };
  const num = (v, lo, hi) => { const n = v === '' || v == null ? NaN : Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e6) / 1e6 : null; };
  const geo = b => { const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180); return lat != null && lng != null ? { lat, lng } : { lat: null, lng: null }; };
  const label = dn => `Driver ${dn.driver}`.slice(0, 100);
  const route = async dn => (await pool.query(`SELECT COALESCE(GROUP_CONCAT(DISTINCT m.origin SEPARATOR ', '), MAX(d.origin_address)) origin, COALESCE(GROUP_CONCAT(DISTINCT m.destination SEPARATOR ', '), MAX(d.destination)) destination,
    COUNT(i.id) items, COALESCE(SUM(i.qty),0) qty, COALESCE(SUM(i.weight),0) kg FROM delivery_notes d LEFT JOIN delivery_note_items i ON i.dn_id=d.id LEFT JOIN jo_materials m ON m.id=i.material_id WHERE d.id=?`, [dn.id]))[0][0];

  // info publik minimal: no. surat jalan, rute, status tautan
  r.get('/:token', handler(async (req, res) => {
    const dn = await byToken(req), rt = await route(dn);
    res.json({ no_sj: dn.no_sj, from: rt.origin || null, to: rt.destination || null, state: D.linkState(dn) });
  }));

  r.post('/:token/verify', handler(async (req, res) => {
    const dn0 = await byToken(req), st = D.linkState(dn0);
    if (st !== 'aktif') throw fail(st === 'terkunci' ? 423 : 409, stateMsg[st], { state: st });
    const ok = await tx(pool, async conn => {
      const dn = await D.loadDn(conn, dn0.id, true);
      if (dn.link_locked) return { locked: true };
      if (T.matchNopol(req.body && req.body.digits, dn.nopol)) {
        await conn.query('UPDATE delivery_notes SET verify_fails=0, link_opened_at=COALESCE(link_opened_at, NOW()), link_verified_at=NOW() WHERE id=?', [dn.id]); return { ok: true, dn };
      }
      const fails = dn.verify_fails + 1, locked = fails >= TRACKING.MAX_VERIFY_FAILS;
      await conn.query('UPDATE delivery_notes SET verify_fails=?, link_locked=? WHERE id=?', [fails, locked ? 1 : 0, dn.id]);
      return { locked, left: Math.max(0, TRACKING.MAX_VERIFY_FAILS - fails) };
    });
    if (ok.ok) return res.json({ session: T.signSession({ dnId: ok.dn.id, nonce: ok.dn.track_nonce }, cfg.secret), expires_in: Math.floor(TRACKING.SESSION_TTL_MS / 1000) });
    limiter.fail(req.ip, 'bad:' + req.ip);
    if (ok.locked) throw fail(423, stateMsg.terkunci, { state: 'terkunci' });
    throw fail(401, 'Angka tidak cocok', { left: ok.left });
  }));

  r.get('/:token/sj', handler(async (req, res) => {
    const dn = await byToken(req); readySession(req, dn);
    const rt = await route(dn), evs = (await D.events(pool, dn.id)).filter(e => !e.voided_at);
    res.json({ no_sj: dn.no_sj, nopol: dn.nopol, from: rt.origin || null, to: rt.destination || null, items: +rt.items, qty: +rt.qty, ton: Math.round(+rt.kg) / 1000, status: dn.track_status, label: T.LABELS[dn.track_status], own_fleet: !!dn.is_own_fleet,
      timeline: evs.map(e => ({ status: e.status, label: T.LABELS[e.status], at: new Date(e.at_ms).toISOString(), skipped: e.skipped })),
      next: T.nextAllowed(dn.track_status, !!dn.is_own_fleet).map(n => ({ status: n.status, label: T.LABELS[n.status], skips: n.skips, deliver: n.status === 'DELIVERED' })) });
  }));

  r.post('/:token/step', handler(async (req, res) => {
    const b = req.body || {}, to = b.status;
    if (!T.DRIVER_STEPS.includes(to)) throw fail(400, 'Langkah tidak valid');
    if (to === 'DELIVERED') throw fail(400, 'Bukti terima (foto) wajib untuk menandai Diterima');
    const pre = await byToken(req); readySession(req, pre);
    const out = await tx(pool, async conn => {
      const dn = await D.loadDn(conn, pre.id, true); readySession(req, dn);
      if (dn.track_status === to) return { already: true, status: to };                              // tekan ganda
      const r1 = T.canTransition({ from: dn.track_status, to, actor: 'DRIVER', ownFleet: !!dn.is_own_fleet });
      if (!r1.ok) throw fail(409, r1.error, { status: dn.track_status });
      await D.applyStep(conn, dn, { to, actor: 'DRIVER', label: label(dn), ...geo(b) });
      return { status: to };
    });
    res.json({ ok: true, ...out, label: T.LABELS[out.status] });
  }));

  r.post('/:token/deliver', handler(async (req, res) => {
    const b = req.body || {}, pre = await byToken(req); readySession(req, pre);
    if (!b.data || !b.filename) throw fail(400, 'Foto bukti terima wajib dilampirkan');
    const buffer = files.fromBase64(b.data); if (!buffer.length) throw fail(400, 'Foto bukti terima wajib dilampirkan');
    const err = files.validate(String(b.filename), buffer.length, { imagesOnly: true }); if (err) throw fail(400, err);
    const receiver = String(b.receiver_name ?? '').trim().slice(0, 100) || null;
    const out = await tx(pool, async conn => {
      const dn = await D.loadDn(conn, pre.id, true); readySession(req, dn);
      if (dn.track_status === 'DELIVERED') return { already: true };                                  // unggah/tekan ganda
      const c = T.canTransition({ from: dn.track_status, to: 'DELIVERED', actor: 'DRIVER', ownFleet: !!dn.is_own_fleet });
      if (!c.ok) throw fail(409, c.error, { status: dn.track_status });
      await files.create(conn, { ownerType: 'delivery_note', ownerId: dn.id, kind: 'pod', filename: String(b.filename), buffer, imagesOnly: true, prefix: 'pod-' });
      await D.applyStep(conn, dn, { to: 'DELIVERED', actor: 'DRIVER', label: label(dn), ...geo(b) });
      if (receiver) await conn.query('UPDATE delivery_notes SET received_by=? WHERE id=?', [receiver, dn.id]);
      return { already: false };
    });
    res.json({ ok: true, status: 'DELIVERED', label: T.LABELS.DELIVERED, already: out.already });
  }));

  r.use('/:token', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));
  r.use((err, req, res, next) => res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'Foto terlalu besar' : 'Permintaan tidak valid' }));   // tanpa jejak tumpukan
  return r;
};
