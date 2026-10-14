// Rekap absensi untuk HR: semua pegawai per hari / periode, detail per pegawai, input/koreksi status, koreksi report, ekspor Excel.
const express = require('express');
const { wrap, httpError } = require('../lib/http');
const audit = require('../lib/audit');
const excel = require('../lib/excel');
const C = require('../lib/checkin');
const { shapeAtt, shapeItem } = require('./checkin');

const invalid = (field, message) => Object.assign(httpError(400, message), { fields: { [field]: message } });
const note = s => String(s).slice(0, 1000);

module.exports = (pool, { now = () => new Date() } = {}) => {
  const r = express.Router(), q = async (s, p) => (await pool.query(s, p))[0], one = async (s, p) => (await q(s, p))[0];
  const today = () => C.wibDate(now());
  const loadUsers = async () => (await q('SELECT id, name, employee_no, is_active, created_at FROM users')).map(u => ({ id: u.id, name: u.name, employee_no: u.employee_no, is_active: u.is_active, joined: C.wibDate(u.created_at) }));

  // parameter: date (harian) atau from+to (periode). Tanpa keduanya = hari ini.
  function range(qs) {
    let from, to;
    if (qs.date) from = to = String(qs.date); else if (qs.from || qs.to) { from = String(qs.from || ''); to = String(qs.to || ''); } else from = to = today();
    const err = C.checkRange(from, to); if (err) throw invalid(qs.date ? 'date' : (C.isDate(from) ? 'to' : 'from'), err);
    const status = String(qs.status || ''); if (status && !C.STATUS_CODES.includes(status)) throw invalid('status', 'Status tidak dikenal');
    return { from, to, status, q: String(qs.q || '') };
  }
  async function rekap(qs) {
    const f = range(qs), users = await loadUsers();
    const rows = await q('SELECT * FROM attendance WHERE work_date BETWEEN ? AND ?', [f.from, f.to]);
    const reports = f.from === f.to ? await q('SELECT * FROM daily_report_items WHERE work_date=? ORDER BY start_time, id', [f.from]) : [];
    const out = C.buildRekap({ users, rows, reports, from: f.from, to: f.to, today: today(), status: f.status, q: f.q });
    for (const x of out.rows) if (x.day) { x.day.lat = x.day.lat == null ? null : +x.day.lat; x.day.lng = x.day.lng == null ? null : +x.day.lng; x.day.maps_url = x.day.lat == null ? null : C.mapsUrl(x.day.lat, x.day.lng); }
    return { ...f, mode: f.from === f.to ? 'day' : 'period', today: today(), work_start: C.WORK_START, ...out };
  }

  r.get('/', wrap(async (req, res) => res.json(await rekap(req.query))));

  r.get('/export', wrap(async (req, res) => {
    const d = await rekap(req.query), day = d.mode === 'day';
    const columns = [{ header: 'No.', key: 'no', width: 6 }, { header: 'Nomor ID', key: 'id', width: 14 }, { header: 'Nama', key: 'name', width: 28 },
      { header: 'Attendance', key: 'att', width: 12 }, { header: 'Permit', key: 'permit', width: 10 }, { header: 'Alfa', key: 'alfa', width: 8 }, { header: 'Past', key: 'late', width: 8 }];
    if (day) columns.push({ header: 'Location', key: 'loc', width: 36 }, { header: 'Check In', key: 'time', width: 10 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Report', key: 'report', width: 60 });
    const rows = d.rows.map((x, i) => ({ no: i + 1, id: x.employee_no || '-', name: x.name, att: x.attendance, permit: x.permit, alfa: x.alfa, late: x.late,
      ...(day ? { loc: x.day?.maps_url || (x.day?.time ? 'Lokasi tidak dibagikan' : '-'), time: x.day?.time || '-', status: x.day ? x.day.status + (x.day.virtual ? ' (otomatis)' : '') : '-', report: x.report || '-' } : {}) }));
    await excel.send(res, `absensi-${d.from}${day ? '' : '_' + d.to}.xlsx`, [
      { name: day ? 'Rekap Harian' : 'Rekap Periode', columns, rows },
      { name: 'Total', columns: [{ header: 'Status', key: 's', width: 14 }, { header: 'Jumlah', key: 'n', width: 10 }], rows: Object.entries(d.totals).map(([s, n]) => ({ s: `Total ${s}`, n })) }]);
  }));

  r.get('/user/:id(\\d+)', wrap(async (req, res) => {
    const u = (await loadUsers()).find(x => x.id === +req.params.id); if (!u) throw httpError(404, 'Pegawai tidak ditemukan');
    const to = String(req.query.to || today()), from = String(req.query.from || C.addDays(to, -(C.HISTORY_DEFAULT_DAYS - 1))), err = C.checkRange(from, to);
    if (err) throw invalid(C.isDate(from) ? 'to' : 'from', err);
    const atts = await q('SELECT * FROM attendance WHERE user_id=? AND work_date BETWEEN ? AND ?', [u.id, from, to]);
    const its = await q('SELECT * FROM daily_report_items WHERE user_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date, start_time, id', [u.id, from, to]);
    const sum = { WFO: 0, WFH: 0, ALF: 0, SCK: 0, OTH: 0, late: 0 };
    const days = C.eachDate(from, to).reverse().map(d => {
      const row = atts.find(a => a.work_date === d), e = C.effectiveDay({ row, date: d, today: today(), active: !!u.is_active, joined: u.joined }), a = shapeAtt(row);
      if (e) sum[e.status]++; if (a?.late) sum.late++;
      return { date: d, weekday: C.isWeekday(d), status: e?.status || null, virtual: !!e?.virtual, attendance: a, report: its.filter(i => i.work_date === d).map(shapeItem) };
    });
    res.json({ user: { id: u.id, name: u.name, employee_no: u.employee_no || '', is_active: !!u.is_active }, from, to, today: today(), summary: sum, days });
  }));

  // Input / koreksi status oleh HR (membuat atau mengganti baris absensi, source=HR). Tanggal masa depan ditolak.
  r.put('/override', wrap(async (req, res) => {
    const b = req.body || {}, u = await one('SELECT id, name FROM users WHERE id=?', [+b.user_id || 0]);
    if (!u) throw invalid('user_id', 'Pegawai tidak ditemukan');
    const date = String(b.work_date ?? ''); if (!C.isDate(date)) throw invalid('work_date', 'Tanggal tidak valid');
    if (date > today()) throw invalid('work_date', 'Tanggal masa depan tidak bisa diinput');
    const status = String(b.status ?? ''); if (!C.STATUS_CODES.includes(status)) throw invalid('status', 'Status tidak valid');
    const nt = String(b.note ?? '').replace(/\s+/g, ' ').trim();
    if (C.NOTE_REQUIRED.includes(status) && !nt) throw invalid('note', `Keterangan wajib untuk ${status}`);
    if (nt.length > 255) throw invalid('note', 'Keterangan maksimal 255 karakter');
    const cur = await one('SELECT * FROM attendance WHERE user_id=? AND work_date=?', [u.id, date]);
    let id;
    if (cur) { await pool.query("UPDATE attendance SET status=?, note=?, source='HR', updated_by=? WHERE id=?", [status, nt || null, req.user.id, cur.id]); id = cur.id; }
    else {
      try { [{ insertId: id }] = await pool.query("INSERT INTO attendance (user_id, work_date, status, note, source, created_by, updated_by) VALUES (?,?,?,?, 'HR', ?, ?)", [u.id, date, status, nt || null, req.user.id, req.user.id]); }
      catch (e) { if (e.code === 'ER_DUP_ENTRY') throw httpError(409, 'Absensi baru saja diubah pihak lain. Muat ulang.'); throw e; }
    }
    await audit.log(pool, { entity: 'attendance', id, action: cur ? 'Dikoreksi HR' : 'Diinput HR', note: note(`${u.name} ${date}: ${cur ? cur.status : (C.isWeekday(date) && date < today() ? 'ALF (otomatis)' : '-')} → ${status}${nt ? ' (' + nt + ')' : ''}${cur?.note && cur.note !== nt ? '; catatan lama: ' + cur.note : ''}`), user: req.user });
    res.json({ id, attendance: shapeAtt(await one('SELECT * FROM attendance WHERE id=?', [id])) });
  }));

  // Koreksi baris report pegawai mana pun, hari mana pun
  r.put('/report/:id(\\d+)', wrap(async (req, res) => {
    const it = await one('SELECT i.*, u.name FROM daily_report_items i JOIN users u ON u.id=i.user_id WHERE i.id=?', [req.params.id]);
    if (!it) throw httpError(404, 'Baris report tidak ditemukan');
    const c = C.checkReport(req.body || {}); if (c.fields) throw Object.assign(httpError(400, Object.values(c.fields)[0]), { fields: c.fields });
    await pool.query('UPDATE daily_report_items SET start_time=?, end_time=?, activity=?, updated_by=? WHERE id=?', [c.values.start_time, c.values.end_time, c.values.activity, req.user.id, it.id]);
    const was = `${C.hm(it.start_time)}–${it.end_time ? C.hm(it.end_time) : '-'} ${it.activity}`, now_ = `${C.hm(c.values.start_time)}–${c.values.end_time ? C.hm(c.values.end_time) : '-'} ${c.values.activity}`;
    await audit.log(pool, { entity: 'daily_report', id: it.id, action: 'Dikoreksi HR', note: note(`${it.name} ${it.work_date}: ${was} → ${now_}`), user: req.user });
    res.json({ ok: true });
  }));
  return r;
};
