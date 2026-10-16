// Vendor yang sudah dipakai surat jalan tidak dihapus: cukup dinonaktifkan. Semua vendor yang ada tetap aktif.
exports.up = async m => { await m.addCol('vendors', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1'); };
