# meLESAT — Sistem Internal PT Lima Sarana Trans

Menu yang sudah ada: **Job Order & Doc**, **Handling Ops** (ticket, report material, trucking/surat jalan).

## Menjalankan
```bash
docker compose up -d        # MySQL 8 di port 3307
npm install
npm start                   # http://localhost:3100
npm run seed                # opsional: data dummy Handling Ops
```
Login awal lokal: `admin` / `admin123`. Di production password admin wajib lewat env `ADMIN_PASSWORD`.

## Konfigurasi (env)
| Variabel | Keterangan |
|---|---|
| `JWT_SECRET` | **Wajib di production** (string acak panjang) |
| `ADMIN_PASSWORD` | **Wajib di production** saat pertama kali jalan (membuat user `admin`) |
| `MYSQL_URL` atau `MYSQLHOST` `MYSQLPORT` `MYSQLUSER` `MYSQLPASSWORD` `MYSQLDATABASE` | Koneksi MySQL (otomatis dari Railway); lokal bisa `DB_HOST` `DB_PORT` `DB_USER` `DB_PASS` `DB_NAME` |
| `UPLOAD_DIR` | Folder file upload; di Railway arahkan ke path Volume, mis. `/data/uploads` |
| `PORT` | Diisi otomatis oleh Railway |

## Deploy ke Railway
1. New Project → Deploy from GitHub repo → pilih repo ini. Tambah **MySQL** (New → Database → MySQL) dan **Volume** (mount ke `/data`).
2. Variabel di service aplikasi: `JWT_SECRET`, `ADMIN_PASSWORD`, `UPLOAD_DIR=/data/uploads`, dan referensi MySQL: `MYSQL_URL=${{MySQL.MYSQL_URL}}`.
3. Settings → Networking → Generate Domain. Tabel dibuat otomatis saat aplikasi pertama kali jalan.
