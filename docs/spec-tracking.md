# Spesifikasi: Tracking progres surat jalan (Handling Ops › Trucking Delivery)

Sumber kebutuhan: `docs/prompt-tracking-messi.md`. Desain: `docs/design/tracking/`. Kode: `lib/tracking.js` (aturan murni), `lib/tracking-db.js`, `routes/tracking.js` (operasional), `routes/driver-public.js` (driver), `public/ho.js` (UI operasional), `public/driver.{html,css,js}`. Migrasi `019-tracking.js`.

## Status dan siapa boleh apa
`PLANNING → READY → STARTED → ARRIVED_PICKUP → LOADED → IN_TRANSIT → ARRIVED_DEST → DELIVERED → COMPLETED` (label Indonesia di `lib/tracking.js`).
- **Operasional** (`ho.update`): Planning (otomatis saat surat jalan dibuat), Ready, Completed; boleh menginput langkah driver atas nama driver (catatan wajib, `manual=1`), membatalkan langkah terakhir (alasan wajib), dan membuka kembali Completed → Diterima (alasan wajib).
- **Driver** (tautan): STARTED sampai DELIVERED. `DELIVERED` hanya lewat unggah foto bukti terima. Driver tidak pernah bisa Completed.
- Completed terkunci dari perubahan status; hanya "Buka kembali".
- Waktu selalu dari server; operasional boleh mengisi waktu kejadian (tidak di masa depan, tidak lebih awal dari langkah sebelumnya).

## Armada sendiri vs vendor luar
`vendors.is_own_fleet` (1 untuk kode `LST`, ditetapkan di migrasi dan seed). Surat jalan tanpa vendor dianggap vendor luar. Armada sendiri: semua langkah berurutan. Vendor luar: `STARTED`, `LOADED`, `ARRIVED_DEST` boleh dilewati (satu event `skipped=1` per langkah, tampil "dilewati"); `ARRIVED_PICKUP`, `IN_TRANSIT`, `DELIVERED` wajib.

## Peringatan (dihitung, tidak disimpan) — konstanta di `lib/rules.js` `TRACKING`
- **Perlu dicek:** langkah driver (bukan input manual) tercatat < 2 menit setelah langkah driver sebelumnya (langkah driver pertama tidak ditandai).
- **Tertahan:** status `ARRIVED_PICKUP`, `LOADED`, `IN_TRANSIT`, atau `ARRIVED_DEST` > 3 jam tanpa perubahan.
- Konstanta lain: 5 salah verifikasi → terkunci; masa berlaku sesi driver 12 jam.

## Model data (migrasi 019)
`delivery_notes`: `track_status`, `track_status_at`, `track_nonce` (CHAR 16), `link_revoked_at`, `link_opened_at`, `link_verified_at`, `verify_fails`, `link_locked`, `received_by`, `completed_at`, `completed_by`. Tabel `delivery_note_events` (riwayat tak terhapus; pembatalan = `voided_at/voided_by/void_reason`, event tetap ada). Foto bukti terima: `files` (`owner_type='delivery_note'`, `kind='pod'`), tidak dihitung dalam batas 3 foto dan tidak bisa dihapus lewat endpoint foto. Hapus surat jalan menghapus event (cascade) dan foto.
Sinkron kolom lama: event `LOADED` mengisi `finish_loading` bila kosong; `POST /sj/:id/finish` menulis event `LOADED` bila urutannya tepat (selain itu hanya mengisi waktu). `start_loading`, `entry_at`, `exit_at` **tidak dipetakan** (start_loading = waktu surat jalan dibuat, entry/exit = isian manual masuk/keluar pabrik).
Data lama: `legacyTrackStatus(row)` (`date_finish` terisi → `COMPLETED`, selain itu `PLANNING`); migrasi 019 dan impor (`scripts/legacy-import/deliveries.js`) memakainya, tautan driver ditandai dicabut dan event diberi catatan "Status dari data lama".

