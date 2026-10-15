#!/usr/bin/env node
// Impor data sistem lama (MariaDB) -> LESAT. HANYA UNTUK UJI LOKAL. Contoh:
//   node scripts/legacy-import/index.js --lokal                       (dry-run: tidak menulis)
//   node scripts/legacy-import/index.js --lokal --commit              (tulis ke database tujuan, mis. DB_NAME=lst_dev)
//   node scripts/legacy-import/index.js --lokal --reset-legacy        (hapus hasil impor di database tujuan)
// Opsi: --legacy-db= --legacy-host= --legacy-port= --only=customers,vendors --active-window-days=30 --report-dir=
const fs = require('fs'), path = require('path'), mysql = require('mysql2/promise');
const cfg = require('../../config');
const C = require('./common'), master = require('./master'), { job_orders } = require('./job-orders'), { counters } = require('./counters'), { resetLegacy } = require('./reset');

const STEPS = [['countries', master.countries], ['ports', master.ports], ['tps', master.tps], ['customers', master.customers], ['vendors', master.vendors], ['shippers', master.shippers], ['users', master.users], ['job_orders', job_orders]];
try { const more = require('./deliveries'); STEPS.push(...more.STEPS); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
STEPS.push(['counters', counters]);

async function run(argv, { log = console.log, target: tcfg = cfg.db } = {}) {
  const o = C.parseArgs(argv);
  C.assertLocal(o, tcfg);
  const target = mysql.createPool({ ...tcfg, multipleStatements: false, connectionLimit: 4 }), legacy = C.connectLegacy(o);
  const mode = o.resetLegacy && !o.commit && !o.dryRun ? 'reset' : o.commit ? 'commit' : 'dry-run', write = mode !== 'dry-run';
  const conn = await target.getConnection(), started = new Date();
  log(`[impor] tujuan: ${tcfg.host}:${tcfg.port}/${tcfg.database}  sistem lama: ${o.legacyHost}:${o.legacyPort}/${o.legacyDb}  mode: ${mode}${write ? '' : ' (tidak menulis)'}`);
  const ctx = C.makeCtx(conn, legacy, o);
  let err = null;
  try {
    await conn.query('SET SESSION sql_mode = (SELECT REPLACE(@@sql_mode, "ONLY_FULL_GROUP_BY", ""))');
    await conn.beginTransaction();
    if (mode === 'commit') { const b = await ctx.q1("SELECT last FROM counters WHERE name='JO' AND period=''"); ctx.countersBefore = { JO: b ? b.last : null }; }   // dipakai --reset-legacy untuk mengembalikan penghitung
    if (o.resetLegacy) await resetLegacy(ctx);
    if (mode !== 'reset') for (const [name, fn] of STEPS) {
      if (o.only && !o.only.has(name)) continue;
      const t0 = Date.now();
      await ctx.q('DELETE FROM legacy_quarantine WHERE source_table=? AND resolved_at IS NULL', [name]);   // karantina dibangun ulang tiap run
      await fn(ctx); log(`[impor] ${name} selesai (${Date.now() - t0} ms)`);
    }
    if (write) { for (const q of ctx.quarantine) await ctx.q('INSERT INTO legacy_quarantine (source_table, legacy_id, reason, payload) VALUES (?,?,?,?)', [q.source_table, q.legacy_id, q.reason, q.payload ? JSON.stringify(q.payload) : null]); await conn.commit(); } else await conn.rollback();
  } catch (e) { err = e; await conn.rollback().catch(() => {}); }
  // catatan run (di luar transaksi data)
  const summary = { stats: ctx.stats, quarantined: ctx.quarantine.length, error: err ? err.message : null, ...(ctx.countersBefore ? { counters_before: ctx.countersBefore } : {}) };
  await target.query('INSERT INTO import_runs (started_at, finished_at, mode, summary) VALUES (?, NOW(), ?, ?)', [started, mode, JSON.stringify(summary)]).catch(() => {});
  const report = writeReport(o, mode, started, ctx, err, tcfg); log(`[impor] laporan: ${report.md}`);
  conn.release(); await target.end(); await legacy.end();
  if (err) throw err;
  return { ctx, report, mode };
}

function writeReport(o, mode, started, ctx, err, tcfg = cfg.db) {
  const dir = o.reportDir || path.join(__dirname, '..', '..', 'data', 'reports'); fs.mkdirSync(dir, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19), md = path.join(dir, `run-${stamp}.md`), csv = path.join(dir, `run-${stamp}-karantina.csv`);
  const L = [`# Laporan impor ${mode} — ${started.toISOString()}`, '', `- Tujuan: ${tcfg.host}:${tcfg.port}/${tcfg.database} · Sistem lama: ${o.legacyHost}:${o.legacyPort}/${o.legacyDb}`, `- Mode: **${mode}**${mode === 'dry-run' ? ' (semua perubahan dibatalkan)' : ''}`, err ? `- **GAGAL**: ${err.message}` : '- Status: selesai', '',
    '| Tabel | Sumber | Diimpor (baru) | Diperbarui | Dikarantina | Dilewati |', '|---|---:|---:|---:|---:|---:|'];
  for (const [t, s] of Object.entries(ctx.stats)) L.push(`| ${t} | ${s.source} | ${s.inserted} | ${s.updated} | ${s.quarantined} | ${s.skipped} |`);
  for (const [t, s] of Object.entries(ctx.stats)) if (Object.keys(s.details).length) { L.push('', `### ${t}`); for (const [k, v] of Object.entries(s.details)) L.push(`- ${k}: ${v}`); }
  for (const [t, ns] of Object.entries(ctx.notes)) { L.push('', `### Catatan: ${t}`); ns.forEach(n => L.push(n.startsWith('  -') ? n : `- ${n}`)); }
  const byReason = {}; for (const q of ctx.quarantine) { const k = `${q.source_table}: ${q.reason.replace(/#\d+|\b\d{3,}\b/g, 'N')}`; byReason[k] = (byReason[k] || 0) + 1; }
  L.push('', '### Karantina (ringkasan alasan)'); Object.entries(byReason).forEach(([k, v]) => L.push(`- ${v} × ${k}`)); if (!ctx.quarantine.length) L.push('- (tidak ada)');
  fs.writeFileSync(md, L.join('\n') + '\n');
  fs.writeFileSync(csv, ['tabel,legacy_id,alasan', ...ctx.quarantine.map(q => [q.source_table, q.legacy_id, `"${String(q.reason).replace(/"/g, '""')}"`].join(','))].join('\n') + '\n');
  return { md, csv };
}

module.exports = { run, STEPS };
if (require.main === module) run(process.argv.slice(2)).catch(e => { console.error('[impor] ' + e.message); process.exit(1); });
