# Spesifikasi: Data Master › Vendor

Pola sama dengan Customer (`docs/spec-customer.md`, `docs/ui-aksi.md`).

- Kode vendor dibuat otomatis dari nama (`lib/customer-code.js`), unik, terkunci setelah dibuat (tampil di surat jalan). Kode manual hanya diterima dari pemanggil lama (2-10 huruf/angka).
- Nama unik (tak peka huruf besar/kecil). Kota ≤100, PIC ≤80, NPWP ≤30, negara harus ada di `countries`.
- Vendor yang dipakai surat jalan tidak bisa dihapus, hanya dinonaktifkan. Vendor nonaktif tidak muncul di pilihan surat jalan baru (surat jalan lama tetap menampilkannya).
- `needs_code_review` (dari migrasi lama) hanya bisa dihapus, tidak dipasang.
- Izin: `vendor.view/create/update/delete/export`. Audit entity `vendor`. Excel mengikuti filter.
- Migrasi `014-vendor-active.js` menambah `vendors.is_active`.

## Tarif per kota (revisi client)
Diinput di form Tambah/Edit Vendor (bagian "Tarif per kota"); tabel `vendor_rates` (migrasi 016, menggantikan bentuk asal→tujuan di 015). Satu baris per kota (unik per vendor): tarif jarak kota (> 0), tarif tonase, tarif ritase (≥ 0, isi 0 bila tidak ada). Dikirim sebagai `rates` pada POST/PUT `/api/vendors`; bila `rates` dikirim, daftar diganti utuh (satu transaksi); bila tidak dikirim, tarif tidak berubah. Diaudit ("Tarif diubah"). Izin sama dengan vendor.
Perhitungan ada di menu PO (belum dibuat): biaya = tarif jarak kota + tarif tonase + tarif ritase.
**Asumsi yang perlu dikonfirmasi:** tarif tonase dan ritase diisi per kota, dan dijumlahkan apa adanya (belum dikalikan jumlah ton/ritase; itu aturan PO). PO sebaiknya menyalin harga saat dibuat. Tidak ada tanggal berlaku.

## Belum / perlu konfirmasi
- `vendor.jenis` di sistem lama belum jelas artinya, jadi tidak diimpor.
- Tabel `countries` hanya terisi dari impor data lama; di database tanpa impor, pilihan Negara kosong.
