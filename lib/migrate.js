// Runner migrasi: migrations/NNN-*.js dijalankan berurutan sekali saja (dicatat di schema_migrations).
// Setiap langkah di dalam migrasi dijaga (hasTable/hasColumn/...) agar aman diulang bila terputus di tengah.
const fs = require('fs'), path = require('path');

function helpers(pool) {
  const q = async (sql, p) => (await pool.query(sql, p))[0];
  const one = async (sql, p) => (await q(sql, p))[0];
  const hasTable = async t => !!(await one('SELECT 1 x FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [t]));
  const hasColumn = async (t, c) => !!(await one('SELECT 1 x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [t, c]));
  const columnType = async (t, c) => (await one('SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [t, c]))?.ct || null;
  const hasIndex = async (t, i) => !!(await one('SELECT 1 x FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [t, i]));
  const fkOf = async (t, c) => (await q('SELECT CONSTRAINT_NAME n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL', [t, c])).map(r => r.n);
  const addCol = async (t, c, def) => { if (!(await hasColumn(t, c))) await q(`ALTER TABLE \`${t}\` ADD COLUMN \`${c}\` ${def}`); };
  const dropCol = async (t, c) => { if (await hasColumn(t, c)) await q(`ALTER TABLE \`${t}\` DROP COLUMN \`${c}\``); };
  const renameTable = async (a, b) => { if ((await hasTable(a)) && !(await hasTable(b))) await q(`RENAME TABLE \`${a}\` TO \`${b}\``); };
  const count = async (t, where = '1=1') => (await hasTable(t)) ? (await one(`SELECT COUNT(*) n FROM \`${t}\` WHERE ${where}`)).n : 0;
  return { pool, q, one, hasTable, hasColumn, columnType, hasIndex, fkOf, addCol, dropCol, renameTable, count, log: (...a) => console.log('[migrate]', ...a) };
}

async function migrate(pool, dir = path.join(__dirname, '..', 'migrations')) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations'))[0].map(r => r.name));
  const files = fs.readdirSync(dir).filter(f => /^\d+.*\.js$/.test(f)).sort();
  const ran = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const m = helpers(pool);
    m.log('menjalankan', f);
    await require(path.join(dir, f)).up(m);
    await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    ran.push(f);
  }
  return ran;
}
module.exports = { migrate, helpers };
