// Tracking progres surat jalan: logika murni (tanpa DB), diuji di tests/tracking.test.js. Aturan: docs/prompt-tracking-messi.md.
const crypto = require('crypto');
const { TRACKING } = require('./rules');

const STATUSES = ['PLANNING', 'READY', 'STARTED', 'ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST', 'DELIVERED', 'COMPLETED'];
const LABELS = { PLANNING: 'Planning', READY: 'Ready', STARTED: 'Berangkat ke lokasi muat', ARRIVED_PICKUP: 'Tiba di lokasi muat', LOADED: 'Selesai muat', IN_TRANSIT: 'Dalam perjalanan', ARRIVED_DEST: 'Tiba di tujuan', DELIVERED: 'Diterima', COMPLETED: 'Completed' };
const DRIVER_STEPS = STATUSES.slice(2, 8);                                  // STARTED..DELIVERED
const SKIPPABLE = new Set(['STARTED', 'LOADED', 'ARRIVED_DEST']);           // boleh dilewati vendor luar
const STALL_STATUSES = new Set(['ARRIVED_PICKUP', 'LOADED', 'IN_TRANSIT', 'ARRIVED_DEST']);
const idx = s => STATUSES.indexOf(s);
const ms = t => (t instanceof Date ? t.getTime() : new Date(t).getTime());

const fail = error => ({ ok: false, error });
// Status berikutnya yang boleh dipilih untuk langkah driver. Armada sendiri: hanya satu (berurutan). Vendor luar: langkah opsional boleh dilewati.
function nextAllowed(status, ownFleet) {
  const i = idx(status); if (i < 1 || i >= idx('DELIVERED')) return [];
  const out = [{ status: STATUSES[i + 1], skips: [] }];
  if (!ownFleet) for (let j = i + 1, skips = []; j < idx('DELIVERED') && SKIPPABLE.has(STATUSES[j]); j++) { skips = [...skips, STATUSES[j]]; out.push({ status: STATUSES[j + 1], skips }); }
  return out;
}
// Validasi satu perubahan status. actor: 'OPS' | 'DRIVER'. Operasional boleh mengisi langkah driver hanya dengan catatan (manual).
function canTransition({ from, to, actor, ownFleet = true, note = '' }) {
  if (idx(from) < 0 || idx(to) < 0) return fail('Status tidak dikenal');
  if (from === 'COMPLETED') return fail('Surat jalan sudah Completed; buka kembali dulu');
  if (to === 'PLANNING') return fail('Status Planning hanya untuk surat jalan baru');
  if (to === 'READY') return actor === 'OPS' ? (from === 'PLANNING' ? { ok: true, skipped: [], manual: false } : fail('Ready hanya dari Planning')) : fail('Hanya operasional yang boleh menandai Ready');
  if (to === 'COMPLETED') return actor !== 'OPS' ? fail('Hanya operasional yang boleh menyelesaikan') : from === 'DELIVERED' ? { ok: true, skipped: [], manual: false } : fail('Completed hanya dari Diterima');
  const hit = nextAllowed(from, ownFleet).find(n => n.status === to);
  if (!hit) return fail(from === 'PLANNING' ? 'Surat jalan belum Ready' : 'Langkah tidak sesuai urutan');
  if (actor === 'OPS' && !String(note || '').trim()) return fail('Catatan wajib saat menginput atas nama driver');
  return { ok: true, skipped: hit.skips, manual: actor === 'OPS' };
}
// Buka kembali: hanya COMPLETED -> DELIVERED dengan alasan
const canReopen = (from, reason) => from !== 'COMPLETED' ? fail('Hanya surat jalan Completed yang bisa dibuka kembali') : !String(reason || '').trim() ? fail('Alasan wajib diisi') : { ok: true, to: 'DELIVERED' };

// events: urut naik (id), tiap: { id, status, source, at, manual, skipped, voided_at }. Status sekarang = event terakhir yang tidak dibatalkan.
const live = events => events.filter(e => !e.voided_at);
const currentStatus = events => live(events).at(-1)?.status || 'PLANNING';
// Membatalkan langkah terakhir ikut membatalkan langkah "dilewati" yang menempel sebelumnya. Event PLANNING awal tidak bisa dibatalkan.
function undoPlan(events) {
  const l = live(events), last = l.at(-1);
  if (!last || last.status === 'PLANNING') return fail('Tidak ada langkah yang bisa dibatalkan');
  const ids = [last.id]; for (let k = l.length - 2; k >= 0 && l[k].skipped; k--) ids.unshift(l[k].id);
  const rest = l.filter(e => !ids.includes(e.id));
  return { ok: true, ids, status: rest.at(-1)?.status || 'PLANNING' };
}

