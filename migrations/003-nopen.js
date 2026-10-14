// Nopen (nomor pendaftaran PIB/PEB) + tanggal dipakai di PDF Surat Jalan; disimpan sebagai jenis referensi tambahan.
exports.up = async m => {
  const ct = await m.columnType('jo_references', 'kind');
  if (ct && !/NOPEN/i.test(ct)) await m.q("ALTER TABLE jo_references MODIFY kind ENUM('AJU','INVOICE','BL','SI_DO','SI_PO','NOPEN') NOT NULL");
};
