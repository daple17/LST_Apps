// Jalankan migrasi manual: npm run migrate (server juga menjalankannya otomatis saat start)
const mysql = require('mysql2/promise');
const cfg = require('../config');
const { migrate } = require('../lib/migrate');
const pool = mysql.createPool(cfg.db);
migrate(pool).then(r => { console.log(r.length ? `Migrasi dijalankan: ${r.join(', ')}` : 'Tidak ada migrasi baru'); return pool.end(); }).catch(e => { console.error(e); process.exit(1); });
