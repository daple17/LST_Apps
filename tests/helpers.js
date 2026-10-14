// Helper test: database khusus test (lesat_test*) di MySQL yang sama dengan docker-compose.
const mysql = require('mysql2/promise');
const cfg = require('../config');

async function freshDb(name) {
  const root = await mysql.createConnection({ ...cfg.db, database: undefined, multipleStatements: true });
  await root.query(`DROP DATABASE IF EXISTS \`${name}\`; CREATE DATABASE \`${name}\``);
  await root.end();
  return mysql.createPool({ ...cfg.db, database: name, connectionLimit: 30 });
}
async function dbAvailable() {
  try { const c = await mysql.createConnection({ ...cfg.db, database: undefined }); await c.end(); return true; } catch { return false; }
}
module.exports = { freshDb, dbAvailable };
