# Spesifikasi Check In & Daily Report (HR/SDM)

Sumber: sheet HOME (halaman Check in dan Daily Report) di `Aplikasi_Web_Base.xlsx` dan sheet "FITUR ABSEN" di `APPROVAL DAN ABSEN.xlsx`; prompt: `docs/prompt-checkin-ujang.md`. Status: dibangun (Check In, Daily Report, Rekap HR, ekspor Excel).

## Aturan bisnis
1. Satu check in per pegawai per hari (UNIQUE `user_id, work_date`). Kedua kali → 409 dengan pesan "Anda sudah check in hari ini pukul HH:MM". Pegawai tidak bisa membatalkan.
2. **Waktu dan tanggal dari server**, zona Asia/Jakarta (WIB, UTC+7). Disimpan UTC; "hari" = hari kalender WIB. Jam hidup di layar = jam perangkat + selisih terhadap jam server dari `GET /api/checkin/today`. Tanggal/jam dari klien diabaikan (diuji).
3. Kode status: `WFO`, `WFH`, `ALF` (alfa), `SCK` (sakit), `OTH` (lainnya).
4. Pegawai saat check in hanya memilih WFO atau WFH. `SCK`, `OTH`, `ALF` diinput/dikoreksi HR di Rekap; keterangan wajib untuk SCK dan OTH.
5. **Alfa otomatis (virtual, tidak disimpan):** hari kerja (Senin–Jumat) yang sudah lewat (sebelum hari ini WIB), pegawai aktif, sejak tanggal bergabung, tanpa baris absensi. Baris yang diinput HR menggantikannya. Hari ini belum dihitung alfa. Kalender libur nasional **belum ada**.
6. **Terlambat ("Past"):** check in dengan jam:menit > `08:00` WIB (konstanta `WORK_START` di `lib/checkin.js`). 08:00:59 belum terlambat; 08:01 terlambat. Dihitung saat dibaca, tidak disimpan. Hanya untuk status hadir (WFO/WFH) yang punya jam.
7. **Lokasi:** tombol "Share Location" (Geolocation browser) menyimpan `lat`, `lng`, `accuracy_m`. Bila ditolak/tidak ada, check in tetap berhasil dan tampil "Lokasi tidak dibagikan". Tautan `https://www.google.com/maps?q=<lat>,<lng>`. Tidak ada geofence.
8. **Foto bukti absensi:** saat check in pegawai mengambil foto (kamera depan di ponsel, atau memilih gambar di desktop). **Wajib** (konstanta `PHOTO_REQUIRED` di `lib/checkin.js`; ubah ke `false` bila ingin opsional). Foto diperkecil di browser (sisi terpanjang 1.024 px, JPEG) dan divalidasi di server: harus gambar sungguhan (JPG/PNG/WEBP, dicek dari byte awal, bukan ekstensi), maks 8 MB. Satu foto per absensi; tidak bisa diganti. Baris input HR tidak punya foto.
9. **Daily Report:** baris `Start`, `Finish` (boleh kosong = masih berjalan, tampil "-"), `Activity` (wajib, maks 255). Finish harus setelah Start. Tidak ada hapus baris. Maks 50 baris per pegawai per hari.
10. Pegawai menambah/mengubah baris miliknya **hanya untuk hari ini** (server membaca tanggal). Hari sebelumnya hanya baca (Riwayat). HR dengan `checkin_rekap.update` boleh mengoreksi baris pegawai mana pun, hari mana pun.
11. Pegawai = baris `users`. ID = `users.employee_no` (kosong tampil "-"). Pegawai nonaktif ikut rekap hanya bila punya baris absensi pada rentang itu.
12. "Performance and meal allowance" hanya judul di sheet: **tidak dibangun**.

## Model data (migrasi `008-checkin.js`)
- `attendance`: `id`, `user_id`, `work_date`, `status`, `check_in_at` (UTC, NULL untuk input HR tanpa jam), `lat`, `lng`, `accuracy_m`, `note`, `source` (`SELF`/`HR`), `created_by`, `updated_by`, timestamp. UNIQUE (`user_id`,`work_date`), index `work_date`.
- `daily_report_items`: `id`, `user_id`, `work_date`, `start_time`, `end_time`, `activity`, audit kolom. Index (`user_id`,`work_date`).
- `attendance.photo_file_id` (migrasi `009-checkin-photo.js`): foto bukti; berkasnya di tabel `files` (`owner_type='attendance'`), disimpan dengan awalan `att-` di folder upload.
- `users.created_at` (kolom baru, default `UTC_TIMESTAMP()`): tanggal bergabung untuk alfa otomatis. User lama = tanggal migrasi.
- Tidak ada data awal. Jam masuk adalah konstanta kode.

