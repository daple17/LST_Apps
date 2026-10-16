# Spesifikasi: Data Master › Vendor

Pola sama dengan Customer (`docs/spec-customer.md`, `docs/ui-aksi.md`).

- Kode vendor dibuat otomatis dari nama (`lib/customer-code.js`), unik, terkunci setelah dibuat (tampil di surat jalan). Kode manual hanya diterima dari pemanggil lama (2-10 huruf/angka).
- Nama unik (tak peka huruf besar/kecil). Kota ≤100, PIC ≤80, NPWP ≤30, negara harus ada di `countries`.
- Vendor yang dipakai surat jalan tidak bisa dihapus, hanya dinonaktifkan. Vendor nonaktif tidak muncul di pilihan surat jalan baru (surat jalan lama tetap menampilkannya).
- `needs_code_review` (dari migrasi lama) hanya bisa dihapus, tidak dipasang.
- Izin: `vendor.view/create/update/delete/export`. Audit entity `vendor`. Excel mengikuti filter.
- Migrasi `014-vendor-active.js` menambah `vendors.is_active`.

## Tarif (revisi client)
Diinput di form Tambah/Edit Vendor, tiga bagian terpisah:
- **Tarif kota:** daftar (kota → harga > 0), tabel `vendor_rates` (unik per vendor+kota). Kota dipilih dari dropdown master `cities` (migrasi 018, ±60 kota awal; `GET /api/vendors/cities`). Kota yang belum ada ditambah lewat tombol di form (`POST /api/vendors/cities`, izin `vendor.update`, dicek tanpa peka huruf besar/kecil sehingga tidak ada dua penulisan). Dikirim sebagai `rates` berisi `city_id`; bila dikirim, daftar diganti utuh dalam satu transaksi; bila tidak, tidak berubah.
- **Tarif tonase** dan **tarif ritase:** satu angka per vendor (`vendors.price_ton`, `vendors.price_trip`, ≥ 0, 0 = tidak ada).
Semua diaudit. Migrasi 015–017. Perhitungan ada di menu PO (belum dibuat): biaya = tarif kota + tarif tonase + tarif ritase.
**Asumsi:** angka dijumlahkan apa adanya; pengalian dengan jumlah ton/ritase adalah aturan PO. PO sebaiknya menyalin harga saat dibuat. Tidak ada tanggal berlaku.

## Belum / perlu konfirmasi
- `vendor.jenis` di sistem lama belum jelas artinya, jadi tidak diimpor.
- Tabel `countries` hanya terisi dari impor data lama; di database tanpa impor, pilihan Negara kosong.
