// Check In & Daily Report milik pegawai sendiri. Selalu dibatasi ke req.user.id (tidak ada parameter user). Waktu dan tanggal dari SERVER (WIB).
const express = require('express');
const { wrap, httpError, tx } = require('../lib/http');
const files = require('../lib/files');
const C = require('../lib/checkin');

const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const MAX_ITEMS_PER_DAY = 50;
const num = v => (v === '' || v == null ? null : Number(v));

// baris absensi -> bentuk API (jam dalam WIB)
const shapeAtt = (a, photoBase = '/api/checkin/photo/') => !a ? null : { has_photo: !!a.photo_file_id, photo_url: a.photo_file_id ? photoBase + a.id : null, id: a.id, work_date: a.work_date, status: a.status, status_label: C.STATUSES[a.status].label, source: a.source, note: a.note,
  check_in_at: a.check_in_at ? C.toWibIso(a.check_in_at) : null, time: a.check_in_at ? C.wib(a.check_in_at).hm : null,
  late: !!(a.check_in_at && C.STATUSES[a.status].present && C.isLate(a.check_in_at)),
  lat: a.lat == null ? null : +a.lat, lng: a.lng == null ? null : +a.lng, accuracy_m: a.accuracy_m, maps_url: a.lat == null ? null : C.mapsUrl(+a.lat, +a.lng) };
const shapeItem = i => ({ id: i.id, work_date: i.work_date, start_time: C.hm(i.start_time), end_time: i.end_time ? C.hm(i.end_time) : null, activity: i.activity });
exports.shapeAtt = shapeAtt; exports.shapeItem = shapeItem;
exports.sendPhoto = async (pool, res, att) => {
  if (!att || !att.photo_file_id) throw httpError(404, 'Foto tidak ada');
  const [[f]] = await pool.query('SELECT path, mime FROM files WHERE id=?', [att.photo_file_id]);
  if (!f) throw httpError(404, 'Foto tidak ada');
  res.type(f.mime); res.set('Cache-Control', 'private, max-age=3600'); res.sendFile(files.diskPath(f.path));
};

