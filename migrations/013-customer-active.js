// Customer tidak dihapus bila sudah dipakai: cukup dinonaktifkan. Semua customer yang ada tetap aktif.
exports.up = async m => { await m.addCol('customers', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1'); };
