// Utilitas bersama skrip impor data sistem lama (hanya untuk uji lokal).
const mysql = require('mysql2/promise');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'legacy', 'mysql', 'mariadb']);   // nama service docker lokal
const isLocalHost = h => LOCAL_HOSTS.has(String(h || '').toLowerCase());

function parseArgs(argv) {
  const o = { lokal: false, legacyDb: 'lst_legacy', legacyHost: process.env.LEGACY_HOST || '127.0.0.1', legacyPort: +(process.env.LEGACY_PORT || 3308), legacyUser: process.env.LEGACY_USER || 'root', legacyPass: process.env.LEGACY_PASS || 'root',
    dryRun: false, commit: false, only: null, resetLegacy: false, activeWindowDays: 30, outDir: null, reportDir: null };
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'lokal') o.lokal = true; else if (k === 'dry-run') o.dryRun = true; else if (k === 'commit') o.commit = true; else if (k === 'reset-legacy') o.resetLegacy = true;
    else if (k === 'legacy-db') o.legacyDb = v; else if (k === 'legacy-host') o.legacyHost = v; else if (k === 'legacy-port') o.legacyPort = +v; else if (k === 'legacy-user') o.legacyUser = v; else if (k === 'legacy-pass') o.legacyPass = v; else if (k === 'only') o.only = new Set(v.split(',').map(s => s.trim()).filter(Boolean));
    else if (k === 'active-window-days') o.activeWindowDays = +v; else if (k === 'report-dir') o.reportDir = v; else throw new Error(`Opsi tidak dikenal: ${a}`);
  }
  if (o.dryRun && o.commit) throw new Error('--dry-run dan --commit tidak bisa dipakai bersamaan');
  return o;
}
// Menolak berjalan bila bukan lokal: flag --lokal wajib, dan KEDUA host (tujuan dan sistem lama) harus lokal.
function assertLocal(o, target) {
  if (!o.lokal) throw new Error('Ditolak: skrip ini hanya untuk uji lokal. Tambahkan --lokal (dan pastikan MySQL tujuan di komputer ini).');
  if (!isLocalHost(target.host)) throw new Error(`Ditolak: host MySQL tujuan "${target.host}" bukan lokal.`);
  if (!isLocalHost(o.legacyHost)) throw new Error(`Ditolak: host database sistem lama "${o.legacyHost}" bukan lokal.`);
}
const connectLegacy = o => mysql.createPool({ host: o.legacyHost, port: o.legacyPort, user: o.legacyUser, password: o.legacyPass, database: o.legacyDb, dateStrings: true, timezone: 'Z', charset: 'utf8mb4', connectionLimit: 4 });

// tanggal sistem lama -> 'YYYY-MM-DD' atau null ('0000-00-00' dianggap kosong)
const dt = v => (!v || /^0000-00-00/.test(String(v)) ? null : String(v).slice(0, 10));
const dtt = v => (!v || /^0000-00-00/.test(String(v)) ? null : String(v).slice(0, 19));
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const trunc = (s, n) => (s == null ? null : String(s).slice(0, n));

// Konteks satu run: koneksi tujuan (dalam transaksi), statistik, karantina.
function makeCtx(conn, legacy, opts) {
  const stats = {}, quarantine = [], notes = {};
  const st = name => (stats[name] ||= { source: 0, inserted: 0, updated: 0, quarantined: 0, skipped: 0, details: {} });
  const q = async (sql, p) => (await conn.query(sql, p))[0];
  const L = async (sql, p) => (await legacy.query(sql, p))[0];
  const q1 = async (sql, p) => (await q(sql, p))[0];
  const detail = (table, key, n = 1) => { const d = st(table).details; d[key] = (d[key] || 0) + n; };
  const addNote = (table, line) => { (notes[table] ||= []).push(line); };
  const quar = (table, legacyId, reason, payload) => { st(table).quarantined++; quarantine.push({ source_table: table, legacy_id: legacyId, reason, payload: payload || null }); };
  // upsert massal berdasar kunci unik (legacy_id): kembalikan jumlah baris sebelum/sesudah
  async function upsert(table, cols, rows, updateCols = cols.filter(c => c !== 'legacy_id'), chunk = 400) {
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk); if (!part.length) continue;
      await q(`INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(',')}) VALUES ? ON DUPLICATE KEY UPDATE ${updateCols.map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',')}`, [part.map(r => cols.map(c => r[c] ?? null))]);
    }
  }
  const legacyMap = async (table) => new Map((await q(`SELECT legacy_id, id FROM \`${table}\` WHERE legacy_id IS NOT NULL`)).map(r => [Number(r.legacy_id), r.id]));
  const count = async (table, where = '1=1') => (await q1(`SELECT COUNT(*) n FROM \`${table}\` WHERE ${where}`)).n;
  return { conn, legacy, opts, stats, st, quarantine, notes, q, q1, L, detail, addNote, quar, upsert, legacyMap, count };
}
module.exports = { parseArgs, assertLocal, isLocalHost, connectLegacy, makeCtx, dt, dtt, num, trunc };