exports.router = (pool, { now = () => new Date() } = {}) => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const today = () => C.wibDate(now());
  const items = (uid, from, to) => q('SELECT * FROM daily_report_items WHERE user_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date, start_time, id', [uid, from, to]);

  r.get('/today', wrap(async (req, res) => {
    const t = now(), d = C.wibDate(t), att = await one('SELECT * FROM attendance WHERE user_id=? AND work_date=?', [req.user.id, d]);
    res.json({ server_time: C.toWibIso(t), server_ms: t.getTime(), date: d, work_start: C.WORK_START, photo_required: C.PHOTO_REQUIRED,
      user: { id: req.user.id, name: req.user.name, employee_no: req.user.employee_no || '' },
      attendance: shapeAtt(att), report: (await items(req.user.id, d, d)).map(shapeItem) });
  }));

  r.post('/', wrap(async (req, res) => {
    const b = req.body || {}, status = String(b.status ?? '');
    if (!C.SELF_STATUSES.includes(status)) throw invalid('status', 'Pilih WFO atau WFH');
    let lat = num(b.lat), lng = num(b.lng), acc = num(b.accuracy);
    if ((lat == null) !== (lng == null)) throw invalid('lat', 'Lokasi tidak lengkap');
    if (lat != null && !(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw invalid('lat', 'Koordinat lokasi tidak valid');
    if (lat == null) { lat = lng = acc = null; }                                                  // lokasi tidak dibagikan: boleh
    else { lat = +lat.toFixed(7); lng = +lng.toFixed(7); acc = acc != null && Number.isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 1000000) : null; }
    // foto bukti: gambar sungguhan (dicek dari byte awal), maks 8 MB; wajib bila C.PHOTO_REQUIRED
    const ph = b.photo && b.photo.data ? b.photo : null;
    if (!ph && C.PHOTO_REQUIRED) throw invalid('photo', 'Foto bukti wajib diambil');
    let buf = null, kind = null;
    if (ph) {
      buf = files.fromBase64(ph.data); kind = C.sniffImage(buf);
      if (!kind) throw invalid('photo', 'Foto harus berupa gambar (JPG, PNG, atau WEBP)');
      if (buf.length > C.PHOTO_MAX_MB * 1024 * 1024) throw invalid('photo', `Ukuran foto maksimal ${C.PHOTO_MAX_MB} MB`);
    }
    const t = now(), d = C.wibDate(t);                                                            // tanggal klien tidak dipakai
    const ex = await one('SELECT * FROM attendance WHERE user_id=? AND work_date=?', [req.user.id, d]);
    const dup = e => httpError(409, e.source === 'HR' ? `Absensi hari ini sudah diinput HR (${e.status}).` : `Anda sudah check in hari ini${e.check_in_at ? ' pukul ' + C.wib(e.check_in_at).hm : ''}.`);
    if (ex) throw dup(ex);
    let id;
    try {
      id = await tx(pool, async conn => {                                                           // absensi + foto: satu transaksi
        const [ins] = await conn.query("INSERT INTO attendance (user_id, work_date, status, check_in_at, lat, lng, accuracy_m, source, created_by, updated_by) VALUES (?,?,?,?,?,?,?,'SELF',?,?)", [req.user.id, d, status, t, lat, lng, acc, req.user.id, req.user.id]);
        if (buf) {
          const fid = await files.create(conn, { ownerType: 'attendance', ownerId: ins.insertId, kind: 'photo', filename: `att-${req.user.id}-${d}.${kind}`, buffer: buf, user: req.user, imagesOnly: true, prefix: 'att-' });
          await conn.query('UPDATE attendance SET photo_file_id=? WHERE id=?', [fid, ins.insertId]);
        }
        return ins.insertId;
      });
    } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw dup(await one('SELECT * FROM attendance WHERE user_id=? AND work_date=?', [req.user.id, d]) || {}); throw e; }
    const a = shapeAtt(await one('SELECT * FROM attendance WHERE id=?', [id]));
    res.json({ attendance: a, late: a.late });
  }));

  r.get('/history', wrap(async (req, res) => {
    const to = req.query.to || today(), from = req.query.from || C.addDays(to, -(C.HISTORY_DEFAULT_DAYS - 1)), err = C.checkRange(from, to);
    if (err) throw invalid(C.isDate(from) ? 'to' : 'from', err);
    const atts = await q('SELECT * FROM attendance WHERE user_id=? AND work_date BETWEEN ? AND ?', [req.user.id, from, to]), its = await items(req.user.id, from, to);
    const days = C.eachDate(from, to).reverse().map(d => ({ date: d, weekday: C.isWeekday(d), attendance: shapeAtt(atts.find(a => a.work_date === d)), report: its.filter(i => i.work_date === d).map(shapeItem) }));
    res.json({ from, to, today: today(), days });
  }));

  // foto bukti: hanya milik sendiri (HR lewat /api/checkin-rekap/photo/:id)
  r.get('/photo/:id(\\d+)', wrap(async (req, res) => {
    const a = await one('SELECT id, photo_file_id FROM attendance WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    await exports.sendPhoto(pool, res, a);
  }));

  r.post('/report', wrap(async (req, res) => {
    const c = C.checkReport(req.body || {}); if (c.fields) throw Object.assign(httpError(400, Object.values(c.fields)[0]), { fields: c.fields });
    const d = today();
    if ((await one('SELECT COUNT(*) n FROM daily_report_items WHERE user_id=? AND work_date=?', [req.user.id, d])).n >= MAX_ITEMS_PER_DAY) throw httpError(400, `Maksimal ${MAX_ITEMS_PER_DAY} baris kegiatan per hari`);
    const [ins] = await pool.query('INSERT INTO daily_report_items (user_id, work_date, start_time, end_time, activity, created_by, updated_by) VALUES (?,?,?,?,?,?,?)',
      [req.user.id, d, c.values.start_time, c.values.end_time, c.values.activity, req.user.id, req.user.id]);
    res.json({ id: ins.insertId });
  }));

  r.put('/report/:id(\\d+)', wrap(async (req, res) => {
    const it = await one('SELECT * FROM daily_report_items WHERE id=?', [req.params.id]);
    if (!it || it.user_id !== req.user.id) throw httpError(403, 'Tidak punya akses');           // baris milik orang lain: sama dengan tidak ada
    if (it.work_date !== today()) throw httpError(403, 'Laporan hari sebelumnya hanya bisa dilihat');
    const c = C.checkReport(req.body || {}); if (c.fields) throw Object.assign(httpError(400, Object.values(c.fields)[0]), { fields: c.fields });
    await pool.query('UPDATE daily_report_items SET start_time=?, end_time=?, activity=?, updated_by=? WHERE id=?', [c.values.start_time, c.values.end_time, c.values.activity, req.user.id, it.id]);
    res.json({ ok: true });
  }));
  return r;
};
