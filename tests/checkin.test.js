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
