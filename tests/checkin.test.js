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

const jwt = require('jsonwebtoken'), cfg = require('../config'), { startApp } = require('./app-helper');

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
  r = await a('POST', '/checkin', { status: 'WFO', lat: -6.1234567891, lng: 106.8, accuracy: 18.6, work_date: '2020-01-01', check_in_at: '2020-01-01T03:00:00Z', user_id: B });
  assert.equal(r.status, 200); assert.equal(r.data.late, false); assert.equal(r.data.attendance.time, '07:45'); assert.equal(r.data.attendance.status, 'WFO');
  assert.deepEqual([r.data.attendance.lat, r.data.attendance.lng, r.data.attendance.accuracy_m], [-6.1234568, 106.8, 19]); assert.equal(r.data.attendance.maps_url, 'https://www.google.com/maps?q=-6.1234568,106.8');
  const row = (await q('SELECT * FROM attendance WHERE user_id=?', [A]))[0]; assert.equal(row.work_date, '2026-10-14'); assert.equal(row.check_in_at, '2026-10-14 00:45:18'); assert.equal(row.source, 'SELF'); assert.equal(row.created_by, A);
  assert.equal((await q('SELECT COUNT(*) n FROM attendance WHERE user_id=?', [B]))[0].n, 0);       // body user_id diabaikan
  // kedua kali: 409, pesan jelas, tidak mengubah baris
  clock.t = new Date('2026-10-14T05:00:00Z'); r = await a('POST', '/checkin', { status: 'WFH' });
  assert.equal(r.status, 409); assert.match(r.data.error, /sudah check in hari ini pukul 07:45/);
  assert.equal((await q('SELECT status FROM attendance WHERE user_id=?', [A]))[0].status, 'WFO');
  r = await a('GET', '/checkin/today'); assert.equal(r.data.attendance.time, '07:45'); assert.equal(r.data.server_time, '2026-10-14T12:00:00+07:00');
  // lokasi kosong diterima; terlambat dihitung saat dibaca
  clock.t = new Date('2026-10-14T01:01:00Z'); r = await b('POST', '/checkin', { status: 'WFH' });
  assert.equal(r.status, 200); assert.equal(r.data.late, true); assert.deepEqual([r.data.attendance.lat, r.data.attendance.lng, r.data.attendance.maps_url], [null, null, null]);
  clock.t = new Date('2026-10-14T01:00:00Z'); assert.equal((await c('POST', '/checkin', { status: 'WFO', lat: '', lng: '' })).data.late, false);   // tepat 08:00 belum terlambat
  // lewat tengah malam WIB: tanggal mengikuti server
  clock.t = new Date('2026-10-14T17:05:00Z'); r = await a('POST', '/checkin', { status: 'WFO', work_date: '2026-10-14' });
  assert.equal(r.status, 200); assert.equal(r.data.attendance.work_date, '2026-10-15'); assert.equal(r.data.attendance.time, '00:05');
  // baris yang diinput HR untuk hari ini: check in ditolak
  await q("INSERT INTO attendance (user_id, work_date, status, note, source) VALUES (?, '2026-10-15', 'SCK', 'Demam', 'HR')", [D]);
  r = await d('POST', '/checkin', { status: 'WFO' }); assert.equal(r.status, 409); assert.match(r.data.error, /diinput HR \(SCK\)/);

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
  assert.equal((await vu('POST', '/checkin', { status: 'WFO' })).status, 403); assert.equal((await vu('POST', '/checkin/report', { start_time: '08:00', activity: 'x' })).status, 403);
  assert.equal((await app.get('/checkin/today')).status, 200);                                        // Super Admin
});
