// jo_materials sudah punya kolom `origin` (lokasi asal barang, teks); penanda asal data memakai kolom terpisah `data_origin`.
exports.up = async m => { await m.addCol('jo_materials', 'data_origin', "ENUM('NEW','LEGACY') NOT NULL DEFAULT 'NEW'"); };
