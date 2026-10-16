# LESAT — Sistem Internal PT Lima Sarana Trans

Menu yang sudah jadi: **Dashboard**, **Job Order & Doc**, **Handling Ops** (tiket, Report Material, Trucking Delivery / Surat Jalan), **COA** (FAT › COA: Account Code dan Master General Ledger), **Customer** (Data Master › Customer, kode otomatis), **Check In & Report** (HR › Check In & Report: absensi, laporan harian, rekap HR), serta **User Management** dan **Role Management** (grup ADMINISTRATOR).
Menu lain di sidebar masih berlabel "segera". Konvensi UI kolom Aksi: [docs/ui-aksi.md](docs/ui-aksi.md). Spesifikasi: [docs/spec-customer.md](docs/spec-customer.md), [docs/spec-checkin.md](docs/spec-checkin.md), [docs/spec-coa.md](docs/spec-coa.md), [docs/spec-jo-handling.md](docs/spec-jo-handling.md), audit awal: [docs/audit-jo-handling.md](docs/audit-jo-handling.md).

## Menjalankan
```bash
docker compose up -d        # MySQL 8 di port 3307
npm install
npm start                   # http://localhost:3100 (migrasi database berjalan otomatis saat start)
npm run seed                # opsional: data dummy JO + Handling Ops (aman diulang, data asli tidak disentuh)
npm test                    # unit + integrasi (butuh MySQL dari docker compose)
npm run migrate             # jalankan migrasi manual (server juga menjalankannya)
```
Login awal lokal: `admin` / `admin123` (role Super Admin, email `admin@gmail.com`). Di production password admin wajib lewat env `ADMIN_PASSWORD`.

### User & role (RBAC)
- Menu **Administrator → Role Management**: atur izin per modul (Tanpa / Lihat / Kelola / Penuh, atau per aksi). Super Admin dikunci dan selalu memegang semua izin.
- Menu **Administrator → User Management**: tambah user (username, email unik, kode PIC 2 huruf, role). Jika password dikosongkan, server membuat password sementara yang ditampilkan **sekali**; user wajib menggantinya saat login pertama.
- Membuat user pertama selain admin: login sebagai `admin` → User Management → + Tambah User. User lama (hasil migrasi) otomatis berrole **PIC Operasional** (JO & Handling Ops Kelola, Dashboard Lihat); email-nya masih kosong dan wajib diisi saat diedit.
- Izin dicek di server pada setiap permintaan; pemetaan route → izin: [docs/permission-map.md](docs/permission-map.md). OTP email belum ada (tahap berikutnya); email sudah wajib dan unik.

## Struktur
| Lokasi | Isi |
|---|---|
| `lib/rules.js` | **Semua keputusan bisnis & konstanta** (tipe JO, format nomor, aturan wajib per tipe, item checklist, batas file/foto). Ubah di sini jika keputusan pemilik berubah. |
| `lib/calc.js` | Rumus (dwelling time, load time, Report Material %, Trucking Delivery %, berat) — diuji. |
| `lib/numbering.js` | Penomoran atomik JO / tiket / surat jalan (tabel `counters`). |
| `lib/pdf.js`, `lib/excel.js`, `lib/exports.js`, `lib/report-text.js` | PDF Surat Jalan & Damage Report, Excel, teks Copy Report. |
| `lib/code128.js` | Barcode Code 128 — dipakai server (PDF) dan browser (`/shared/code128.js`). |
| `migrations/` | Migrasi berurutan (`schema_migrations`), idempoten; data lama dipindahkan, tidak dihapus. |
| `lib/permissions.js`, `lib/authz.js`, `lib/roles-seed.js` | Daftar izin (modul × aksi), middleware izin & batas login, role bawaan. |
| `lib/coa.js`, `migrations/data/coa-seed.json`, `scripts/coa-seed.js` | Aturan COA (murni), data awal 365 akun, skrip pembangkit seed dari Excel. |
| `lib/checkin.js` | Aturan Check In murni: tanggal WIB, terlambat, alfa otomatis, rekap (diuji tanpa database). |
| `routes/` | `job-orders.js`, `jo-materials.js`, `handling.js`, `home.js`, `users.js`, `roles.js`, `coa.js`, `checkin.js`, `checkin-rekap.js`. |
| `public/` | SPA: `app.js` (inti), `jo.js`, `jo-detail.js`, `ho.js`, `scan.js`, `home.js` (Dashboard), `users.js`, `roles.js`, `coa.js`, `checkin.js`, `style.css` (design token glass). |
| `tests/` | `node --test` — formula, penomoran (termasuk simpan bersamaan), migrasi, validasi, PDF/Excel/ZIP, aturan tiket. |

## Konfigurasi (env)
| Variabel | Keterangan |
|---|---|
| `JWT_SECRET` | **Wajib di production** (string acak panjang) |
| `ADMIN_PASSWORD` | **Wajib di production** saat pertama kali jalan (membuat user `admin`) |
| `MYSQL_URL` atau `MYSQLHOST` `MYSQLPORT` `MYSQLUSER` `MYSQLPASSWORD` `MYSQLDATABASE` | Koneksi MySQL (otomatis dari Railway); lokal bisa `DB_HOST` `DB_PORT` `DB_USER` `DB_PASS` `DB_NAME` |
| `UPLOAD_DIR` | Folder file upload (dokumen, foto). Di Railway arahkan ke path **Volume**, mis. `/data/uploads` — tanpa Volume, file hilang saat deploy ulang |
| `PORT` | Diisi otomatis oleh Railway |
| `SEED_DUMMY` | `1` = isi data dummy sekali saat start (hanya bila belum ada); `force` = buat ulang. Untuk environment development saja |

## Deploy ke Railway
1. New Project → Deploy from GitHub repo → pilih repo ini. Tambah **MySQL** (New → Database → MySQL) dan **Volume** (mount ke `/data`).
2. Variabel di service aplikasi: `JWT_SECRET`, `ADMIN_PASSWORD`, `UPLOAD_DIR=/data/uploads`, `MYSQL_URL=${{MySQL.MYSQL_URL}}`.
3. Settings → Networking → Generate Domain (port sesuai `PORT` di log). Tabel dan migrasi dibuat/dijalankan otomatis saat aplikasi start.
