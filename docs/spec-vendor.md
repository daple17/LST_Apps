# Spesifikasi: Data Master › Vendor

Pola sama dengan Customer (`docs/spec-customer.md`, `docs/ui-aksi.md`).

- Kode vendor dibuat otomatis dari nama (`lib/customer-code.js`), unik, terkunci setelah dibuat (tampil di surat jalan). Kode manual hanya diterima dari pemanggil lama (2-10 huruf/angka).
- Nama unik (tak peka huruf besar/kecil). Kota ≤100, PIC ≤80, NPWP ≤30, negara harus ada di `countries`.
- Vendor yang dipakai surat jalan tidak bisa dihapus, hanya dinonaktifkan. Vendor nonaktif tidak muncul di pilihan surat jalan baru (surat jalan lama tetap menampilkannya).
- `needs_code_review` (dari migrasi lama) hanya bisa dihapus, tidak dipasang.
- Izin: `vendor.view/create/update/delete/export`. Audit entity `vendor`. Excel mengikuti filter.
- Migrasi `014-vendor-active.js` menambah `vendors.is_active`.

## Tarif per rute (permintaan client)
Tabel `vendor_rates` (migrasi 015): per vendor, banyak baris asal → tujuan, satuan `RITASE` atau `TON`, harga (Rp). Unik per vendor+asal+tujuan+satuan. API `/api/vendors/:id/rates` (GET → `vendor.view`; POST/PUT/DELETE → `vendor.update`), diaudit. UI: ⋯ › Tarif. Biaya PO nanti = harga × jumlah ritase atau ton sesuai satuan tarif; PO sebaiknya menyalin (snapshot) harga saat dibuat. Tarif tanpa tanggal berlaku; riwayat harga hanya lewat audit log.

## Belum / perlu konfirmasi
- `vendor.jenis` di sistem lama belum jelas artinya, jadi tidak diimpor.
- Tabel `countries` hanya terisi dari impor data lama; di database tanpa impor, pilihan Negara kosong.
