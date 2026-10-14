const test = require('node:test'), assert = require('node:assert/strict');
const { migrate, helpers } = require('../lib/migrate');
const { freshDb, dbAvailable } = require('./helpers');

test('migrasi 008: tabel absensi dan report, aman diulang', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const pool = await freshDb('lesat_test_checkin_mig'); t.after(() => pool.end());
  const q = async (s, p) => (await pool.query(s, p))[0], m = helpers(pool);
  await require('../migrations/000-legacy-baseline').up(m);
  await q("INSERT INTO users (username,password,name) VALUES ('lama','x','Pegawai Lama')");
  await migrate(pool); assert.deepEqual(await migrate(pool), []);
  const u = (await q("SELECT id, created_at FROM users WHERE username='lama'"))[0];
  assert.ok(u.created_at, 'users.created_at terisi untuk user lama');
  await q("INSERT INTO attendance (user_id, work_date, status, check_in_at) VALUES (?, '2026-10-14', 'WFO', '2026-10-14 00:45:00')", [u.id]);
  await assert.rejects(q("INSERT INTO attendance (user_id, work_date, status) VALUES (?, '2026-10-14', 'WFH')", [u.id]), /Duplicate/);   // satu absensi per pegawai per hari
  await q("INSERT INTO attendance (user_id, work_date, status) VALUES (?, '2026-10-15', 'SCK')", [u.id]);                                // hari lain boleh
  await assert.rejects(q("INSERT INTO attendance (user_id, work_date, status) VALUES (?, '2026-10-16', 'XXX')", [u.id]));              // status di luar enum ditolak
  await q("INSERT INTO daily_report_items (user_id, work_date, start_time, activity) VALUES (?, '2026-10-14', '08:00:00', 'Briefing')", [u.id]);
  assert.equal((await q('SELECT end_time FROM daily_report_items'))[0].end_time, null);
  // role PIC Operasional dari migrasi 005 ikut mendapat izin check in; Super Admin memegang semuanya
  const pic = (await q("SELECT p.permission FROM role_permissions p JOIN roles r ON r.id=p.role_id WHERE r.name='PIC Operasional' AND p.permission LIKE 'checkin%'")).map(r => r.permission).sort();
  assert.deepEqual(pic, ['checkin.create', 'checkin.update', 'checkin.view']);
  const sa = (await q("SELECT p.permission FROM role_permissions p JOIN roles r ON r.id=p.role_id WHERE r.name='Super Admin' AND p.permission LIKE 'checkin%'")).map(r => r.permission).sort();
  assert.deepEqual(sa, ['checkin.create', 'checkin.update', 'checkin.view', 'checkin_rekap.export', 'checkin_rekap.update', 'checkin_rekap.view'].sort());
});

const jwt = require('jsonwebtoken'), cfg = require('../config'), { startApp } = require('./app-helper'), files = require('../lib/files');
const JPEG = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PHOTO = { filename: 'selfie.jpg', data: JPEG(64).toString('base64') };

