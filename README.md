# meLESAT — Sistem Internal PT Lima Sarana Trans

Menu yang sudah jadi: **Job Order & Doc** dan **Handling Ops** (tiket, Report Material, Trucking Delivery / Surat Jalan).
Menu lain di sidebar masih berlabel "segera". Spesifikasi: [docs/spec-jo-handling.md](docs/spec-jo-handling.md), audit awal: [docs/audit-jo-handling.md](docs/audit-jo-handling.md).

## Menjalankan
```bash
docker compose up -d        # MySQL 8 di port 3307
npm install
npm start                   # http://localhost:3100 (migrasi database berjalan otomatis saat start)
npm run seed                # opsional: data dummy JO + Handling Ops (aman diulang, data asli tidak disentuh)
npm test                    # unit + integrasi (butuh MySQL dari docker compose)
npm run migrate             # jalankan migrasi manual (server juga menjalankannya)
```
Login awal lokal: `admin` / `admin123`. Di production password admin wajib lewat env `ADMIN_PASSWORD`.

## Struktur
| Lokasi | Isi |
|---|---|
| `lib/rules.js` | **Semua keputusan bisnis & konstanta** (tipe JO, format nomor, aturan wajib per tipe, item checklist, batas file/foto). Ubah di sini jika keputusan pemilik berubah. |
| `lib/calc.js` | Rumus (dwelling time, load time, Report Material %, Trucking Delivery %, berat) — diuji. |
| `lib/numbering.js` | Penomoran atomik JO / tiket / surat jalan (tabel `counters`). |
| `lib/pdf.js`, `lib/excel.js`, `lib/exports.js`, `lib/report-text.js` | PDF Surat Jalan & Damage Report, Excel, teks Copy Report. |
| `lib/code128.js` | Barcode Code 128 — dipakai server (PDF) dan browser (`/shared/code128.js`). |
| `migrations/` | Migrasi berurutan (`schema_migrations`), idempoten; data lama dipindahkan, tidak dihapus. |
| `routes/` | `job-orders.js`, `jo-materials.js`, `handling.js`. |
| `public/` | SPA: `app.js` (inti), `jo.js`, `jo-detail.js`, `ho.js`, `scan.js`, `style.css` (design token glass). |
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
