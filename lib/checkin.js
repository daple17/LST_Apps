// Check In & Daily Report: aturan murni tanpa database (tanggal WIB, terlambat, alfa virtual, rekap). Dipakai API dan tes.
// Semua waktu disimpan UTC; "hari" selalu hari kalender Asia/Jakarta (WIB, UTC+7, tanpa DST). Jam dan tanggal berasal dari server, bukan klien.
const WORK_START = '08:00';          // jam masuk (satu-satunya konstanta); terlambat bila jam:menit check-in > 08:00
const MAX_RANGE_DAYS = 62, HISTORY_DEFAULT_DAYS = 14;
const PHOTO_REQUIRED = true;         // foto bukti wajib saat check in pegawai (input HR tanpa foto). Ubah ke false bila foto jadi opsional
const PHOTO_MAX_MB = 8;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

const STATUSES = {
  WFO: { label: 'Work From Office', present: true }, WFH: { label: 'Work From Home', present: true },
  ALF: { label: 'Alfa', present: false }, SCK: { label: 'Sakit', present: false }, OTH: { label: 'Lainnya', present: false },
};
const STATUS_CODES = Object.keys(STATUSES), SELF_STATUSES = ['WFO', 'WFH'], NOTE_REQUIRED = ['SCK', 'OTH'];

// 'YYYY-MM-DD HH:MM:SS' (UTC dari database), ISO, Date, atau milidetik -> Date
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v); return new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? s.replace(' ', 'T') + (s.length === 16 ? ':00' : '') + 'Z' : s);
}
// komponen waktu WIB: { date:'YYYY-MM-DD', time:'HH:MM:SS', hm:'HH:MM' }
function wib(v) {
  const iso = new Date(toDate(v).getTime() + WIB_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19), hm: iso.slice(11, 16) };
}
const wibDate = v => wib(v).date;
const toWibIso = v => { const w = wib(v); return `${w.date}T${w.time}+07:00`; };
const isLate = (v, start = WORK_START) => wib(v).hm > start;       // 08:00:59 belum terlambat; 08:01 terlambat

const DATE_RE = /^\d{4}-\d\d-\d\d$/;
const isDate = s => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const isWeekday = s => { const d = new Date(s + 'T00:00:00Z').getUTCDay(); return d >= 1 && d <= 5; };
function eachDate(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
// rentang valid: from <= to, maksimal `max` hari (inklusif)
function checkRange(from, to, max = MAX_RANGE_DAYS) {
  if (!isDate(from) || !isDate(to)) return 'Tanggal tidak valid';
  if (from > to) return 'Tanggal awal harus sebelum tanggal akhir';
  if (diffDays(from, to) + 1 > max) return `Rentang maksimal ${max} hari`;
  return null;
}

// jam "HH:MM" atau "HH:MM:SS" -> "HH:MM:SS", atau null
function normTime(s) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(s ?? '').trim());
  return m ? `${m[1]}:${m[2]}:${m[3] || '00'}` : null;
}
const hm = t => (t ? String(t).slice(0, 5) : '-');

// Validasi baris report. Mengembalikan { values } atau { fields: {kolom: pesan} }
function checkReport(b) {
  const fields = {}, start = normTime(b.start_time), end = b.end_time == null || b.end_time === '' ? null : normTime(b.end_time), activity = String(b.activity ?? '').replace(/\s+/g, ' ').trim();
  if (!start) fields.start_time = 'Jam Start tidak valid (HH:MM)';
  if (b.end_time != null && b.end_time !== '' && !end) fields.end_time = 'Jam Finish tidak valid (HH:MM)';
  if (start && end && end <= start) fields.end_time = 'Finish harus setelah Start';
  if (!activity) fields.activity = 'Activity wajib diisi'; else if (activity.length > 255) fields.activity = 'Activity maksimal 255 karakter';
  return Object.keys(fields).length ? { fields } : { values: { start_time: start, end_time: end, activity } };
}
const reportSummary = items => items.map(i => `${hm(i.start_time)}–${i.end_time ? hm(i.end_time) : '-'} ${i.activity}`).join('; ');