test('API check in pegawai: waktu server, satu kali per hari, lokasi, report', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const clock = { t: new Date('2026-10-14T00:45:18Z') };                                         // 07:45:18 WIB, Rabu
  const app = await startApp('lesat_test_checkin_api', { now: () => clock.t }), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const rl = (await q("INSERT INTO roles (name) VALUES ('Pegawai')")).insertId;
  await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [['checkin.view', 'checkin.create', 'checkin.update'].map(p => [rl, p])]);
  const mkUser = async (u, no, role = rl) => (await q('INSERT INTO users (username,password,name,employee_no,role_id,email) VALUES (?,?,?,?,?,?)', [u, 'x', u.toUpperCase(), no, role, u + '@x.id'])).insertId;
  const A = await mkUser('ade', '14001'), B = await mkUser('budi', '14002'), Cc = await mkUser('citra', null), D = await mkUser('dodo', '14004');
  const as = id => (m, u, b) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, b);
  const a = as(A), b = as(B), c = as(Cc), d = as(D);

  // hari ini: sebelum check in
  let r = await a('GET', '/checkin/today'); assert.equal(r.status, 200);
  assert.equal(r.data.server_time, '2026-10-14T07:45:18+07:00'); assert.equal(r.data.date, '2026-10-14'); assert.equal(r.data.work_start, '08:00');
  assert.equal(r.data.attendance, null); assert.deepEqual(r.data.report, []); assert.deepEqual(r.data.user, { id: A, name: 'ADE', employee_no: '14001' }); assert.equal(r.data.server_ms, clock.t.getTime());
  assert.equal((await c('GET', '/checkin/today')).data.user.employee_no, '');                       // tanpa employee_no tetap boleh

  // validasi check in
  for (const [body, f] of [[{}, 'status'], [{ status: 'SCK' }, 'status'], [{ status: 'ALF' }, 'status'], [{ status: 'OTH' }, 'status'], [{ status: 'xx' }, 'status'],
    [{ status: 'WFO', lat: -6.2 }, 'lat'], [{ status: 'WFO', lat: 91, lng: 10 }, 'lat'], [{ status: 'WFO', lat: 10, lng: 181 }, 'lat'], [{ status: 'WFO', lat: 'abc', lng: 10 }, 'lat']]) {
    const x = await a('POST', '/checkin', body); assert.equal(x.status, 400, JSON.stringify(body)); assert.ok(x.data.fields[f], f);
  }
  assert.equal((await q('SELECT COUNT(*) n FROM attendance'))[0].n, 0);                              // yang ditolak tidak tersimpan

  // sukses: jam dan tanggal dari server, bukan dari klien
  r = await a('POST', '/checkin', { photo: PHOTO, status: 'WFO', lat: -6.1234567891, lng: 106.8, accuracy: 18.6, work_date: '2020-01-01', check_in_at: '2020-01-01T03:00:00Z', user_id: B });
  assert.equal(r.status, 200); assert.equal(r.data.late, false); assert.equal(r.data.attendance.time, '07:45'); assert.equal(r.data.attendance.status, 'WFO');
  assert.deepEqual([r.data.attendance.lat, r.data.attendance.lng, r.data.attendance.accuracy_m], [-6.1234568, 106.8, 19]); assert.equal(r.data.attendance.maps_url, 'https://www.google.com/maps?q=-6.1234568,106.8');
  const row = (await q('SELECT * FROM attendance WHERE user_id=?', [A]))[0]; assert.equal(row.work_date, '2026-10-14'); assert.equal(row.check_in_at, '2026-10-14 00:45:18'); assert.equal(row.source, 'SELF'); assert.equal(row.created_by, A);
  assert.equal((await q('SELECT COUNT(*) n FROM attendance WHERE user_id=?', [B]))[0].n, 0);       // body user_id diabaikan
  // kedua kali: 409, pesan jelas, tidak mengubah baris
  clock.t = new Date('2026-10-14T05:00:00Z'); r = await a('POST', '/checkin', { photo: PHOTO, status: 'WFH' });
  assert.equal(r.status, 409); assert.match(r.data.error, /sudah check in hari ini pukul 07:45/);
  assert.equal((await q('SELECT status FROM attendance WHERE user_id=?', [A]))[0].status, 'WFO');
  r = await a('GET', '/checkin/today'); assert.equal(r.data.attendance.time, '07:45'); assert.equal(r.data.server_time, '2026-10-14T12:00:00+07:00');
  // lokasi kosong diterima; terlambat dihitung saat dibaca
  clock.t = new Date('2026-10-14T01:01:00Z'); r = await b('POST', '/checkin', { photo: PHOTO, status: 'WFH' });
  assert.equal(r.status, 200); assert.equal(r.data.late, true); assert.deepEqual([r.data.attendance.lat, r.data.attendance.lng, r.data.attendance.maps_url], [null, null, null]);
  clock.t = new Date('2026-10-14T01:00:00Z'); assert.equal((await c('POST', '/checkin', { photo: PHOTO, status: 'WFO', lat: '', lng: '' })).data.late, false);   // tepat 08:00 belum terlambat
  // lewat tengah malam WIB: tanggal mengikuti server
  clock.t = new Date('2026-10-14T17:05:00Z'); r = await a('POST', '/checkin', { photo: PHOTO, status: 'WFO', work_date: '2026-10-14' });
  assert.equal(r.status, 200); assert.equal(r.data.attendance.work_date, '2026-10-15'); assert.equal(r.data.attendance.time, '00:05');
  // baris yang diinput HR untuk hari ini: check in ditolak
  await q("INSERT INTO attendance (user_id, work_date, status, note, source) VALUES (?, '2026-10-15', 'SCK', 'Demam', 'HR')", [D]);
  r = await d('POST', '/checkin', { photo: PHOTO, status: 'WFO' }); assert.equal(r.status, 409); assert.match(r.data.error, /diinput HR \(SCK\)/);

  // report: tambah, validasi, ubah milik sendiri hari ini
  clock.t = new Date('2026-10-15T01:00:00Z');                                                        // Kamis 08:00 WIB
  for (const [body, f] of [[{ start_time: '8', activity: 'x' }, 'start_time'], [{ start_time: '08:00', end_time: '07:00', activity: 'x' }, 'end_time'], [{ start_time: '08:00', end_time: '08:00', activity: 'x' }, 'end_time'],
    [{ start_time: '08:00', activity: ' ' }, 'activity'], [{ start_time: '08:00', activity: 'a'.repeat(256) }, 'activity'], [{ start_time: '08:00', end_time: '25:00', activity: 'x' }, 'end_time']]) {
    const x = await a('POST', '/checkin/report', body); assert.equal(x.status, 400, JSON.stringify(body).slice(0, 60)); assert.ok(x.data.fields[f], f);
  }
  const i1 = (await a('POST', '/checkin/report', { start_time: '08:00', end_time: '11:32', activity: 'Handling LCL KUI', work_date: '2020-01-01' })).data.id;
  const i2 = (await a('POST', '/checkin/report', { start_time: '15:45', activity: 'Idle' })).data.id;
  r = (await a('GET', '/checkin/today')).data.report; assert.deepEqual(r.map(x => [x.start_time, x.end_time, x.activity]), [['08:00', '11:32', 'Handling LCL KUI'], ['15:45', null, 'Idle']]);
  assert.equal((await q('SELECT work_date FROM daily_report_items WHERE id=?', [i1]))[0].work_date, '2026-10-15');   // tanggal klien diabaikan
  assert.equal((await a('PUT', `/checkin/report/${i2}`, { start_time: '15:45', end_time: '16:30', activity: 'Settlement' })).status, 200);
  assert.equal((await a('PUT', `/checkin/report/${i2}`, { start_time: '15:45', end_time: '15:00', activity: 'x' })).status, 400);
  assert.equal((await b('PUT', `/checkin/report/${i1}`, { start_time: '08:00', activity: 'curang' })).status, 403);   // bukan milik sendiri
  assert.equal((await a('PUT', '/checkin/report/999999', { start_time: '08:00', activity: 'x' })).status, 403);
  assert.equal((await q('SELECT activity FROM daily_report_items WHERE id=?', [i1]))[0].activity, 'Handling LCL KUI');
  // hari berikutnya: baris kemarin hanya baca
  clock.t = new Date('2026-10-16T01:00:00Z');
  assert.equal((await a('PUT', `/checkin/report/${i1}`, { start_time: '08:00', activity: 'ubah kemarin' })).status, 403);
  assert.deepEqual((await a('GET', '/checkin/today')).data.report, []);
  // batas baris per hari
  for (let i = 0; i < 50; i++) assert.equal((await a('POST', '/checkin/report', { start_time: '09:00', activity: 'k' + i })).status, 200);
  assert.equal((await a('POST', '/checkin/report', { start_time: '09:00', activity: 'lagi' })).status, 400);

  // riwayat: hanya milik sendiri, urut terbaru, default 14 hari, maks 62 hari
  clock.t = new Date('2026-10-16T01:00:00Z');
  r = (await a('GET', '/checkin/history')).data; assert.equal(r.days.length, 14); assert.equal(r.days[0].date, '2026-10-16'); assert.equal(r.days.at(-1).date, '2026-10-03');
  const d15 = r.days.find(x => x.date === '2026-10-15'), d14 = r.days.find(x => x.date === '2026-10-14');
  assert.equal(d15.attendance.time, '00:05'); assert.equal(d15.report.length, 2); assert.equal(d14.attendance.status, 'WFO'); assert.equal(r.days.find(x => x.date === '2026-10-17'), undefined);
  assert.equal(r.days.find(x => x.date === '2026-10-10').weekday, false);
  const rb = (await b('GET', '/checkin/history?from=2026-10-14&to=2026-10-15')).data; assert.equal(rb.days.length, 2); assert.equal(rb.days[1].attendance.status, 'WFH'); assert.equal(rb.days.flatMap(x => x.report).length, 0);   // tidak melihat report Ade
  assert.equal((await a('GET', '/checkin/history?from=2026-01-01&to=2026-12-31')).status, 400); assert.equal((await a('GET', '/checkin/history?from=2026-10-10&to=2026-10-01')).status, 400);
  assert.equal((await a('GET', '/checkin/history?from=2026-08-16&to=2026-10-16')).data.days.length, 62);

  // izin: tanpa checkin.* = 403; hanya view = baca saja
  const picRole = (await q("SELECT id FROM roles WHERE name='PIC Operasional'"))[0].id;
  const none = as((await q("INSERT INTO users (username,password,name,role_id,email) VALUES ('tanpa','x','Tanpa',?,'t@x.id')", [picRole])).insertId);
  await q("DELETE FROM role_permissions WHERE role_id=? AND permission LIKE 'checkin%'", [picRole]);
  for (const [m, u] of [['GET', '/checkin/today'], ['POST', '/checkin'], ['GET', '/checkin/history'], ['POST', '/checkin/report'], ['PUT', '/checkin/report/1']]) assert.equal((await none(m, u, {})).status, 403, m + u);
  const vr = (await q("INSERT INTO roles (name) VALUES ('Lihat Absen')")).insertId; await q("INSERT INTO role_permissions (role_id, permission) VALUES (?, 'checkin.view')", [vr]);
  const vu = as((await q("INSERT INTO users (username,password,name,role_id,email) VALUES ('lihat','x','Lihat',?,'l@x.id')", [vr])).insertId);
  assert.equal((await vu('GET', '/checkin/today')).status, 200); assert.equal((await vu('GET', '/checkin/history')).status, 200);
  assert.equal((await vu('POST', '/checkin', { photo: PHOTO, status: 'WFO' })).status, 403); assert.equal((await vu('POST', '/checkin/report', { start_time: '08:00', activity: 'x' })).status, 403);
  assert.equal((await app.get('/checkin/today')).status, 200);                                        // Super Admin
});

