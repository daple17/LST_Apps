// Foto bukti absensi: satu foto per baris absensi (berkas disimpan di tabel files, owner_type 'attendance').
exports.up = async m => { await m.addCol('attendance', 'photo_file_id', 'INT NULL'); };