## Endpoint operasional (`/api/ho`, dijaga izin `ho`)
GET `/sj/:id/tracking`, GET `/sj/:id/qr.svg` (`ho.view`); POST `/sj/:id/ready`, `/complete`, `/reopen`, `/tracking/step`, `/tracking/undo`, `/tracking/link/revoke|regenerate|unlock` (`ho.update`). `GET /tickets/:id/sj` memuat `track` per baris, `status_counts`, dan filter `?status=`. Semua perubahan ditulis ke audit (entity `ticket`).

## Endpoint publik driver (tanpa login)
`/api/pub/d/:token`: GET `/` (no. surat jalan, rute, status tautan), POST `/verify`, GET `/sj`, POST `/step`, POST `/deliver` (tiga terakhir butuh sesi). Halaman `/d/:token`.

## Model keamanan tautan
> **Verifikasi 4 angka nopol sedang DIMATIKAN** atas permintaan client (`TRACKING.VERIFY_NOPOL` di `lib/rules.js`, default mati). Tanpa verifikasi, siapa pun yang memegang tautan bisa mengubah status surat jalan itu dan mengunggah foto bukti; satu-satunya pengaman adalah token rahasia (tidak bisa ditebak) dan pembatas laju. Nyalakan kembali dengan env `TRACKING_VERIFY_NOPOL=1` (kode verifikasi, penguncian 5 kali salah, dan tesnya tetap ada). Saat mati: halaman driver langsung masuk tanpa kotak angka, endpoint `/verify` menerbitkan sesi tanpa memeriksa angka, dan "Tandai Ready" tidak lagi mewajibkan nopol memuat angka.
- Token = `base64url(id).nonce.sig`, `sig = HMAC-SHA256(JWT_SECRET, id.nonce)` 16 byte; tidak ada rahasia di DB; "Cabut" = `link_revoked_at`, "Buat ulang" = ganti nonce (token lama mati).
- Akses hanya ke satu surat jalan, hanya aksi status + foto bukti terima. Tanpa data customer/berat/nama. Tidak ada akses ke `/uploads`.
- Verifikasi 4 angka nopol (semua digit nopol; bila >4 digit dipakai 4 pertama; nopol tanpa digit tidak pernah cocok). Salah 5 kali berturut-turut → terkunci sampai operasional membuka kunci. Pesan salah tidak membocorkan nopol. Pembatas laju per IP (30 percobaan/15 menit) di atas penguncian per tautan.
- Sesi driver = token bertanda tangan (per surat jalan, 12 jam, memuat nonce): mati saat tautan dicabut/diganti. Dikirim lewat header `Authorization`, tanpa cookie, tanpa CORS terbuka.
- Respons: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`; token tidak ditulis ke log; error tidak berisi jejak tumpukan; batas body khusus ±12 MB; token tidak valid selalu 404 yang sama.
- Foto: `files.create` (`imagesOnly`, maks 8 MB, jpg/png/webp); klien mengompres ke maks 1600 px.

## Alamat tautan
`PUBLIC_URL` (opsional) bila diisi, kalau tidak alamat yang sedang dipakai membuka aplikasi (di Railway `https`). Tidak digagalkan saat start bila kosong; di production hanya muncul peringatan di log.

## Keputusan dan asumsi
1. Nomor migrasi 019 (007 sudah terpakai).
2. **Satu QR di PDF surat jalan**: QR surat jalan digital (`/s/...`); tautan driver tidak dicetak, dibagikan lewat WhatsApp/QR di layar operasional (keputusan Product Owner).
3. Variabel alamat: `PUBLIC_URL` (bukan `PUBLIC_BASE_URL`), tidak wajib.
4. Input atas nama driver untuk `DELIVERED` tidak mewajibkan foto (sesuai spesifikasi endpoint); foto wajib hanya lewat jalur driver.
5. Membatalkan langkah tidak mengosongkan `finish_loading` yang sudah terisi; event PLANNING awal tidak bisa dibatalkan; Completed hanya bisa dibuka lewat "Buka kembali".
6. Kolom tabel Trucking Delivery dirampingkan (Start Loading, Gross Weight, Satuan pindah ke Detail) agar kolom Status dan Aksi muat.

## Belum dibangun / di luar cakupan
Integrasi WhatsApp Business API, notifikasi push, GPS langsung, penutupan tiket otomatis, OTP, kolom penanda armada sendiri di layar Vendor, uji di ponsel nyata.
