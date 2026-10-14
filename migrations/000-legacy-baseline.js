// Skema awal (demo) dibuat idempotent supaya DB kosong (baru / test) lewat jalur yang sama dengan DB lama.
const fs = require('fs'), path = require('path');
exports.up = async m => {
  await m.q(fs.readFileSync(path.join(__dirname, 'legacy-schema.sql'), 'utf8'));
  await m.addCol('users', 'pic_code', 'VARCHAR(4) NULL');
  await m.addCol('users', 'employee_no', 'VARCHAR(20) NULL');
  await m.addCol('jo_documents', 'category', "VARCHAR(40) NOT NULL DEFAULT 'Lainnya'");
};
