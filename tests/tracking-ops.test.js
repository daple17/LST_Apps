const test = require('node:test'), assert = require('node:assert/strict');
const jwt = require('jsonwebtoken'), cfg = require('../config');
const { dbAvailable } = require('./helpers');
const { startApp, joBody } = require('./app-helper');
const PNG = { filename: 'f.png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };

test('Tracking surat jalan (operasional): alur status, vendor luar, undo, completed, tautan, izin, hapus', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  const app = await startApp('lesat_test_trkops'), q = async (s, p) => (await app.pool.query(s, p))[0];
  t.after(() => app.close());
  const vendors = (await app.get('/lookups')).data.vendors, own = vendors.find(v => v.code === 'LST').id, ext = vendors.find(v => v.code === 'DMS').id;
  assert.equal((await q("SELECT is_own_fleet f FROM vendors WHERE code='LST'"))[0].f, 1); assert.equal((await q("SELECT is_own_fleet f FROM vendors WHERE code='DMS'"))[0].f, 0);
  const jo = (await app.post('/job-orders', joBody())).data.id, tk = (await app.post('/ho/tickets', { jo_ids: [jo] })).data.id;
  const mats = (await app.post(`/ho/tickets/${tk}/materials`, { rows: ['A', 'B', 'C'].map(n => ({ jo_id: jo, product_no: 'T-' + n, description: 'COIL', net_weight: 1000, gross_weight: 1010, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG' })) }));
  assert.equal(mats.status, 200); const rows = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows;
  const mk = async (i, extra = {}) => (await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'B 9123 ABC', driver: 'BUDI', vendor_id: own, items: [{ material_id: rows[i].id, qty: 1, weight: 1000 }], ...extra })).data;
  const sjA = await mk(0), sjB = await mk(1, { vendor_id: ext }), sjC = await mk(2);
  const tr = id => app.get(`/ho/sj/${id}/tracking`), step = (id, status, extra = {}) => app.post(`/ho/sj/${id}/tracking/step`, { status, note: 'driver telepon', ...extra });

  // surat jalan baru: Planning + event awal + token
  let d = (await tr(sjA.id)).data; assert.deepEqual([d.status, d.own_fleet, d.events.length, d.events[0].status, d.link.state, d.can.ready, d.can.steps], ['PLANNING', true, 1, 'PLANNING', 'belum_siap', true, []]);
  assert.equal((await q('SELECT track_nonce n FROM delivery_notes WHERE id=?', [sjA.id]))[0].n.length, 16); assert.match(d.link.url, /\/d\/[\w-]+\.[0-9a-f]{16}\.[\w-]{22}$/);
  assert.equal((await tr(99999)).status, 404);

  // belum Ready: langkah ditolak; Ready; armada sendiri harus berurutan
  assert.equal((await step(sjA.id, 'STARTED')).status, 400);
  assert.equal((await app.post(`/ho/sj/${sjA.id}/ready`)).status, 200); d = (await tr(sjA.id)).data; assert.deepEqual([d.status, d.link.state, d.can.steps], ['READY', 'aktif', ['STARTED']]);
  assert.equal((await app.post(`/ho/sj/${sjA.id}/ready`)).status, 400);                                              // sudah Ready
  assert.equal((await step(sjA.id, 'LOADED')).status, 400);                                                          // melompat
  assert.equal((await step(sjA.id, 'STARTED', { note: '' })).status, 400);                                           // catatan wajib
  assert.equal((await step(sjA.id, 'COMPLETED')).status, 400); assert.equal((await step(sjA.id, 'ZZZ')).status, 400);
  assert.equal((await step(sjA.id, 'STARTED', { at: '2999-01-01T00:00:00Z' })).status, 400);                         // masa depan
  assert.equal((await step(sjA.id, 'STARTED')).status, 200);
  assert.equal((await step(sjA.id, 'ARRIVED_PICKUP', { at: '2000-01-01T00:00:00Z' })).status, 400);                  // lebih awal dari langkah sebelumnya
  for (const s of ['ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED']) assert.equal((await step(sjA.id, s)).status, 200, s);
  d = (await tr(sjA.id)).data; assert.deepEqual([d.status, d.can.complete, d.events.filter(e => e.manual).length], ['DELIVERED', true, 6]);
  assert.ok((await q('SELECT finish_loading f FROM delivery_notes WHERE id=?', [sjA.id]))[0].f);                       // LOADED mengisi finish_loading
  assert.deepEqual(d.steps.map(s => s.state), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'current', 'todo']);
  // Completed hanya dari Diterima, lalu terkunci
  assert.equal((await app.post(`/ho/sj/${sjA.id}/complete`)).status, 200); d = (await tr(sjA.id)).data; assert.deepEqual([d.status, d.link.state, d.can.reopen, d.can.undo], ['COMPLETED', 'selesai', true, false]);
  assert.equal((await step(sjA.id, 'DELIVERED')).status, 400); assert.equal((await app.post(`/ho/sj/${sjA.id}/tracking/undo`, { reason: 'x' })).status, 400); assert.equal((await app.post(`/ho/sj/${sjA.id}/complete`)).status, 400);
  // buka kembali: alasan wajib
  assert.equal((await app.post(`/ho/sj/${sjA.id}/reopen`, {})).status, 400); assert.equal((await app.post(`/ho/sj/${sjA.id}/reopen`, { reason: 'salah tutup' })).status, 200);
  d = (await tr(sjA.id)).data; assert.deepEqual([d.status, d.can.complete], ['DELIVERED', true]); assert.equal((await q('SELECT completed_at c FROM delivery_notes WHERE id=?', [sjA.id]))[0].c, null);
  assert.equal((await app.post(`/ho/sj/${sjB.id}/complete`)).status, 400);                                           // bukan dari Diterima

  // vendor luar: boleh melewati STARTED, LOADED, ARRIVED_DEST (dicatat dilewati); undo ikut membatalkan yang dilewati
  await app.post(`/ho/sj/${sjB.id}/ready`); d = (await tr(sjB.id)).data; assert.deepEqual([d.own_fleet, d.can.steps], [false, ['STARTED', 'ARRIVED_PICKUP']]);
  assert.equal((await step(sjB.id, 'ARRIVED_PICKUP')).status, 200); assert.equal((await step(sjB.id, 'IN_TRANSIT')).status, 200); assert.equal((await step(sjB.id, 'DELIVERED')).status, 200);
  d = (await tr(sjB.id)).data; assert.deepEqual(d.steps.map(s => s.state), ['done', 'done', 'skipped', 'done', 'skipped', 'done', 'skipped', 'current', 'todo']); assert.equal(d.events.filter(e => e.skipped).length, 3);
  assert.equal((await app.post(`/ho/sj/${sjB.id}/tracking/undo`, {})).status, 400);                                  // alasan wajib
  assert.equal((await app.post(`/ho/sj/${sjB.id}/tracking/undo`, { reason: 'salah input' })).status, 200);
  d = (await tr(sjB.id)).data; assert.equal(d.status, 'IN_TRANSIT'); assert.equal(d.events.filter(e => e.voided_at).length, 2); assert.equal(d.events.length, 8);       // event tetap ada, ditandai batal (DELIVERED + ARRIVED_DEST dilewati)
  assert.equal(d.events.filter(e => e.voided_at).every(e => e.void_reason === 'salah input'), true);
  // Finish Loading lama tetap jalan dan menulis event LOADED bila tepat urutannya
  assert.equal((await app.post(`/ho/sj/${sjC.id}/finish`)).status, 200); assert.equal((await tr(sjC.id)).data.status, 'PLANNING');          // PLANNING: finish saja, status tidak berubah
  await app.post(`/ho/sj/${sjC.id}/ready`); await step(sjC.id, 'STARTED'); await step(sjC.id, 'ARRIVED_PICKUP');
  await q('UPDATE delivery_notes SET finish_loading=NULL WHERE id=?', [sjC.id]); assert.equal((await app.post(`/ho/sj/${sjC.id}/finish`)).status, 200);
  d = (await tr(sjC.id)).data; assert.equal(d.status, 'LOADED'); assert.match(d.events.at(-1).note, /Finish Loading/);

  // peringatan: tertahan > 3 jam
  await q('UPDATE delivery_notes SET track_status_at = NOW() - INTERVAL 4 HOUR WHERE id=?', [sjC.id]); d = (await tr(sjC.id)).data; assert.equal(d.warnings.stalled, true); assert.ok(d.warnings.held_min >= 239);
  const list = (await app.get(`/ho/tickets/${tk}/sj`)).data, rc = list.rows.find(x => x.id === sjC.id);
  assert.deepEqual([rc.track.status, rc.track.stalled, rc.track.steps_done, rc.track.link_state], ['LOADED', true, 4, 'aktif']); assert.equal(list.status_counts.LOADED, 1); assert.equal(Object.values(list.status_counts).reduce((a, b) => a + b, 0), 3);
  assert.deepEqual((await app.get(`/ho/tickets/${tk}/sj?status=LOADED`)).data.rows.map(x => x.id), [sjC.id]);

  // tautan: cabut, buat ulang (token lama mati), kunci
  const url1 = (await tr(sjC.id)).data.link.url, tok = u => u.split('/d/')[1];
  assert.equal((await app.post(`/ho/sj/${sjC.id}/tracking/link/revoke`)).data.link.state, 'dicabut'); assert.equal((await app.get(`/ho/sj/${sjC.id}/qr.svg`)).status, 400);
  const re = (await app.post(`/ho/sj/${sjC.id}/tracking/link/regenerate`)).data; assert.equal(re.link.state, 'aktif'); assert.notEqual(tok(re.link.url), tok(url1));
  await q('UPDATE delivery_notes SET link_locked=1, verify_fails=5 WHERE id=?', [sjC.id]); assert.equal((await tr(sjC.id)).data.link.state, 'terkunci');
  const un = (await app.post(`/ho/sj/${sjC.id}/tracking/link/unlock`)).data; assert.deepEqual([un.link.state, un.link.fails], ['aktif', 0]);
  const qrr = await app.raw(`/ho/sj/${sjC.id}/qr.svg`); assert.equal(qrr.status, 200); assert.match(qrr.type, /svg/);

  // data lama: tanpa tautan aktif
  await q("UPDATE delivery_notes SET origin='LEGACY' WHERE id=?", [sjC.id]); assert.equal((await tr(sjC.id)).data.link.state, 'dicabut'); assert.equal((await app.post(`/ho/sj/${sjC.id}/tracking/link/regenerate`)).status, 400);
  await q("UPDATE delivery_notes SET origin='NEW' WHERE id=?", [sjC.id]);

  // foto bukti terima tidak ikut batas 3 foto dan tidak bisa dihapus lewat endpoint foto
  const fid = (await q("INSERT INTO files (owner_type, owner_id, kind, filename, path, size, mime) VALUES ('delivery_note', ?, 'pod', 'pod.png', 'pod-x.png', 1, 'image/png')", [sjA.id])).insertId;
  for (let i = 0; i < 3; i++) assert.equal((await app.post(`/ho/sj/${sjA.id}/photos`, PNG)).status, 200);
  assert.equal((await app.get(`/ho/sj/${sjA.id}`)).data.pod.id, fid); assert.equal((await app.get(`/ho/sj/${sjA.id}`)).data.photos.length, 3); assert.equal((await tr(sjA.id)).data.pod.id, fid);
  assert.equal((await app.del(`/ho/files/${fid}`)).status, 400);

  // izin: ho.view hanya membaca; tanpa ho = 403
  const mk2 = async (name, perms) => { const rl = (await q('INSERT INTO roles (name) VALUES (?)', [name])).insertId; if (perms.length) await q('INSERT INTO role_permissions (role_id, permission) VALUES ?', [perms.map(p => [rl, p])]); return (await q('INSERT INTO users (username,password,name,role_id,email) VALUES (?,?,?,?,?)', [name, 'x', name, rl, name + '@x.id'])).insertId; };
  const as = id => (m, u, bd) => app.callAs(jwt.sign({ id }, cfg.secret), m, u, bd), none = as(await mk2('trk-none', ['jo.view'])), view = as(await mk2('trk-view', ['ho.view'])), upd = as(await mk2('trk-upd', ['ho.view', 'ho.update']));
  const writes = [['POST', `/ho/sj/${sjC.id}/ready`], ['POST', `/ho/sj/${sjC.id}/tracking/step`], ['POST', `/ho/sj/${sjC.id}/tracking/undo`], ['POST', `/ho/sj/${sjC.id}/complete`], ['POST', `/ho/sj/${sjC.id}/reopen`],
    ['POST', `/ho/sj/${sjC.id}/tracking/link/revoke`], ['POST', `/ho/sj/${sjC.id}/tracking/link/regenerate`], ['POST', `/ho/sj/${sjC.id}/tracking/link/unlock`]];
  for (const [m, u] of [['GET', `/ho/sj/${sjC.id}/tracking`], ['GET', `/ho/sj/${sjC.id}/qr.svg`], ...writes]) assert.equal((await none(m, u, {})).status, 403, 'tanpa ' + m + u);
  assert.equal((await view('GET', `/ho/sj/${sjC.id}/tracking`)).status, 200); assert.equal((await view('GET', `/ho/sj/${sjC.id}/qr.svg`)).status, 200);
  for (const [m, u] of writes) assert.equal((await view(m, u, {})).status, 403, 'lihat ' + m + u);
  assert.equal((await upd('POST', `/ho/sj/${sjC.id}/tracking/step`, { status: 'IN_TRANSIT', note: 'telepon' })).status, 200);       // ho.update tanpa ho.create cukup

  // audit
  const acts = (await q("SELECT action FROM audit_log WHERE entity_type='ticket' AND entity_id=?", [tk])).map(x => x.action); for (const x of ['Tracking surat jalan', 'Tracking dibatalkan', 'Surat jalan dibuka kembali', 'Tautan driver dicabut', 'Tautan driver dibuat ulang', 'Tautan driver dibuka kuncinya']) assert.ok(acts.includes(x), x);
  assert.ok((await q("SELECT 1 FROM audit_log WHERE entity_type='ticket' AND note LIKE ?", [`${sjA.sj_no}: Diterima → Completed%`])).length === 1);

  // hapus surat jalan membersihkan event dan foto
  assert.equal((await app.del(`/ho/sj/${sjA.id}`)).status, 200);
  assert.equal((await q('SELECT COUNT(*) n FROM delivery_note_events WHERE dn_id=?', [sjA.id]))[0].n, 0); assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='delivery_note' AND owner_id=?", [sjA.id]))[0].n, 0);
});
