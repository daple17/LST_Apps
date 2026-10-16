# Konvensi kolom "Aksi"

Semua tabel yang punya aksi per baris memakai **satu komponen**: `rowMenu(label, items)` di `public/app.js` (tombol ⋯ yang membuka daftar item, gaya yang sama dengan menu Job Order). Judul kolom selalu **Aksi**.

- Item berbentuk `{ t: 'Edit', js: 'fungsi(id)', danger, disabled, title }`. Aksi berbahaya (Hapus, Nonaktifkan) memakai `danger: true`: tampil merah dan dipisah garis di bagian bawah. Item yang tidak boleh dipakai dibuat `disabled` dengan `title` berisi alasannya (mis. "Dipakai 3 Job Order: nonaktifkan saja").
- Menu dibuka dengan klik atau Enter/Spasi; panah atas/bawah, Home/End berpindah item; **Esc** menutup dan mengembalikan fokus ke tombol; Tab menutup.
- Hak akses: item disembunyikan sesuai izin lewat `PERM_BTN` (mengecek isi `onclick`); bila semua item tersembunyi, tombol ⋯ ikut hilang.
- Daftar kolom aksi saat ini: JO (Detail, Dokumen, Preview, Edit), Dashboard (Go to.., Copy Report), Handling Ops (Buka Report Material, Buka Trucking Delivery, Copy Report, Download Excel), surat jalan (Detail, Finish Loading), User Management (Edit, Nonaktifkan/Aktifkan), COA akun (Edit, Nonaktifkan/Aktifkan), COA kelompok (Edit, Nonaktifkan/Aktifkan, Hapus bila kosong), Customer (Edit, Nonaktifkan/Aktifkan, Hapus bila belum dipakai JO), material JO (Edit, Hapus), dokumen JO (Download, Ganti file, Hapus), Check In (Edit report; Detail dan Koreksi status di rekap).
- Aturan hapus: **akun COA tidak pernah dihapus** (API membalas 405; hanya dinonaktifkan). Kelompok COA hanya bila belum punya akun (izin `coa.delete`). Customer hanya bila belum dipakai JO.
