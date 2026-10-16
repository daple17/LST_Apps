# Spesifikasi menu Customer (Data Master › Customer)

## Aturan
1. **Kode customer dibuat otomatis** oleh server saat customer dibuat: 3 huruf kapital (dipakai di nomor JO, mis. `0027USC`). Pengguna tidak mengetik kode. Algoritma (`lib/customer-code.js`): nama tanpa badan usaha (PT, CV, UD, Tbk, …) → inisial tiga kata pertama (`PT BERKAH TRANS UTAMA` → `BTU`); dua kata → dua inisial + huruf kedua kata pertama; satu kata → tiga huruf pertama; bila bentrok, huruf ketiga divariasikan (huruf dari nama dulu, lalu A–Z). Pembuatan bersamaan aman (kode unik di database, dihitung ulang bila bentrok). Form menampilkan **usulan** kode; kode final ditetapkan saat disimpan.
2. **Kode tidak bisa diubah** setelah dibuat (server menolak, `fields.code`).
3. **Tidak dihapus bila sudah dipakai**: customer yang punya Job Order hanya **dinonaktifkan**; hapus permanen hanya untuk yang belum dipakai JO (izin `customer.delete`). Customer nonaktif tidak muncul di pilihan form JO baru dan tidak bisa dipakai membuat JO baru; JO lama tetap utuh.
4. Nama unik (tak peka huruf besar/kecil). Email, telepon, NPWP, kota, alamat opsional; email divalidasi formatnya.
5. Customer hasil migrasi dengan nickname bukan 3 huruf diberi tanda **Tinjau** (`needs_code_review`). Tanda hanya bisa dihapus ("kode sudah saya tinjau"), tidak bisa dipasang; kodenya tetap terkunci.

## Layar `#customer`
Kartu (Total, Aktif, Nonaktif, Kode perlu ditinjau; klik = filter), pencarian (kode, nama, kota, email, telepon, NPWP), filter status, Download Excel, + Tambah Customer, tabel (Kode, Nama, Kota, Telepon, Email, NPWP, jumlah JO yang menautkan ke daftar JO customer itu, Status, Edit), paginasi 20 baris. Form modal: usulan kode, status (edit), nama, kota, telepon, email, NPWP, alamat. Tombol disembunyikan sesuai izin.
"+ baru" di form Job Order juga memakai kode otomatis.

## API (`routes/customers.js`, izin `customer.*` termasuk `customer.export` yang baru)
`GET /api/customers` (`q`, `status=active|inactive|review`, `page`; ringkasan), `GET /export`, `GET /suggest-code?name=` (`customer.create`), `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/deactivate|activate` (`customer.update`), `DELETE /:id` (`customer.delete`; ditolak bila dipakai JO). Setiap perubahan masuk `audit_log` (entity `customer`, sebelum → sesudah). Migrasi `013-customer-active.js` menambah `customers.is_active`.

## Keputusan di luar permintaan
- `POST /api/customers` masih menerima `code` manual (3 huruf, unik) untuk pemanggil lama; form baru tidak memakainya.
- Tombol "jumlah JO" membuka daftar JO tanpa batas periode, tersaring ke customer itu.
- Tidak ada pindah kode atau penggabungan customer ganda (belum diminta; kode terkunci karena dipakai nomor JO).