const ExcelJS = require('exceljs');
test('API rekap HR: harian, periode, alfa virtual, override, koreksi report, ekspor, izin', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const clock = { t: new Date('2026-10-16T01:00:00Z') };                                           // Jumat 08:00 WIB
  const app = await startApp('lesat_test_checkin_rekap', { now: () => clock.t }), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const mk = async (u, no, active = 1) => (await q('INSERT INTO users (username,password,name,employee_no,is_active,email) VALUES (?,?,?,?,?,?)', [u, 'x', u[0].toUpperCase() + u.slice(1), no, active, u + '@x.id'])).insertId;
  const ade = await mk('ade', '14001'), budi = await mk('budi', '14002'), citra = await mk('citra', null), dodo = await mk('dodo', '14004', 0), eka = await mk('eka', '14005', 0);
  await q("UPDATE users SET created_at='2026-10-01 00:00:00'");                                       // tanggal bergabung tetap agar hasil tidak bergantung tanggal asli
  const att = (u, d, st, utc, extra = {}) => q('INSERT INTO attendance (user_id, work_date, status, check_in_at, note, source, lat, lng) VALUES (?,?,?,?,?,?,?,?)', [u, d, st, utc || null, extra.note || null, extra.source || 'SELF', extra.lat ?? null, extra.lng ?? null]);
  await att(ade, '2026-10-14', 'WFO', '2026-10-14 00:50:00', { lat: -6.1, lng: 106.8 }); await att(ade, '2026-10-15', 'WFH', '2026-10-15 01:45:00'); await att(ade, '2026-10-16', 'WFO', '2026-10-16 00:30:00');
  await att(budi, '2026-10-14', 'SCK', null, { note: 'Demam', source: 'HR' }); await att(budi, '2026-10-16', 'OTH', null, { note: 'Umroh', source: 'HR' });
  await att(eka, '2026-10-15', 'WFO', '2026-10-15 00:20:00');
  await q("INSERT INTO daily_report_items (user_id, work_date, start_time, end_time, activity) VALUES (?, '2026-10-16', '08:00:00', '11:32:00', 'Handling LCL KUI'), (?, '2026-10-16', '12:30:00', NULL, 'Pengerjaan Settlement')", [ade, ade]);
  const rk = async (qs = '') => (await app.get('/checkin-rekap' + qs)).data, by = d => Object.fromEntries(d.rows.map(r => [r.name, r]));

  // periode: alfa virtual hanya hari kerja yang sudah lewat untuk pegawai aktif; hari ini belum alfa
  let d = await rk('?from=2026-10-14&to=2026-10-16'); assert.equal(d.mode, 'period'); assert.equal(d.days, 3);
  assert.deepEqual(d.rows.map(r => r.name), ['Ade', 'Administrator', 'Budi', 'Citra', 'Eka']);       // Dodo (nonaktif tanpa baris) tidak ikut
  let x = by(d);
  assert.deepEqual([x.Ade.attendance, x.Ade.permit, x.Ade.alfa, x.Ade.late], [3, 0, 0, 1]); assert.deepEqual([x.Budi.attendance, x.Budi.permit, x.Budi.alfa], [0, 2, 1]);
  assert.deepEqual([x.Citra.alfa, x.Administrator.alfa, x.Eka.attendance, x.Eka.alfa], [2, 2, 1, 0]); assert.equal(x.Citra.employee_no, ''); assert.equal(x.Ade.employee_no, '14001');
  assert.deepEqual(d.totals, { WFO: 3, WFH: 1, ALF: 5, SCK: 1, OTH: 1 });
  // harian
  d = await rk('?date=2026-10-15'); x = by(d); assert.equal(d.mode, 'day');
  assert.deepEqual(d.totals, { WFO: 1, WFH: 1, ALF: 3, SCK: 0, OTH: 0 });
  assert.deepEqual([x.Ade.day.status, x.Ade.day.time, x.Ade.day.late, x.Ade.day.check_in_at], ['WFH', '08:45', true, '2026-10-15T08:45:00+07:00']);
  assert.deepEqual([x.Budi.day.status, x.Budi.day.virtual, x.Budi.day.time], ['ALF', true, null]); assert.equal(x.Eka.day.status, 'WFO');
  d = await rk('?date=2026-10-16'); x = by(d); assert.equal(d.today, '2026-10-16');
  assert.equal(x.Citra.day, null); assert.equal(x.Administrator.day, null); assert.deepEqual(d.totals, { WFO: 1, WFH: 0, ALF: 0, SCK: 0, OTH: 1 }); assert.ok(!x.Eka);
  assert.equal(x.Ade.report, '08:00–11:32 Handling LCL KUI; 12:30–- Pengerjaan Settlement'); assert.equal(x.Budi.day.note, 'Umroh');
  assert.deepEqual([x.Ade.day.lat, x.Ade.day.maps_url], [null, null]);
  d = await rk('?date=2026-10-14'); assert.deepEqual([by(d).Ade.day.lat, by(d).Ade.day.maps_url], [-6.1, 'https://www.google.com/maps?q=-6.1,106.8']);
  assert.deepEqual((await rk()).rows.length, 4);                                                    // tanpa parameter = hari ini (Eka nonaktif tanpa baris hari ini)
  // cari, filter status, validasi rentang
  assert.deepEqual((await rk('?from=2026-10-14&to=2026-10-16&q=14002')).rows.map(r => r.name), ['Budi']); assert.deepEqual((await rk('?from=2026-10-14&to=2026-10-16&q=eka')).totals, { WFO: 1, WFH: 0, ALF: 0, SCK: 0, OTH: 0 });
  assert.deepEqual((await rk('?from=2026-10-14&to=2026-10-16&status=SCK')).rows.map(r => r.name), ['Budi']);
  for (const qs of ['?status=XX', '?date=2026-02-30', '?from=2026-10-16&to=2026-10-01', '?from=2026-01-01&to=2026-12-31', '?from=2026-10-01']) assert.equal((await app.get('/checkin-rekap' + qs)).status, 400, qs);

  // detail per pegawai
  const r_ = (await app.get(`/checkin-rekap/user/${budi}?from=2026-10-14&to=2026-10-16`)).data;
  assert.equal(r_.user.name, 'Budi'); assert.deepEqual(r_.days.map(x => [x.date, x.status, x.virtual]), [['2026-10-16', 'OTH', false], ['2026-10-15', 'ALF', true], ['2026-10-14', 'SCK', false]]);
  assert.deepEqual(r_.summary, { WFO: 0, WFH: 0, ALF: 1, SCK: 1, OTH: 1, late: 0 });
  const da = (await app.get(`/checkin-rekap/user/${ade}?from=2026-10-14&to=2026-10-16`)).data; assert.equal(da.days[0].report.length, 2); assert.equal(da.days[2].attendance.maps_url, 'https://www.google.com/maps?q=-6.1,106.8'); assert.equal(da.summary.late, 1);
  assert.equal((await app.get('/checkin-rekap/user/999999')).status, 404); assert.equal((await app.get(`/checkin-rekap/user/${ade}?from=2026-01-01&to=2026-12-31`)).status, 400);

  // override HR
  const ov = body => app.put('/checkin-rekap/override', body);
  for (const [b, f] of [[{ user_id: budi, work_date: '2026-10-15', status: 'SCK' }, 'note'], [{ user_id: budi, work_date: '2026-10-15', status: 'OTH', note: ' ' }, 'note'], [{ user_id: budi, work_date: '2026-10-17', status: 'ALF' }, 'work_date'],
    [{ user_id: budi, work_date: '2026-13-01', status: 'ALF' }, 'work_date'], [{ user_id: budi, work_date: '2026-10-15', status: 'ABC' }, 'status'], [{ user_id: 999999, work_date: '2026-10-15', status: 'WFO' }, 'user_id'],
    [{ user_id: budi, work_date: '2026-10-15', status: 'SCK', note: 'x'.repeat(256) }, 'note']]) { const r = await ov(b); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 70)); assert.ok(r.data.fields[f], f); }
  assert.equal((await q('SELECT COUNT(*) n FROM attendance WHERE user_id=? AND work_date=?', [budi, '2026-10-15']))[0].n, 0);
  let r = await ov({ user_id: budi, work_date: '2026-10-15', status: 'SCK', note: 'Demam tinggi' }); assert.equal(r.status, 200); assert.equal(r.data.attendance.source, 'HR'); assert.equal(r.data.attendance.check_in_at, null);
  assert.deepEqual([by(await rk('?date=2026-10-15')).Budi.day.status, (await rk('?date=2026-10-15')).totals.ALF, (await rk('?date=2026-10-15')).totals.SCK], ['SCK', 2, 1]);   // baris HR menggantikan alfa virtual
  r = await ov({ user_id: ade, work_date: '2026-10-16', status: 'WFH' }); assert.equal(r.status, 200);                                  // mengganti baris yang ada; jam check in tetap
  const adeRow = (await q('SELECT * FROM attendance WHERE user_id=? AND work_date=?', [ade, '2026-10-16']))[0]; assert.deepEqual([adeRow.status, adeRow.source, adeRow.check_in_at, adeRow.updated_by], ['WFH', 'HR', '2026-10-16 00:30:00', 1]);
  assert.equal((await ov({ user_id: citra, work_date: '2026-10-16', status: 'WFO' })).status, 200);                                       // hari ini boleh; WFO tanpa jam
  assert.equal((await q('SELECT COUNT(*) n FROM attendance WHERE user_id=? AND work_date=?', [citra, '2026-10-16']))[0].n, 1);
  const au = await q("SELECT action, note FROM audit_log WHERE entity_type='attendance' ORDER BY id"); assert.equal(au.length, 3);
  assert.match(au[0].note, /Budi 2026-10-15: ALF \(otomatis\) → SCK \(Demam tinggi\)/); assert.match(au[1].note, /Ade 2026-10-16: WFO → WFH/); assert.equal(au[0].action, 'Diinput HR'); assert.equal(au[1].action, 'Dikoreksi HR');
  // pegawai check in sendiri sesudah HR mengisi hari itu -> ditolak (diuji di tes API pegawai)

  // koreksi report oleh HR
  const it = (await q('SELECT id FROM daily_report_items ORDER BY id'))[0].id;
  assert.equal((await app.put(`/checkin-rekap/report/${it}`, { start_time: '08:00', end_time: '07:00', activity: 'x' })).status, 400); assert.equal((await app.put('/checkin-rekap/report/999999', { start_time: '08:00', activity: 'x' })).status, 404);
  assert.equal((await app.put(`/checkin-rekap/report/${it}`, { start_time: '08:15', end_time: '11:30', activity: 'Handling LCL KUI (koreksi)' })).status, 200);
  assert.match((await q("SELECT note FROM audit_log WHERE entity_type='daily_report'"))[0].note, /Ade 2026-10-16: 08:00–11:32 Handling LCL KUI → 08:15–11:30 Handling LCL KUI \(koreksi\)/);
  clock.t = new Date('2026-10-20T01:00:00Z');                                                         // hari berikutnya tetap bisa dikoreksi HR
  assert.equal((await app.put(`/checkin-rekap/report/${it}`, { start_time: '08:15', end_time: '11:30', activity: 'koreksi lagi' })).status, 200); clock.t = new Date('2026-10-16T01:00:00Z');

  // ekspor Excel
  let ex = await app.raw('/checkin-rekap/export?date=2026-10-15'); assert.equal(ex.status, 200); assert.match(ex.type, /spreadsheetml/);
  let wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); let ws = wb.getWorksheet('Rekap Harian');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['No.', 'Nomor ID', 'Nama', 'Attendance', 'Permit', 'Alfa', 'Past', 'Location', 'Check In', 'Status', 'Foto', 'Report']);
  assert.equal(ws.rowCount, 1 + 5); assert.equal(ws.getRow(2).getCell(3).value, 'Ade'); assert.equal(ws.getRow(2).getCell(9).value, '08:45'); assert.equal(ws.getRow(2).getCell(10).value, 'WFH'); assert.equal(ws.getRow(2).getCell(8).value, 'Lokasi tidak dibagikan');
  assert.equal(ws.getRow(4).getCell(10).value, 'SCK'); assert.equal(wb.getWorksheet('Total').getRow(2).getCell(1).value, 'Total WFO');
  ex = await app.raw('/checkin-rekap/export?from=2026-10-14&to=2026-10-16'); wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); ws = wb.getWorksheet('Rekap Periode');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['No.', 'Nomor ID', 'Nama', 'Attendance', 'Permit', 'Alfa', 'Past']); assert.equal((await app.raw('/checkin-rekap/export?status=XX')).status, 400);

  // izin
  const mkRole = async (name, perms) => { const rl = (await q('INSERT INTO roles (name) VALUES (?)', [name])).insertId; await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [rl, p])]); return (await q('INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)', [name.replace(/\W/g, ''), 'x', name, rl, name.replace(/\W/g, '') + '@x.id'])).insertId; };
  const as = id => (m, u, b) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, b);
  const own = as(await mkRole('Hanya Absen', ['checkin.view', 'checkin.create', 'checkin.update'])), view = as(await mkRole('Rekap Lihat', ['checkin_rekap.view']));
  const calls = [['GET', '/checkin-rekap'], ['GET', `/checkin-rekap/user/${ade}`], ['GET', '/checkin-rekap/export'], ['PUT', '/checkin-rekap/override'], ['PUT', `/checkin-rekap/report/${it}`]];
  for (const [m, u] of calls) assert.equal((await own(m, u, {})).status, 403, 'hanya checkin: ' + m + u);                       // checkin tanpa checkin_rekap
  assert.equal((await own('GET', '/checkin/today')).status, 200);
  assert.equal((await view('GET', '/checkin-rekap')).status, 200); assert.equal((await view('GET', `/checkin-rekap/user/${ade}`)).status, 200);
  for (const [m, u] of calls.slice(2)) assert.equal((await view(m, u, {})).status, 403, 'rekap view: ' + m + u);                  // override dan ekspor butuh izin sendiri
  assert.equal((await view('GET', '/checkin/today')).status, 403);                                                                  // rekap tidak otomatis berarti boleh check in
});

