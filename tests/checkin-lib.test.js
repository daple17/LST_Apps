const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../lib/checkin');

test('tanggal dan jam WIB dari timestamp UTC (termasuk lewat tengah malam)', () => {
  assert.deepEqual(C.wib('2026-10-14 00:30:00'), { date: '2026-10-14', time: '07:30:00', hm: '07:30' });
  assert.equal(C.wibDate('2026-10-13 16:59:59'), '2026-10-13'); assert.equal(C.wibDate('2026-10-13 17:00:00'), '2026-10-14');   // 17:00 UTC = 00:00 WIB
  assert.equal(C.wibDate('2026-12-31 18:00:00'), '2027-01-01');                                                                  // lewat tahun
  assert.equal(C.wibDate(new Date('2026-10-13T20:15:00Z')), '2026-10-14'); assert.equal(C.wibDate(Date.UTC(2026, 9, 14, 0, 0, 0)), '2026-10-14');
  assert.equal(C.toWibIso('2026-10-14 00:45:18'), '2026-10-14T07:45:18+07:00');
  assert.equal(C.wib('2026-10-14T00:45:18Z').time, '07:45:18');
});

test('terlambat: jam masuk 08:00 (jam:menit)', () => {
  assert.equal(C.WORK_START, '08:00');
  const at = hm => `2026-10-14 ${String(+hm.slice(0, 2) - 7).padStart(2, '0')}:${hm.slice(3)}:00`;      // WIB -> UTC
  assert.equal(C.isLate(at('07:20')), false); assert.equal(C.isLate(at('08:00')), false); assert.equal(C.isLate('2026-10-14 01:00:59'), false);
  assert.equal(C.isLate(at('08:01')), true); assert.equal(C.isLate(at('08:45')), true); assert.equal(C.isLate(at('09:45')), true);
  assert.equal(C.isLate(at('08:01'), '08:30'), false);                                                      // jam masuk bisa diganti lewat argumen
});

test('tanggal, rentang, jam, dan baris report', () => {
  assert.ok(C.isDate('2026-02-28') && !C.isDate('2026-02-30') && !C.isDate('2026-2-3') && !C.isDate(null));
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01'); assert.equal(C.diffDays('2026-10-01', '2026-10-14'), 13);
  assert.deepEqual([C.isWeekday('2026-10-16'), C.isWeekday('2026-10-17'), C.isWeekday('2026-10-18'), C.isWeekday('2026-10-19')], [true, false, false, true]);
  assert.equal(C.eachDate('2026-10-12', '2026-10-14').length, 3);
  assert.equal(C.checkRange('2026-10-01', '2026-10-14'), null); assert.match(C.checkRange('2026-10-14', '2026-10-01'), /sebelum/); assert.match(C.checkRange('2026-01-01', '2026-03-31'), /maksimal 62/);
  assert.equal(C.checkRange('2026-01-01', '2026-03-03'), null); assert.match(C.checkRange('x', '2026-03-03'), /tidak valid/);               // tepat 62 hari boleh
  assert.equal(C.normTime('8:00'), null); assert.equal(C.normTime('08:00'), '08:00:00'); assert.equal(C.normTime('23:59:59'), '23:59:59'); assert.equal(C.normTime('24:00'), null);
  assert.deepEqual(C.checkReport({ start_time: '08:00', end_time: '11:32', activity: ' Handling   LCL KUI ' }).values, { start_time: '08:00:00', end_time: '11:32:00', activity: 'Handling LCL KUI' });
  assert.equal(C.checkReport({ start_time: '15:45', end_time: '', activity: 'Idle' }).values.end_time, null);                                // Finish boleh kosong
  const bad = C.checkReport({ start_time: '10:00', end_time: '09:00', activity: '' }).fields; assert.ok(bad.end_time && bad.activity);
  assert.match(C.checkReport({ start_time: '10:00', end_time: '10:00', activity: 'x' }).fields.end_time, /setelah Start/);
  assert.ok(C.checkReport({ start_time: 'x', activity: 'x' }).fields.start_time); assert.ok(C.checkReport({ start_time: '08:00', activity: 'a'.repeat(256) }).fields.activity);
  assert.equal(C.reportSummary([{ start_time: '08:00:00', end_time: '11:32:00', activity: 'A' }, { start_time: '12:30:00', end_time: null, activity: 'B' }]), '08:00–11:32 A; 12:30–- B');
  assert.equal(C.mapsUrl(-6.1, 106.8), 'https://www.google.com/maps?q=-6.1,106.8'); assert.equal(C.mapsUrl(null, 1), null);
});

test('alfa virtual: hari kerja lewat, bukan akhir pekan, bukan hari ini, baris HR menggantikan', () => {
  const today = '2026-10-14';                                                  // Rabu
  const e = (date, extra = {}) => C.effectiveDay({ date, today, active: true, joined: null, row: null, ...extra });
  assert.deepEqual(e('2026-10-13'), { status: 'ALF', virtual: true, row: null });                 // Selasa lewat
  assert.equal(e('2026-10-10'), null); assert.equal(e('2026-10-11'), null);                         // Sabtu, Minggu
  assert.equal(e(today), null); assert.equal(e('2026-10-15'), null);                                // hari ini belum alfa; masa depan tidak
  assert.equal(e('2026-10-13', { active: false }), null);                                           // nonaktif tidak dihitung alfa
  assert.equal(e('2026-10-09', { joined: '2026-10-12' }), null);                                    // sebelum tanggal bergabung
  assert.equal(e('2026-10-12', { joined: '2026-10-12' }).status, 'ALF');
  const row = { status: 'SCK' }; assert.deepEqual(e('2026-10-13', { row }), { status: 'SCK', virtual: false, row });   // baris HR menggantikan alfa
});

