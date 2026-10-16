const test = require('node:test'), assert = require('node:assert/strict');
const T = require('../lib/tracking'), { TRACKING } = require('../lib/rules');
const SECRET = 'rahasia-uji';

test('urutan 9 status dan label', () => {
  assert.deepEqual(T.STATUSES, ['PLANNING', 'READY', 'STARTED', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED', 'COMPLETED']);
  for (const s of T.STATUSES) assert.ok(T.LABELS[s]);
  assert.deepEqual(T.DRIVER_STEPS, ['STARTED', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED']);
});

test('nextAllowed: armada sendiri berurutan; vendor luar boleh melewati STARTED/LOADED/ARRIVED_DEST', () => {
  assert.deepEqual(T.nextAllowed('PLANNING', true), []); assert.deepEqual(T.nextAllowed('DELIVERED', false), []); assert.deepEqual(T.nextAllowed('COMPLETED', false), []);
  assert.deepEqual(T.nextAllowed('READY', true), [{ status: 'STARTED', skips: [] }]);
  assert.deepEqual(T.nextAllowed('READY', false), [{ status: 'STARTED', skips: [] }, { status: 'ARRIVED_PICKUP', skips: ['STARTED'] }]);
  assert.deepEqual(T.nextAllowed('ARRIVED_PICKUP', false), [{ status: 'LOADED', skips: [] }, { status: 'IN_TRANSIT', skips: ['LOADED'] }]);
  assert.deepEqual(T.nextAllowed('IN_TRANSIT', false), [{ status: 'ARRIVED_DEST', skips: [] }, { status: 'DELIVERED', skips: ['ARRIVED_DEST'] }]);
  assert.deepEqual(T.nextAllowed('LOADED', false).map(n => n.status), ['IN_TRANSIT']);          // IN_TRANSIT wajib
  assert.deepEqual(T.nextAllowed('LOADED', true).map(n => n.status), ['IN_TRANSIT']);
});

test('transisi: alur sah armada sendiri dan operasional', () => {
  const ok = (from, to, actor = 'DRIVER', extra = {}) => T.canTransition({ from, to, actor, ...extra });
  assert.equal(ok('PLANNING', 'READY', 'OPS').ok, true);
  const chain = ['READY', 'STARTED', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED'];
  for (let i = 0; i < chain.length - 1; i++) { const r = ok(chain[i], chain[i + 1]); assert.equal(r.ok, true, chain[i + 1]); assert.deepEqual([r.skipped, r.manual], [[], false]); }
  assert.equal(ok('DELIVERED', 'COMPLETED', 'OPS').ok, true);
});

test('transisi: yang ditolak', () => {
  const bad = (a, re) => { const r = T.canTransition(a); assert.equal(r.ok, false, JSON.stringify(a)); if (re) assert.match(r.error, re); };
  bad({ from: 'PLANNING', to: 'STARTED', actor: 'DRIVER' }, /belum Ready/);            // sebelum Ready
  bad({ from: 'READY', to: 'LOADED', actor: 'DRIVER' }, /urutan/);                      // melompat (armada sendiri)
  bad({ from: 'READY', to: 'LOADED', actor: 'DRIVER', ownFleet: false }, /urutan/);     // vendor luar hanya boleh melewati satu langkah opsional
  bad({ from: 'READY', to: 'IN_TRANSIT', actor: 'DRIVER', ownFleet: false });
  bad({ from: 'ARRIVED_PICKUP', to: 'IN_TRANSIT', actor: 'DRIVER', ownFleet: true });   // LOADED wajib untuk armada sendiri
  bad({ from: 'IN_TRANSIT', to: 'STARTED', actor: 'DRIVER' });                          // mundur
  bad({ from: 'LOADED', to: 'LOADED', actor: 'DRIVER' });                               // ganda
  bad({ from: 'DELIVERED', to: 'COMPLETED', actor: 'DRIVER' }, /operasional/);          // driver tidak bisa menyelesaikan
  bad({ from: 'IN_TRANSIT', to: 'COMPLETED', actor: 'OPS' }, /Diterima/);
  bad({ from: 'PLANNING', to: 'READY', actor: 'DRIVER' }, /operasional/);
  bad({ from: 'READY', to: 'READY', actor: 'OPS' }, /Planning/);
  bad({ from: 'READY', to: 'PLANNING', actor: 'OPS' });
  bad({ from: 'COMPLETED', to: 'DELIVERED', actor: 'OPS' }, /buka kembali/);            // terkunci
  bad({ from: 'READY', to: 'STARTED', actor: 'OPS' }, /Catatan wajib/);                 // input atas nama driver tanpa catatan
  bad({ from: 'READY', to: 'STARTED', actor: 'OPS', note: '   ' }, /Catatan wajib/);
  bad({ from: 'X', to: 'READY', actor: 'OPS' }, /tidak dikenal/);
});

test('transisi: vendor luar melewati langkah (dicatat sebagai dilewati) dan input manual operasional', () => {
  let r = T.canTransition({ from: 'READY', to: 'ARRIVED_PICKUP', actor: 'DRIVER', ownFleet: false }); assert.deepEqual([r.ok, r.skipped], [true, ['STARTED']]);
  r = T.canTransition({ from: 'IN_TRANSIT', to: 'DELIVERED', actor: 'DRIVER', ownFleet: false }); assert.deepEqual([r.ok, r.skipped], [true, ['ARRIVED_DEST']]);
  r = T.canTransition({ from: 'ARRIVED_PICKUP', to: 'IN_TRANSIT', actor: 'DRIVER', ownFleet: false }); assert.deepEqual([r.ok, r.skipped], [true, ['LOADED']]);
  r = T.canTransition({ from: 'READY', to: 'STARTED', actor: 'OPS', note: 'driver telepon' }); assert.deepEqual([r.ok, r.manual], [true, true]);
});

test('buka kembali: hanya dari COMPLETED dengan alasan', () => {
  assert.deepEqual(T.canReopen('COMPLETED', 'salah tutup'), { ok: true, to: 'DELIVERED' });
  assert.equal(T.canReopen('COMPLETED', ' ').ok, false); assert.equal(T.canReopen('DELIVERED', 'x').ok, false);
});

test('status sekarang dan pembatalan langkah terakhir (termasuk langkah dilewati)', () => {
  const ev = [{ id: 1, status: 'PLANNING' }, { id: 2, status: 'READY' }, { id: 3, status: 'STARTED', skipped: 1 }, { id: 4, status: 'ARRIVED_PICKUP' }, { id: 5, status: 'LOADED' }];
  assert.equal(T.currentStatus(ev), 'LOADED'); assert.equal(T.currentStatus([]), 'PLANNING');
  assert.deepEqual(T.undoPlan(ev), { ok: true, ids: [5], status: 'ARRIVED_PICKUP' });
  const ev2 = ev.slice(0, 4); assert.deepEqual(T.undoPlan(ev2), { ok: true, ids: [3, 4], status: 'READY' });                 // ikut membatalkan STARTED yang dilewati
  assert.equal(T.currentStatus([...ev2.slice(0, 3), { ...ev2[3], voided_at: 'x' }]), 'STARTED');
  assert.equal(T.undoPlan([{ id: 1, status: 'PLANNING' }]).ok, false); assert.equal(T.undoPlan([]).ok, false);
  assert.equal(T.undoPlan([{ id: 1, status: 'PLANNING' }, { id: 2, status: 'READY', voided_at: 'x' }]).ok, false);
});

test('peringatan: perlu dicek (< 2 menit) dan tertahan (> 3 jam)', () => {
  const t0 = new Date('2026-10-16T01:00:00Z'), at = m => new Date(t0.getTime() + m * 60000);
  const ev = [{ id: 1, status: 'READY', source: 'OPS', at: at(0) }, { id: 2, status: 'STARTED', source: 'DRIVER', at: at(1) },            // langkah pertama driver: tidak ditandai
    { id: 3, status: 'ARRIVED_PICKUP', source: 'DRIVER', at: at(2) }, { id: 4, status: 'LOADED', source: 'DRIVER', at: at(10) }, { id: 5, status: 'IN_TRANSIT', source: 'DRIVER', manual: 1, at: at(10.5) }];
  assert.deepEqual(T.warnings({ status: 'IN_TRANSIT', status_at: at(10.5) }, ev, at(20)).needsCheck, ['ARRIVED_PICKUP']);              // manual tidak ditandai
  assert.equal(T.warnings({ status: 'IN_TRANSIT', status_at: at(0) }, ev, new Date(t0.getTime() + 3 * 3600e3)).stalled, false);          // tepat 3 jam: belum
  assert.equal(T.warnings({ status: 'IN_TRANSIT', status_at: at(0) }, ev, new Date(t0.getTime() + 3 * 3600e3 + 1000)).stalled, true);
  for (const s of ['STARTED', 'READY', 'PLANNING', 'DELIVERED', 'COMPLETED']) assert.equal(T.warnings({ status: s, status_at: at(0) }, [], new Date(t0.getTime() + 9 * 3600e3)).stalled, false, s);
  for (const s of ['ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST']) assert.equal(T.warnings({ status: s, status_at: at(0) }, [], new Date(t0.getTime() + 4 * 3600e3)).stalled, true, s);
  const skipped = [{ id: 1, status: 'READY', source: 'OPS', at: at(0) }, { id: 2, status: 'STARTED', source: 'DRIVER', skipped: 1, at: at(5) }, { id: 3, status: 'ARRIVED_PICKUP', source: 'DRIVER', at: at(5) }];
  assert.deepEqual(T.warnings({ status: 'ARRIVED_PICKUP', status_at: at(5) }, skipped, at(6)).needsCheck, []);                         // langkah dilewati tidak dihitung
  assert.equal(TRACKING.MIN_STEP_MS, 120000); assert.equal(TRACKING.MAX_VERIFY_FAILS, 5);
});

test('matchNopol: 4 angka, spasi/huruf kecil, kurang dari 4 digit, tanpa digit', () => {
  assert.equal(T.matchNopol('9123', 'B 9123 ABC'), true); assert.equal(T.matchNopol(' 9 1 2 3 ', 'b9123abc'), true); assert.equal(T.matchNopol('9124', 'B 9123 ABC'), false);
  assert.equal(T.matchNopol('912', 'B 9123 ABC'), false); assert.equal(T.matchNopol('91233', 'B 9123 ABC'), false); assert.equal(T.matchNopol('', 'B 9123 ABC'), false);
  assert.equal(T.matchNopol('12', 'B 12 XY'), true); assert.equal(T.matchNopol('1', 'B 12 XY'), false); assert.equal(T.matchNopol('0012', 'B 12 XY'), false);      // <4 digit: seluruh digitnya
  assert.equal(T.matchNopol('1234', 'B 12345 XY'), true);                                                                                                   // >4 digit: 4 pertama
  assert.equal(T.matchNopol('', 'DFA'), false); assert.equal(T.matchNopol('1234', 'DFA'), false); assert.equal(T.matchNopol(undefined, null), false);
});

test('status data lama', () => {
  assert.equal(T.legacyTrackStatus({ date_finish: '2025-01-02' }), 'COMPLETED'); assert.equal(T.legacyTrackStatus({ date_finish: null }), 'PLANNING'); assert.equal(T.legacyTrackStatus({}), 'PLANNING'); assert.equal(T.legacyTrackStatus(null), 'PLANNING');
});

test('token tautan: buat, baca, dan rusak', () => {
  const nonce = T.newNonce(); assert.match(nonce, /^[0-9a-f]{16}$/); assert.notEqual(nonce, T.newNonce());
  const tk = T.makeToken(42, nonce, SECRET), p = T.parseToken(tk); assert.deepEqual([p.dnId, p.nonce], [42, nonce]); assert.equal(T.checkToken(p, nonce, SECRET), true);
  assert.ok(tk.length < 60 && !/[^A-Za-z0-9_.-]/.test(tk));
  assert.equal(T.checkToken(p, T.newNonce(), SECRET), false);                         // nonce diganti (tautan dicabut/dibuat ulang)
  assert.equal(T.checkToken(p, nonce, 'rahasia-lain'), false);                        // rahasia server berbeda
  const [a, n, s] = tk.split('.');
  for (const bad of [`${Buffer.from('43').toString('base64url')}.${n}.${s}`, `${a}.${n}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`, `${a}.${n}`, `${a}.${n}.${s}.x`, '', 'abc', `${a}.ZZZZZZZZZZZZZZZZ.${s}`, `${Buffer.from('4x').toString('base64url')}.${n}.${s}`]) {
    const q = T.parseToken(bad); assert.equal(q && T.checkToken(q, nonce, SECRET), q ? false : null, bad);
  }
  assert.equal(T.parseToken(null), null); assert.equal(T.parseToken(undefined), null); assert.equal(T.checkToken(null, nonce, SECRET), false);
});

test('sesi driver: ruang lingkup, kedaluwarsa, dirusak', () => {
  const now = Date.UTC(2026, 9, 16), s = T.signSession({ dnId: 7, nonce: 'abcdef0123456789' }, SECRET, now);
  assert.deepEqual(T.verifySession(s, SECRET, now + 1000), { dnId: 7, nonce: 'abcdef0123456789' });
  assert.equal(T.verifySession(s, SECRET, now + TRACKING.SESSION_TTL_MS + 1), null);   // kedaluwarsa
  assert.equal(T.verifySession(s, 'rahasia-lain', now), null);
  const [b, m] = s.split('.'), body = Buffer.from(JSON.stringify({ d: 8, n: 'abcdef0123456789', e: now + 1e9 })).toString('base64url');
  assert.equal(T.verifySession(`${body}.${m}`, SECRET, now), null);                    // isi diganti
  for (const x of ['', null, undefined, 'x', `${b}.`, `${b}.${m}.z`, '.']) assert.equal(T.verifySession(x, SECRET, now), null);
});
