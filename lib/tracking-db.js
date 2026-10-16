// Tracking surat jalan: akses DB bersama (API operasional dan publik). Aturan murni ada di lib/tracking.js.
const T = require('./tracking'), cfg = require('../config'), audit = require('./audit'), { httpError } = require('./http');

const DN_SQL = `SELECT d.id, d.ticket_id, d.no_sj, d.nopol, d.driver, d.phone, d.vendor_id, d.origin, d.track_status, d.track_nonce, d.link_revoked_at, d.link_opened_at, d.link_verified_at, d.verify_fails, d.link_locked,
  d.received_by, d.completed_at, d.finish_loading, UNIX_TIMESTAMP(d.track_status_at)*1000 status_at_ms, UNIX_TIMESTAMP(NOW())*1000 now_ms, COALESCE(v.is_own_fleet,0) is_own_fleet
  FROM delivery_notes d LEFT JOIN vendors v ON v.id=d.vendor_id`;
async function loadDn(db, id, lock = false) { return (await db.query(`${DN_SQL} WHERE d.id=?${lock ? ' FOR UPDATE OF d' : ''}`, [id]))[0][0] || null; }
const EV_SQL = 'SELECT id, dn_id, status, source, by_user_id, by_label, at, UNIX_TIMESTAMP(at)*1000 at_ms, manual, lat, lng, skipped, note, voided_at, void_reason FROM delivery_note_events';
const norm = e => ({ ...e, at: e.at_ms, manual: !!e.manual, skipped: !!e.skipped });          // at = ms epoch (bebas zona waktu) untuk perhitungan
async function events(db, dnId) { return (await db.query(`${EV_SQL} WHERE dn_id=? ORDER BY id`, [dnId]))[0].map(norm); }

// state tautan driver
function linkState(d) {
  if (d.origin === 'LEGACY' || d.link_revoked_at) return 'dicabut';
  if (d.track_status === 'COMPLETED') return 'selesai';
  if (d.link_locked) return 'terkunci';
  return d.track_status === 'PLANNING' ? 'belum_siap' : 'aktif';
}
const driverToken = d => T.makeToken(d.id, d.track_nonce, cfg.secret);

// satu langkah status. Dipanggil di dalam transaksi dengan dn yang sudah dikunci (loadDn(..., true)).
async function applyStep(conn, dn, { to, actor, user, label, note, at, lat = null, lng = null, source }) {
  const r = T.canTransition({ from: dn.track_status, to, actor, ownFleet: !!dn.is_own_fleet, note });
  if (!r.ok) throw httpError(400, r.error);
  let atDate = null;
  if (at != null && at !== '') {
    atDate = new Date(at); if (isNaN(atDate)) throw httpError(400, 'Format waktu tidak valid');
    if (atDate.getTime() > dn.now_ms + 60000) throw httpError(400, 'Waktu kejadian tidak boleh di masa depan');
    const last = (await events(conn, dn.id)).filter(e => !e.voided_at).at(-1);
    if (last && atDate.getTime() < last.at_ms) throw httpError(400, 'Waktu kejadian tidak boleh lebih awal dari langkah sebelumnya');
  }
  const src = source || (actor === 'OPS' ? 'OPS' : 'DRIVER'), by = user?.id ?? null, noteTxt = note ? String(note).trim().slice(0, 255) : null;
  const ins = (status, skipped) => conn.query('INSERT INTO delivery_note_events (dn_id, status, source, by_user_id, by_label, at, manual, lat, lng, skipped, note) VALUES (?,?,?,?,?,IFNULL(?, NOW()),?,?,?,?,?)',
    [dn.id, status, src, by, label || null, atDate, r.manual ? 1 : 0, skipped ? null : lat, skipped ? null : lng, skipped ? 1 : 0, skipped ? 'Dilewati' : noteTxt]);
  for (const s of r.skipped) await ins(s, true);
  await ins(to, false);
  const sets = ['track_status=?', 'track_status_at=IFNULL(?, NOW())'], vals = [to, atDate];
  if (to === 'LOADED') { sets.push('finish_loading=COALESCE(finish_loading, IFNULL(?, NOW()))'); vals.push(atDate); }
  if (to === 'COMPLETED') { sets.push('completed_at=NOW()', 'completed_by=?'); vals.push(by); }
  await conn.query(`UPDATE delivery_notes SET ${sets.join(', ')} WHERE id=?`, [...vals, dn.id]);
  if (actor === 'OPS') await audit.log(conn, { entity: 'ticket', id: dn.ticket_id, action: 'Tracking surat jalan', note: `${dn.no_sj}: ${T.LABELS[dn.track_status]} → ${T.LABELS[to]}${r.manual ? ' (atas nama driver)' : ''}`, user });
  return { from: dn.track_status, to, skipped: r.skipped };
}

// ringkasan per surat jalan untuk daftar (status, langkah selesai, peringatan, tautan)
async function summarize(db, rows) {
  const ids = rows.map(r => r.id), byDn = new Map(ids.map(i => [i, []]));
  if (ids.length) for (const e of (await db.query(`${EV_SQL} WHERE dn_id IN (?) AND voided_at IS NULL ORDER BY id`, [ids]))[0]) byDn.get(e.dn_id).push(norm(e));
  return rows.map(r => {
    const w = T.warnings({ status: r.track_status, status_at: r.status_at_ms }, byDn.get(r.id) || [], r.now_ms);
    return { status: r.track_status, label: T.LABELS[r.track_status], status_at: r.status_at_ms ? new Date(+r.status_at_ms).toISOString() : null, steps_done: T.STATUSES.indexOf(r.track_status),
      needs_check: w.needsCheck, stalled: w.stalled, held_min: Math.floor(w.heldMs / 60000), link_state: linkState(r), link_opened: !!r.link_opened_at, own_fleet: !!r.is_own_fleet, received_by: r.received_by };
  });
}
module.exports = { loadDn, events, linkState, driverToken, applyStep, summarize, DN_SQL };