// Peringatan dihitung, tidak disimpan. needsCheck: langkah driver (bukan input manual) tercatat < 2 menit setelah langkah driver sebelumnya.
function warnings({ status, status_at }, events, now = new Date()) {
  const real = live(events).filter(e => !e.skipped), needsCheck = [];
  for (let k = 1; k < real.length; k++) {
    const e = real[k], p = real[k - 1];
    if (e.source === 'DRIVER' && !e.manual && DRIVER_STEPS.includes(p.status) && ms(e.at) - ms(p.at) < TRACKING.MIN_STEP_MS) needsCheck.push(e.status);
  }
  const heldMs = status_at ? ms(now) - ms(status_at) : 0;
  return { needsCheck, stalled: STALL_STATUSES.has(status) && heldMs > TRACKING.STALL_MS, heldMs: Math.max(0, heldMs) };
}

// 4 angka nopol: semua digit nopol; bila lebih dari 4 digit dipakai 4 digit pertama (blok nomor pelat). Nopol tanpa digit tidak pernah cocok.
const digits = s => String(s ?? '').replace(/\D/g, '');
function matchNopol(input, nopol) {
  const d = digits(nopol), want = d.length > 4 ? d.slice(0, 4) : d, got = digits(input);
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
// Data lama: date_finish terisi -> COMPLETED, selain itu PLANNING
const legacyTrackStatus = row => (row && row.date_finish ? 'COMPLETED' : 'PLANNING');

// ----- token tautan driver: base64url(dnId).nonce.sig ; sig = HMAC-SHA256(secret, dnId.nonce) 16 byte -----
const b64 = s => Buffer.from(s).toString('base64url');
const newNonce = () => crypto.randomBytes(8).toString('hex');
const sig = (secret, dnId, nonce) => crypto.createHmac('sha256', secret).update(`${dnId}.${nonce}`).digest().subarray(0, 16).toString('base64url');
const makeToken = (dnId, nonce, secret) => `${b64(String(dnId))}.${nonce}.${sig(secret, dnId, nonce)}`;
function parseToken(token) {
  const m = /^([A-Za-z0-9_-]{1,16})\.([0-9a-f]{16})\.([A-Za-z0-9_-]{22})$/.exec(String(token || '')); if (!m) return null;
  const id = Buffer.from(m[1], 'base64url').toString(); return /^\d{1,10}$/.test(id) ? { dnId: +id, nonce: m[2], sig: m[3] } : null;
}
// nonce = track_nonce dari DB; tanda tangan diperiksa dengan timingSafeEqual
function checkToken(parsed, nonce, secret) {
  if (!parsed || !nonce || parsed.nonce !== nonce) return false;
  const a = Buffer.from(sig(secret, parsed.dnId, nonce)), b = Buffer.from(parsed.sig); return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// sesi driver (setelah verifikasi nopol): ruang lingkup satu surat jalan, memuat nonce agar mati saat tautan dicabut/diganti
const hmac = (secret, body) => crypto.createHmac('sha256', secret).update('sess:' + body).digest('base64url');
const signSession = ({ dnId, nonce }, secret, now = Date.now()) => { const body = b64(JSON.stringify({ d: dnId, n: nonce, e: now + TRACKING.SESSION_TTL_MS })); return `${body}.${hmac(secret, body)}`; };
function verifySession(token, secret, now = Date.now()) {
  const [body, mac, extra] = String(token || '').split('.'); if (!body || !mac || extra !== undefined) return null;
  const a = Buffer.from(hmac(secret, body)), b = Buffer.from(mac); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.e > now ? { dnId: p.d, nonce: p.n } : null; } catch { return null; }
}

module.exports = { STATUSES, LABELS, DRIVER_STEPS, SKIPPABLE, nextAllowed, canTransition, canReopen, currentStatus, undoPlan, warnings, matchNopol, legacyTrackStatus, newNonce, makeToken, parseToken, checkToken, signSession, verifySession };