test('rekap: total status, alfa virtual, terlambat, filter', () => {
  const users = [{ id: 1, name: 'Ade', employee_no: '14001', is_active: 1, joined: null }, { id: 2, name: 'Budi', employee_no: '14002', is_active: 1, joined: null },
    { id: 3, name: 'Citra', employee_no: '14003', is_active: 1, joined: null }, { id: 4, name: 'Dodo', employee_no: null, is_active: 0, joined: null }, { id: 5, name: 'Eka', employee_no: '14005', is_active: 0, joined: null }];
  const at = (d, hm) => `${d} ${String(+hm.slice(0, 2) - 7).padStart(2, '0')}:${hm.slice(3)}:00`;
  const rows = [
    { user_id: 1, work_date: '2026-10-12', status: 'WFO', check_in_at: at('2026-10-12', '07:45'), lat: -6.1, lng: 106.8, accuracy_m: 20 },
    { user_id: 1, work_date: '2026-10-13', status: 'WFH', check_in_at: at('2026-10-13', '08:45') },                       // terlambat
    { user_id: 1, work_date: '2026-10-14', status: 'WFO', check_in_at: at('2026-10-14', '07:50') },
    { user_id: 2, work_date: '2026-10-12', status: 'SCK', check_in_at: null, note: 'Demam', source: 'HR' },
    { user_id: 2, work_date: '2026-10-14', status: 'OTH', check_in_at: null, note: 'Umroh', source: 'HR' },
    { user_id: 5, work_date: '2026-10-13', status: 'WFO', check_in_at: at('2026-10-13', '07:20') },                       // nonaktif tapi punya baris
  ];
  const reports = [{ user_id: 1, work_date: '2026-10-14', start_time: '08:00:00', end_time: '11:32:00', activity: 'Handling LCL KUI' }];
  const per = C.buildRekap({ users, rows, reports, from: '2026-10-12', to: '2026-10-14', today: '2026-10-14' });
  assert.deepEqual(per.rows.map(r => r.name), ['Ade', 'Budi', 'Citra', 'Eka']);                                             // Dodo (nonaktif tanpa baris) tidak ikut
  const by = Object.fromEntries(per.rows.map(r => [r.name, r]));
  assert.deepEqual([by.Ade.attendance, by.Ade.permit, by.Ade.alfa, by.Ade.late], [3, 0, 0, 1]);
  assert.deepEqual([by.Budi.attendance, by.Budi.permit, by.Budi.alfa], [0, 2, 1]);                                          // SCK + OTH, alfa virtual Selasa
  assert.deepEqual([by.Citra.attendance, by.Citra.permit, by.Citra.alfa], [0, 0, 2]);                                       // Senin + Selasa; hari ini belum
  assert.deepEqual([by.Eka.attendance, by.Eka.alfa], [1, 0]);                                                               // nonaktif: tidak ada alfa virtual
  assert.deepEqual(per.totals, { WFO: 3, WFH: 1, ALF: 3, SCK: 1, OTH: 1 }); assert.equal(per.days, 3);
  // harian: detail hari itu
  const day = C.buildRekap({ users, rows, reports, from: '2026-10-14', to: '2026-10-14', today: '2026-10-14' });
  const ade = day.rows.find(r => r.name === 'Ade'); assert.equal(ade.day.status, 'WFO'); assert.equal(ade.day.time, '07:50'); assert.equal(ade.day.late, false); assert.equal(ade.report, '08:00–11:32 Handling LCL KUI');
  assert.equal(day.rows.find(r => r.name === 'Citra').day, null);                                                           // hari ini tanpa absensi: belum alfa
  assert.deepEqual(day.totals, { WFO: 1, WFH: 0, ALF: 0, SCK: 0, OTH: 1 });
  const d13 = C.buildRekap({ users, rows, from: '2026-10-13', to: '2026-10-13', today: '2026-10-14' });
  assert.equal(d13.rows.find(r => r.name === 'Ade').day.late, true); assert.equal(d13.rows.find(r => r.name === 'Citra').day.virtual, true);
  assert.equal(d13.rows.find(r => r.name === 'Ade').day.check_in_at, '2026-10-13T08:45:00+07:00');
  // cari dan filter status; total mengikuti yang tampil
  assert.deepEqual(C.buildRekap({ users, rows, from: '2026-10-12', to: '2026-10-14', today: '2026-10-14', q: '14002' }).rows.map(r => r.name), ['Budi']);
  assert.deepEqual(C.buildRekap({ users, rows, from: '2026-10-12', to: '2026-10-14', today: '2026-10-14', q: 'ade' }).totals, { WFO: 2, WFH: 1, ALF: 0, SCK: 0, OTH: 0 });
  assert.deepEqual(C.buildRekap({ users, rows, from: '2026-10-12', to: '2026-10-14', today: '2026-10-14', status: 'ALF' }).rows.map(r => r.name), ['Budi', 'Citra']);
});