// Baris absensi efektif satu pegawai pada satu hari: baris nyata, atau ALF virtual (hari kerja yang sudah lewat, pegawai aktif, setelah tanggal bergabung)
function effectiveDay({ row, date, today, active, joined }) {
  if (row) return { status: row.status, virtual: false, row };
  if (active && date < today && isWeekday(date) && (!joined || date >= joined)) return { status: 'ALF', virtual: true, row: null };
  return null;
}

// users: [{id,name,employee_no,is_active,joined}], rows: absensi nyata, reports: baris report. Mengembalikan rekap per pegawai + total status.
function buildRekap({ users, rows, reports = [], from, to, today, status = '', q = '' }) {
  const byKey = new Map(rows.map(r => [`${r.user_id}|${r.work_date}`, r]));
  const dates = eachDate(from, to), single = from === to, totals = { WFO: 0, WFH: 0, ALF: 0, SCK: 0, OTH: 0 };
  const needle = String(q).trim().toLowerCase(), out = [];
  const reportsBy = new Map(); for (const it of reports) { const k = `${it.user_id}|${it.work_date}`; (reportsBy.get(k) || reportsBy.set(k, []).get(k)).push(it); }
  for (const u of users) {
    const hasRow = rows.some(r => r.user_id === u.id);
    if (!u.is_active && !hasRow) continue;                              // nonaktif ikut rekap hanya bila punya baris absensi
    if (needle && !(u.name.toLowerCase().includes(needle) || String(u.employee_no || '').toLowerCase().includes(needle))) continue;
    const s = { id: u.id, employee_no: u.employee_no || '', name: u.name, is_active: !!u.is_active, attendance: 0, permit: 0, alfa: 0, late: 0, days: {} }, uc = { WFO: 0, WFH: 0, ALF: 0, SCK: 0, OTH: 0 };
    for (const d of dates) {
      const e = effectiveDay({ row: byKey.get(`${u.id}|${d}`), date: d, today, active: !!u.is_active, joined: u.joined });
      if (!e) continue;
      s.days[d] = e;
      if (STATUSES[e.status].present) s.attendance++; else if (e.status === 'ALF') s.alfa++; else s.permit++;
      if (e.row?.check_in_at && STATUSES[e.status].present && isLate(e.row.check_in_at)) s.late++;
      uc[e.status]++;
    }
    if (status && !Object.values(s.days).some(e => e.status === status)) continue;   // filter status: pegawai yang pernah berstatus itu pada rentang
    for (const k of Object.keys(uc)) totals[k] += uc[k];                               // total mengikuti pegawai yang tampil
    if (single) {
      const e = s.days[from], its = reportsBy.get(`${u.id}|${from}`) || [];
      s.day = e ? { attendance_id: e.row?.id ?? null, has_photo: !!e.row?.photo_file_id, status: e.status, virtual: e.virtual, check_in_at: e.row?.check_in_at ? toWibIso(e.row.check_in_at) : null, time: e.row?.check_in_at ? wib(e.row.check_in_at).hm : null,
        late: !!(e.row?.check_in_at && STATUSES[e.status].present && isLate(e.row.check_in_at)), lat: e.row?.lat ?? null, lng: e.row?.lng ?? null, accuracy_m: e.row?.accuracy_m ?? null, note: e.row?.note ?? null, source: e.row?.source ?? null } : null;
      s.report = reportSummary(its);
    }
    delete s.days; out.push(s);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { rows: out, totals, days: dates.length };
}

// jenis gambar dari byte awal (bukan dari nama/ekstensi): 'jpg' | 'png' | 'webp' | null
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
const mapsUrl = (lat, lng) => (lat == null || lng == null ? null : `https://www.google.com/maps?q=${lat},${lng}`);
module.exports = { PHOTO_REQUIRED, PHOTO_MAX_MB, sniffImage, WORK_START, MAX_RANGE_DAYS, HISTORY_DEFAULT_DAYS, STATUSES, STATUS_CODES, SELF_STATUSES, NOTE_REQUIRED, toDate, wib, wibDate, toWibIso, isLate, isDate, addDays, diffDays, isWeekday, eachDate, checkRange, normTime, hm, checkReport, reportSummary, effectiveDay, buildRekap, mapsUrl };
