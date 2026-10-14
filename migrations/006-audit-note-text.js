// Catatan audit perubahan izin role bisa panjang (daftar izin ditambah/dicabut): lebarkan kolom note.
exports.up = async m => {
  const ct = await m.columnType('audit_log', 'note');
  if (ct && !/text/i.test(ct)) await m.q('ALTER TABLE audit_log MODIFY note TEXT NULL');
};