## Izin (`lib/permissions.js`)
Grup baru **HR (SDM)** (belum ada di daftar izin; namanya sama dengan grup di sidebar). Modul: `checkin` (`view`, `create`, `update`; data milik sendiri) dan `checkin_rekap` (`view`, `update`, `export`; semua pegawai). Super Admin memegang keduanya otomatis. Role contoh **PIC Operasional** diberi `checkin.view/create/update` (role baru lewat seed; role lama lewat migrasi 008) supaya pegawai operasional bisa check in. Pemetaan route: `docs/permission-map.md`.

## API
Pegawai (`/api/checkin`, selalu `req.user.id`): `GET /today`, `POST /` (status, lat, lng, accuracy), `GET /history` (default 14 hari, maks 62), `POST /report`, `PUT /report/:id`, `GET /photo/:id` (hanya foto milik sendiri). `POST /` menerima `photo: { filename, data(base64) }`.
HR (`/api/checkin-rekap`): `GET /` (harian `date` atau periode `from`+`to`, `q`, `status`; maks 62 hari), `GET /user/:id`, `PUT /override`, `PUT /report/:id`, `GET /export`, `GET /photo/:id` (semua pegawai; butuh `checkin_rekap.view`). Foto dilayani lewat endpoint ini (bisa dengan `?t=<token>` untuk tag `<img>`); berkas `att-*` **tidak** bisa dibuka lewat `/uploads` (selalu 403).
Galat validasi `{ error, fields }`. Koreksi HR masuk `audit_log` (entity `attendance` untuk status, `daily_report` untuk koreksi report; catatan sebelum → sesudah). Check in dan tambah report oleh pegawai tidak diaudit (kolom `created_by` sudah mencatat).

## Layar
- **Dashboard:** tombol "Check In" aktif; setelah check in tampil "Check In 07:47" dengan status. Disembunyikan tanpa `checkin.view`.
- **Sidebar:** HR (SDM) › Check In & Report (`#checkin`).
- `#checkin` tab **Check In** (absensi pegawai: tanggal panjang, jam WIB hidup, WFO/WFH, Ambil Foto, Share Location, Check In), `#checkin/report` tab **Daily Report** (tabel, ADD ACTIVITY ++, edit, Riwayat dengan pemilih tanggal), `#checkin/rekap` tab **Rekap** (hanya `checkin_rekap.view`: Harian/Periode, cari, filter status, total status, detail per pegawai, Koreksi status, Download Excel). Foto tampil sebagai gambar kecil di Rekap harian, detail pegawai, Riwayat, dan kartu hasil check in; klik untuk memperbesar.

## Keputusan di luar prompt
- Menambah `users.created_at` agar pegawai baru tidak langsung dianggap alfa untuk hari sebelum mereka ada.
- Alfa otomatis tidak dihitung untuk pegawai nonaktif.
- Terlambat memakai jam:menit (08:00:59 belum terlambat).
- Maks 50 baris report per hari (pencegah penyalahgunaan).
- Koreksi report oleh HR dicatat dengan entity `daily_report` (bukan `attendance`).
- HR yang tidak punya `checkin.view` tetap bisa membuka `#checkin/rekap` (menu tampil bila punya salah satu izin).
- Override HR pada baris yang sudah ada mempertahankan jam check in dan lokasi aslinya; hanya status dan keterangan yang diganti.
- Excel hanya menandai kolom Foto "Ada" atau "-" (gambar tidak disematkan agar berkas kecil).
- Foto bersifat pribadi: hanya pemilik dan HR berizin yang bisa melihat; tidak ada hapus/ganti foto.
- Status di Rekap harian: "Past" ditandai di kolom Check In; kolom File/lampiran tidak ada.
- Role "Rekap lihat saja" tidak otomatis boleh check in (izin terpisah).

## Keterbatasan
- Tidak ada kalender libur nasional/cuti: libur di hari kerja dihitung alfa otomatis sampai HR menginput status lain. Alfa otomatis tidak menjangkau tanggal sebelum tanggal bergabung (user lama: tanggal migrasi), jadi rekap sebelum fitur ini dipakai kosong.
- Jam masuk satu untuk semua pegawai (08:00), tanpa shift.
- Lokasi hanya dicatat, tidak divalidasi (tanpa geofence). Foto tidak diverifikasi (tanpa pengenalan wajah); di desktop pegawai bisa memilih gambar mana pun dari berkas, sedangkan ponsel membuka kamera depan.
- Foto disimpan di folder upload: di Railway pastikan `UPLOAD_DIR` menunjuk Volume agar tidak hilang saat deploy ulang.
- Akurasi jam bergantung pada jam server; zona waktu tetap WIB.

## Di luar lingkup
File/bukti sakit, verifikasi wajah atau deteksi keaslian foto (mis. foto layar), geofence, kalender libur dan cuti, tunjangan makan dan performa, master Employees/Partner/Loans, payroll, notifikasi pengingat, OTP.
