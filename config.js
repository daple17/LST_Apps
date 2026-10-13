// Konfigurasi dari env. Railway: pakai MYSQL_URL atau MYSQLHOST/MYSQLPORT/...; lokal: DB_* atau default docker-compose.
const e = process.env;
const isProd = e.NODE_ENV === 'production' || !!e.RAILWAY_ENVIRONMENT;
const db = { multipleStatements: true, dateStrings: true, timezone: 'Z' };
if (e.MYSQL_URL || e.DATABASE_URL) {
  const u = new URL(e.MYSQL_URL || e.DATABASE_URL);
  Object.assign(db, { host: u.hostname, port: +u.port || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
} else {
  Object.assign(db, {
    host: e.MYSQLHOST || e.DB_HOST || '127.0.0.1', port: +(e.MYSQLPORT || e.DB_PORT || 3307),
    user: e.MYSQLUSER || e.DB_USER || 'root', password: e.MYSQLPASSWORD || e.DB_PASS || 'root', database: e.MYSQLDATABASE || e.DB_NAME || 'lesat',
  });
}
if (isProd && !(e.JWT_SECRET || '').trim()) {
  const seen = Object.keys(e).filter(k => /JWT|ADMIN|MYSQL|UPLOAD|RAILWAY_SERVICE_NAME/.test(k)).join(', ') || '(tidak ada)';
  console.error(`JWT_SECRET wajib diisi di production. JWT_SECRET ${'JWT_SECRET' in e ? 'ada tapi kosong' : 'tidak ditemukan'}. Variabel terkait yang terbaca: ${seen}`);
  process.exit(1);
}
module.exports = { isProd, seedDummy: e.SEED_DUMMY || '', db, secret: e.JWT_SECRET || 'lesat-dev-secret', uploadDir: e.UPLOAD_DIR || require('path').join(__dirname, 'uploads'), adminPassword: e.ADMIN_PASSWORD || (isProd ? '' : 'admin123') };