test('foto bukti absensi: wajib, divalidasi, hanya pemilik dan HR yang melihat', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const clock = { t: new Date('2026-10-14T00:45:18Z') };
  const app = await startApp('lesat_test_checkin_photo', { now: () => clock.t }), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(async () => { await files.removeByOwner(app.pool, 'attendance', (await q("SELECT owner_id FROM files WHERE owner_type='attendance'")).map(r => r.owner_id)); await app.close(); });
  const rl = (await q("INSERT INTO roles (name) VALUES ('Pegawai')")).insertId; await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [['checkin.view', 'checkin.create', 'checkin.update'].map(p => [rl, p])]);
  const hr = (await q("INSERT INTO roles (name) VALUES ('HR')")).insertId; await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [['checkin_rekap.view', 'checkin_rekap.export'].map(p => [hr, p])]);
  const mk = async (u, role) => (await q('INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)', [u, 'x', u.toUpperCase(), role, u + '@x.id'])).insertId;
  const A = await mk('ade', rl), B = await mk('budi', rl), H = await mk('hr1', hr);
  const as = id => (m, u, b) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, b), a = as(A), b = as(B), h = as(H);
  const get = async (id, url) => { const r = await fetch(`${app.base.replace(/\/api$/, '')}${url}`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id }, cfg.secret) } }); return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; };

  assert.equal((await a('GET', '/checkin/today')).data.photo_required, true);
  // foto wajib; harus gambar sungguhan; maks 8 MB
  let r = await a('POST', '/checkin', { status: 'WFO' }); assert.equal(r.status, 400); assert.match(r.data.fields.photo, /wajib/);
  r = await a('POST', '/checkin', { status: 'WFO', photo: { filename: 'x.jpg', data: '' } }); assert.equal(r.status, 400);
  r = await a('POST', '/checkin', { status: 'WFO', photo: { filename: 'x.jpg', data: Buffer.from('<?php echo 1; ?> ini bukan gambar sama sekali').toString('base64') } }); assert.equal(r.status, 400); assert.match(r.data.fields.photo, /gambar/);
  r = await a('POST', '/checkin', { status: 'WFO', photo: { filename: 'x.jpg', data: Buffer.from('%PDF-1.4 ...........................').toString('base64') } }); assert.equal(r.status, 400);
  r = await a('POST', '/checkin', { status: 'WFO', photo: { filename: 'x.jpg', data: JPEG(8 * 1024 * 1024).toString('base64') } }); assert.equal(r.status, 400); assert.match(r.data.fields.photo, /8 MB/);
  assert.equal((await q('SELECT COUNT(*) n FROM attendance'))[0].n, 0); assert.equal((await q('SELECT COUNT(*) n FROM files WHERE owner_type="attendance"'))[0].n, 0);   // yang ditolak tidak tersimpan

  // sukses: foto tersimpan sebagai berkas pribadi (awalan att-)
  r = await a('POST', '/checkin', { status: 'WFO', photo: PHOTO }); assert.equal(r.status, 200);
  const att = r.data.attendance; assert.equal(att.has_photo, true); assert.equal(att.photo_url, `/api/checkin/photo/${att.id}`);
  const f = (await q("SELECT * FROM files WHERE owner_type='attendance'"))[0]; assert.equal(f.owner_id, att.id); assert.match(f.path, /^att-\d+-/); assert.equal(f.mime, 'image/jpeg'); assert.equal(f.uploaded_by, A);
  assert.equal((await q('SELECT photo_file_id FROM attendance WHERE id=?', [att.id]))[0].photo_file_id, f.id);
  // check in kedua dengan foto: 409 dan tidak ada berkas baru
  assert.equal((await a('POST', '/checkin', { status: 'WFH', photo: PHOTO })).status, 409); assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='attendance'"))[0].n, 1);
  // hari ini / riwayat memuat tautan foto
  assert.equal((await a('GET', '/checkin/today')).data.attendance.photo_url, att.photo_url); assert.equal((await a('GET', '/checkin/history')).data.days[0].attendance.has_photo, true);

  // akses: pemilik, HR berizin; orang lain tidak; /uploads tidak membuka berkas absensi
  let g = await get(A, att.photo_url); assert.equal(g.status, 200); assert.equal(g.type, 'image/jpeg'); assert.ok(g.buf.equals(JPEG(64)));
  assert.equal((await get(B, att.photo_url)).status, 404);                                          // pegawai lain: tidak ada
  assert.equal((await get(H, att.photo_url)).status, 403);                                          // HR tanpa izin check in tidak lewat jalur pegawai
  g = await get(H, `/api/checkin-rekap/photo/${att.id}`); assert.equal(g.status, 200); assert.ok(g.buf.equals(JPEG(64)));
  assert.equal((await get(B, `/api/checkin-rekap/photo/${att.id}`)).status, 403);                    // tanpa checkin_rekap.view
  assert.equal((await get(1, `/api/checkin-rekap/photo/${att.id}`)).status, 200);                    // Super Admin
  assert.equal((await get(H, '/api/checkin-rekap/photo/999999')).status, 404);
  const viaToken = await fetch(`${app.base.replace(/\/api$/, '')}${att.photo_url}?t=${jwt.sign({ id: A }, cfg.secret)}`); assert.equal(viaToken.status, 200);   // <img> memakai ?t=
  assert.equal((await fetch(`${app.base.replace(/\/api$/, '')}${att.photo_url}`)).status, 401);
  for (const id of [1, A, H]) assert.equal((await fetch(`${app.base.replace(/\/api$/, '')}/uploads/${f.path}?t=${jwt.sign({ id }, cfg.secret)}`)).status, 403, 'uploads ' + id);

  // rekap HR: tanda dan tautan foto; Excel kolom Foto; input HR tidak punya foto
  await q("INSERT INTO attendance (user_id, work_date, status, note, source) VALUES (?, '2026-10-14', 'SCK', 'Demam', 'HR')", [B]);
  const rk = (await h('GET', '/checkin-rekap?date=2026-10-14')).data, by = Object.fromEntries(rk.rows.map(x => [x.name, x]));
  assert.deepEqual([by.ADE.day.has_photo, by.ADE.day.photo_url], [true, `/api/checkin-rekap/photo/${att.id}`]); assert.deepEqual([by.BUDI.day.has_photo, by.BUDI.day.photo_url], [false, null]);
  const det = (await h('GET', `/checkin-rekap/user/${A}?from=2026-10-14&to=2026-10-14`)).data.days[0].attendance; assert.equal(det.photo_url, `/api/checkin-rekap/photo/${att.id}`);
  const buf = Buffer.from(await (await fetch(`${app.base}/checkin-rekap/export?date=2026-10-14`, { headers: { Authorization: 'Bearer ' + jwt.sign({ id: H }, cfg.secret) } })).arrayBuffer());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.getWorksheet('Rekap Harian'); assert.ok(ws.getRow(1).values.includes('Foto'));
  const col = ws.getRow(1).values.indexOf('Foto'); assert.deepEqual([...Array(ws.rowCount - 1)].map((_, i) => ws.getRow(i + 2).getCell(col).value).sort(), ['-', 'Ada'].concat(Array(ws.rowCount - 3).fill('-')).sort());
});
