const test = require('node:test'), assert = require('node:assert/strict');
const cfg = require('../config'), T = require('../lib/tracking'), { TRACKING } = require('../lib/rules');
const { dbAvailable } = require('./helpers');
const { startApp, joBody } = require('./app-helper');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Tracking surat jalan (driver tanpa login, verifikasi nopol AKTIF): token, verifikasi nopol, sesi, langkah, bukti terima', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  TRACKING.VERIFY_NOPOL = true; t.after(() => { TRACKING.VERIFY_NOPOL = false; });          // tes ini menguji mode dengan verifikasi nopol (default produksi: mati)
  const app = await startApp('lesat_test_trkpub'), q = async (s, p) => (await app.pool.query(s, p))[0], root = app.base.replace(/\/api$/, '');
  t.after(() => app.close());
  let ipn = 10; const nextIp = () => `10.1.0.${++ipn}`;
  const pub = async (method, path, body, { sess, ip = '10.1.0.1' } = {}) => {
    const r = await fetch(root + '/api/pub/d/' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(sess ? { Authorization: 'Bearer ' + sess } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null), headers: r.headers };
  };
  const vendors = (await app.get('/lookups')).data.vendors, own = vendors.find(v => v.code === 'LST').id, ext = vendors.find(v => v.code === 'DMS').id;
  const jo = (await app.post('/job-orders', joBody())).data.id, tk = (await app.post('/ho/tickets', { jo_ids: [jo] })).data.id;
  await app.post(`/ho/tickets/${tk}/materials`, { rows: [1, 2, 3].map(n => ({ jo_id: jo, product_no: 'P-' + n, description: 'COIL', net_weight: 1000, gross_weight: 1010, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG' })) });
  const rows = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows;
  const mk = async (i, vendor_id, nopol = 'B 9123 ABC') => (await app.post(`/ho/tickets/${tk}/sj`, { nopol, driver: 'BUDI', vendor_id, items: [{ material_id: rows[i].id, qty: 1, weight: 1000 }] })).data;
  const tokenOf = async id => (await app.get(`/ho/sj/${id}/tracking`)).data.link.url.split('/d/')[1];
  const sjA = await mk(0, own), sjB = await mk(1, ext), sjC = await mk(2, own, 'B 12 XY');
  const tA = await tokenOf(sjA.id), tB = await tokenOf(sjB.id), tC = await tokenOf(sjC.id);
  const login = async (token, digits = '9123', ip) => (await pub('POST', `${token}/verify`, { digits }, { ip })).data?.session;

  // info publik minimal + header keamanan
  let r = await pub('GET', tA); assert.equal(r.status, 200); assert.deepEqual(r.data, { no_sj: sjA.sj_no, from: 'PRIOK', to: 'CIBITUNG', state: 'belum_siap', verify: true });
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.ok(!JSON.stringify(r.data).match(/BUDI|B 9123|customer/i));
  // tautan sebelum Ready: tidak bisa verifikasi
  r = await pub('POST', `${tA}/verify`, { digits: '9123' }); assert.deepEqual([r.status, r.data.state], [409, 'belum_siap']);
  await app.post(`/ho/sj/${sjA.id}/ready`); await app.post(`/ho/sj/${sjB.id}/ready`); await app.post(`/ho/sj/${sjC.id}/ready`);
  assert.equal((await pub('GET', tA)).data.state, 'aktif');

  // token tidak valid: 404 yang sama (format salah, nonce salah, tanda tangan salah, surat jalan tidak ada)
  const [a, n, s] = tA.split('.'), b64 = x => Buffer.from(String(x)).toString('base64url'), ipx = nextIp();
  const bads = ['abc', `${a}.${n}`, `${a}.${'0'.repeat(16)}.${s}`, `${a}.${n}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`, `${b64(999999)}.${n}.${s}`, `${b64(sjB.id)}.${n}.${s}`, `${a}.${n}.${s}x`];
  const msgs = new Set(); for (const x of bads) { r = await pub('GET', x, undefined, { ip: ipx }); assert.equal(r.status, 404, x); msgs.add(JSON.stringify(r.data)); r = await pub('POST', `${x}/verify`, { digits: '9123' }, { ip: ipx }); assert.equal(r.status, 404); }
  assert.equal(msgs.size, 1);

  // verifikasi: salah (tidak membocorkan nopol), benar dengan spasi, nopol <4 digit
  r = await pub('POST', `${tA}/verify`, { digits: '0000' }, { ip: nextIp() }); assert.deepEqual([r.status, r.data.left], [401, 4]); assert.ok(!JSON.stringify(r.data).includes('9123'));
  assert.equal((await pub('POST', `${tA}/verify`, {}, { ip: nextIp() })).status, 401);
  const sessA = await login(tA, ' 9 1 2 3 ', nextIp()); assert.ok(sessA); assert.equal((await q('SELECT verify_fails f FROM delivery_notes WHERE id=?', [sjA.id]))[0].f, 0);   // sukses mereset hitungan
  assert.ok((await q('SELECT link_opened_at o, link_verified_at v FROM delivery_notes WHERE id=?', [sjA.id]))[0].o);
  assert.equal((await app.get(`/ho/sj/${sjA.id}/tracking`)).data.link.opened_at != null, true);
  assert.equal((await login(tC, '1')), undefined); assert.ok(await login(tC, '12', nextIp()));                                 // nopol B 12 XY: seluruh digitnya

  // terkunci setelah 5 salah berturut-turut; benar pun ditolak sampai dibuka operasional
  const ipl = nextIp(); let last; for (let i = 0; i < 5; i++) last = await pub('POST', `${tB}/verify`, { digits: '1111' }, { ip: ipl });
  assert.deepEqual([last.status, last.data.state], [423, 'terkunci']); assert.equal((await pub('GET', tB)).data.state, 'terkunci');
  assert.equal((await pub('POST', `${tB}/verify`, { digits: '9123' }, { ip: nextIp() })).status, 423);
  await app.post(`/ho/sj/${sjB.id}/tracking/link/unlock`); const sessB = await login(tB, '9123', nextIp()); assert.ok(sessB);

  // sesi: wajib, dirusak, kedaluwarsa, milik surat jalan lain
  assert.equal((await pub('GET', `${tA}/sj`)).status, 401); assert.equal((await pub('GET', `${tA}/sj`, undefined, { sess: sessA + 'x' })).status, 401); assert.equal((await pub('GET', `${tA}/sj`, undefined, { sess: sessB })).status, 401);
  const old = T.signSession({ dnId: sjA.id, nonce: (await q('SELECT track_nonce n FROM delivery_notes WHERE id=?', [sjA.id]))[0].n }, cfg.secret, Date.now() - 13 * 3600e3);
  assert.equal((await pub('GET', `${tA}/sj`, undefined, { sess: old })).status, 401);
  r = await pub('GET', `${tA}/sj`, undefined, { sess: sessA }); assert.equal(r.status, 200);
  assert.deepEqual([r.data.status, r.data.items, r.data.qty, r.data.ton, r.data.nopol, r.data.next.map(x => x.status)], ['READY', 1, 1, 1, 'B 9123 ABC', ['STARTED']]); assert.ok(!JSON.stringify(r.data).match(/customer|BUDI/i));

  // langkah armada sendiri: berurutan, tekan ganda aman, melompat/mundur ditolak, DELIVERED lewat step ditolak
  const st = (token, sess, status, extra = {}) => pub('POST', `${token}/step`, { status, ...extra }, { sess });
  assert.equal((await st(tA, sessA, 'LOADED')).status, 409); assert.equal((await st(tA, sessA, 'DELIVERED')).status, 400); assert.equal((await st(tA, sessA, 'COMPLETED')).status, 400); assert.equal((await st(tA, sessA, 'READY')).status, 400);
  assert.equal((await st(tA, sessA, 'STARTED', { lat: -6.2, lng: 106.8 })).status, 200); const dbl = await st(tA, sessA, 'STARTED'); assert.deepEqual([dbl.status, dbl.data.already], [200, true]);
  assert.equal((await q("SELECT COUNT(*) n FROM delivery_note_events WHERE dn_id=? AND status='STARTED'", [sjA.id]))[0].n, 1);
  const ev = (await q("SELECT lat, lng, source, manual, by_label FROM delivery_note_events WHERE dn_id=? AND status='STARTED'", [sjA.id]))[0]; assert.deepEqual([+ev.lat, +ev.lng, ev.source, ev.manual, ev.by_label], [-6.2, 106.8, 'DRIVER', 0, 'Driver BUDI']);
  assert.equal((await st(tA, sessA, 'ARRIVED_PICKUP', { lat: 999, lng: 'x' })).status, 200); assert.equal((await q("SELECT lat FROM delivery_note_events WHERE dn_id=? AND status='ARRIVED_PICKUP'", [sjA.id]))[0].lat, null);   // lokasi tidak valid diabaikan
  assert.equal((await st(tA, sessA, 'STARTED')).status, 409);                                                                    // mundur
  assert.equal((await st(tA, sessA, 'IN_TRANSIT')).status, 409);                                                                 // LOADED wajib untuk armada sendiri
  assert.equal((await st(tA, sessA, 'LOADED')).status, 200); assert.ok((await q('SELECT finish_loading f FROM delivery_notes WHERE id=?', [sjA.id]))[0].f);
  assert.equal((await st(tA, sessA, 'IN_TRANSIT')).status, 200); assert.equal((await st(tA, sessA, 'ARRIVED_DEST')).status, 200);
  // peringatan "perlu dicek": langkah beruntun < 2 menit terlihat di sisi operasional
  assert.ok((await app.get(`/ho/sj/${sjA.id}/tracking`)).data.warnings.needs_check.length >= 1);

  // bukti terima: tanpa foto / bukan gambar ditolak; sukses; ganda aman; sesudahnya langkah lain ditolak
  const dv = (token, sess, body) => pub('POST', `${token}/deliver`, body, { sess });
  assert.equal((await dv(tA, sessA, {})).status, 400); assert.equal((await dv(tA, sessA, { filename: 'a.png', data: '' })).status, 400); assert.equal((await dv(tA, sessA, { filename: 'a.pdf', data: PNG })).status, 400);
  assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='delivery_note' AND kind='pod' AND owner_id=?", [sjA.id]))[0].n, 0);
  const [d1, d2] = await Promise.all([dv(tA, sessA, { filename: 'ttd.png', data: PNG, receiver_name: ' Pak Hasan ' }), dv(tA, sessA, { filename: 'ttd.png', data: PNG })]);   // unggah bersamaan
  assert.deepEqual([d1.status, d2.status], [200, 200]); assert.equal([d1, d2].filter(x => x.data.already).length, 1);
  assert.equal((await q("SELECT COUNT(*) n FROM files WHERE owner_type='delivery_note' AND kind='pod' AND owner_id=?", [sjA.id]))[0].n, 1); assert.equal((await q("SELECT COUNT(*) n FROM delivery_note_events WHERE dn_id=? AND status='DELIVERED'", [sjA.id]))[0].n, 1);
  assert.equal((await q('SELECT received_by r FROM delivery_notes WHERE id=?', [sjA.id]))[0].r, 'Pak Hasan');
  const view = (await app.get(`/ho/sj/${sjA.id}/tracking`)).data; assert.deepEqual([view.status, view.can.complete, view.received_by], ['DELIVERED', true, 'Pak Hasan']); assert.ok(view.pod.id);
  assert.equal((await st(tA, sessA, 'ARRIVED_DEST')).status, 409);
  assert.equal((await pub('GET', `${tA}/sj`, undefined, { sess: sessA })).data.next.length, 0);
  // operasional menyelesaikan -> tautan selesai, sesi lama tidak berlaku
  await app.post(`/ho/sj/${sjA.id}/complete`); assert.equal((await pub('GET', tA)).data.state, 'selesai'); assert.equal((await pub('GET', `${tA}/sj`, undefined, { sess: sessA })).status, 409);
  assert.equal((await pub('POST', `${tA}/verify`, { digits: '9123' }, { ip: nextIp() })).status, 409);

  // vendor luar: boleh melewati STARTED/LOADED/ARRIVED_DEST; langkah wajib tidak
  const sB = await login(tB, '9123', nextIp()); assert.deepEqual((await pub('GET', `${tB}/sj`, undefined, { sess: sB })).data.next.map(x => [x.status, x.skips]), [['STARTED', []], ['ARRIVED_PICKUP', ['STARTED']]]);
  assert.equal((await st(tB, sB, 'IN_TRANSIT')).status, 409); assert.equal((await st(tB, sB, 'ARRIVED_PICKUP')).status, 200); assert.equal((await st(tB, sB, 'IN_TRANSIT')).status, 200);
  assert.equal((await dv(tB, sB, { filename: 'b.png', data: PNG })).status, 200);
  assert.deepEqual((await q("SELECT status, skipped FROM delivery_note_events WHERE dn_id=? AND status IN ('STARTED','LOADED','ARRIVED_DEST') ORDER BY id", [sjB.id])).map(e => [e.status, e.skipped]), [['STARTED', 1], ['LOADED', 1], ['ARRIVED_DEST', 1]]);

  // tautan dicabut / dibuat ulang: sesi dan token lama mati
  const sC = await login(tC, '12', nextIp()); assert.equal((await pub('GET', `${tC}/sj`, undefined, { sess: sC })).status, 200);
  await app.post(`/ho/sj/${sjC.id}/tracking/link/revoke`); assert.equal((await pub('GET', tC)).data.state, 'dicabut'); assert.equal((await pub('GET', `${tC}/sj`, undefined, { sess: sC })).status, 409); assert.equal((await st(tC, sC, 'STARTED')).status, 409);
  await app.post(`/ho/sj/${sjC.id}/tracking/link/regenerate`); assert.equal((await pub('GET', tC, undefined, { ip: nextIp() })).status, 404); assert.equal((await pub('GET', `${tC}/sj`, undefined, { sess: sC, ip: nextIp() })).status, 404);
  const tC2 = await tokenOf(sjC.id); assert.equal((await pub('GET', tC2)).data.state, 'aktif'); assert.equal((await pub('GET', `${tC2}/sj`, undefined, { sess: sC })).status, 401);   // sesi lama (nonce lama) tidak berlaku

  // pembatas laju: terlalu banyak token salah dari satu IP
  const ipr = nextIp(); let code; for (let i = 0; i < 32; i++) code = (await pub('GET', 'bukan-token', undefined, { ip: ipr })).status; assert.equal(code, 429);
  assert.equal((await pub('GET', tC2, undefined, { ip: ipr })).status, 429); assert.equal((await pub('GET', tC2, undefined, { ip: nextIp() })).status, 200);       // IP lain tidak terpengaruh

  // body terlalu besar: galat generik tanpa tumpukan
  const big = await fetch(root + `/api/pub/d/${tC2}/deliver`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() }, body: JSON.stringify({ data: 'A'.repeat(13 * 1024 * 1024), filename: 'x.png' }) });
  assert.equal(big.status, 413); assert.ok(!(await big.text()).includes('node_modules'));
  // API operasional tetap butuh login; halaman /d/:token disajikan tanpa login dengan header aman
  assert.equal((await fetch(root + `/api/ho/sj/${sjA.id}/tracking`)).status, 401); const page = await fetch(root + `/d/${tC2}`); assert.equal(page.status, 200); assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
});

test('Tracking surat jalan (driver): verifikasi nopol dimatikan (default) — tautan rahasia cukup', async t => {
  if (!(await dbAvailable())) return t.skip('MySQL tidak tersedia');
  assert.equal(TRACKING.VERIFY_NOPOL, false);
  const app = await startApp('lesat_test_trkpub_off'), root = app.base.replace(/\/api$/, '');
  t.after(() => app.close());
  const pub = async (method, path, body, sess) => { const r = await fetch(root + '/api/pub/d/' + path, { method, headers: { 'Content-Type': 'application/json', ...(sess ? { Authorization: 'Bearer ' + sess } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const jo = (await app.post('/job-orders', joBody())).data.id, tk = (await app.post('/ho/tickets', { jo_ids: [jo] })).data.id;
  await app.post(`/ho/tickets/${tk}/materials`, { rows: [{ jo_id: jo, product_no: 'P-1', description: 'COIL', net_weight: 1000, gross_weight: 1010, qty: 1, unit: 'COIL', origin: 'PRIOK', destination: 'CIBITUNG' }] });
  const rows = (await app.get(`/ho/tickets/${tk}/materials`)).data.rows;
  const sj = (await app.post(`/ho/tickets/${tk}/sj`, { nopol: 'DFA', driver: 'BUDI', items: [{ material_id: rows[0].id, qty: 1, weight: 1000 }] })).data;   // nopol tanpa angka tidak lagi menghalangi Ready
  assert.equal((await app.get(`/ho/sj/${sj.id}/tracking`)).data.can.ready, true); assert.equal((await app.post(`/ho/sj/${sj.id}/ready`)).status, 200);
  const token = (await app.get(`/ho/sj/${sj.id}/tracking`)).data.link.url.split('/d/')[1];
  assert.equal((await pub('GET', token)).data.verify, false);
  const v = await pub('POST', `${token}/verify`, {}); assert.equal(v.status, 200); assert.ok(v.data.session);                  // tanpa angka
  assert.equal((await pub('POST', `${token}/verify`, { digits: '0000' })).status, 200);                                       // angka apa pun diabaikan; tidak ada penguncian
  assert.equal((await pub('GET', `${token}/sj`, undefined, v.data.session)).status, 200);
  assert.equal((await pub('POST', `${token}/step`, { status: 'STARTED' }, v.data.session)).status, 200);
  assert.equal((await pub('GET', 'bukan-token')).status, 404); assert.equal((await pub('GET', `${token}/sj`)).status, 401);   // token tetap wajib; sesi tetap wajib
  assert.ok((await app.pool.query('SELECT link_opened_at o FROM delivery_notes WHERE id=?', [sj.id]))[0][0].o);
});
