# Uji migrasi data sistem lama → LESAT (lokal)

Hanya untuk komputer lokal. **Jangan** dijalankan di produksi atau server client. Dump berisi data pribadi dan hash password lama: `data/` sudah ada di `.gitignore`; jangan commit dump, jangan taruh isinya di fixture tes, jangan cetak isi kolom password/email.

## 1. Menyiapkan
```bash
docker compose up -d                                   # MySQL 8 LESAT (port 3307)
docker compose -f docker-compose.legacy.yml up -d      # MariaDB 10.11 salinan sistem lama (port 3308)
mkdir -p data/legacy data/reports                      # taruh dump: data/legacy/limasarana_2025_05_20261015.sql.gz
npm test                                               # garis dasar: harus hijau sebelum menyentuh apa pun
```
Dua database:
| Database | Server | Isi |
|---|---|---|
| `lst_legacy` | MariaDB lokal (`docker-compose.legacy.yml`, port 3308) | salinan mentah sistem lama, **hanya dibaca** |
| `lst_dev` | MySQL 8 lokal (compose utama, port 3307) | LESAT hasil impor (`DB_NAME=lst_dev`) |

> Dump ini **tidak bisa** dimuat ke MySQL 8: tabel keuangan `detail_invoice_vendor_non_pajak` memakai `date ... DEFAULT current_timestamp()` (sintaks MariaDB; MySQL 8 menolak, `Invalid default value for 'tanggal'`). Sesuai ketentuan, dump tidak diubah; salinannya dimuat ke MariaDB terpisah. Database LESAT biasa (`lesat`) tidak disentuh.

## 2. Restore dump ke `lst_legacy`
```bash
L() { docker compose -f docker-compose.legacy.yml exec -T legacy mariadb -uroot -proot "$@"; }
L -e "DROP DATABASE IF EXISTS lst_legacy; CREATE DATABASE lst_legacy"
gunzip -c data/legacy/limasarana_2025_05_20261015.sql.gz | L --default-character-set=utf8mb4 lst_legacy
```
Waktu restore sekitar 4 detik, 77 tabel. Cek jumlah baris (harus cocok): `job_order` 5537, `kontainer` 9440, `worksheet` 689, `surat_jalan` 3818, `surat_jalan_detil` 7962, `customer` 121, `vendor` 166, `shipper` 118 (juga `pelabuhan` 55, `warehouse` 17, `country` 197). Hasil restore pertama: semua cocok.

## 3. Menyiapkan / mengulang `lst_dev`
```bash
docker compose exec -T db mysql -uroot -proot -e "DROP DATABASE IF EXISTS lst_dev; CREATE DATABASE lst_dev CHARACTER SET utf8mb4"
DB_NAME=lst_dev npm run migrate                        # membuat skema LESAT + migrasi kompatibilitas
```
Menjalankan aplikasi terhadap `lst_dev`: `DB_NAME=lst_dev ADMIN_PASSWORD=admin123 npm start` (port 3100 dipakai bersama; hentikan server `lesat` dulu atau pakai `PORT=3101`).

## 4. Menyiapkan `lst_dev` agar mirip produksi
`lst_dev` perlu satu pengguna `admin` dan peran bawaan; data master contoh (customer/vendor/shipper) dibersihkan supaya tidak bentrok dengan kode customer lama:
```bash
DB_NAME=lst_dev ADMIN_PASSWORD=admin123 node -e "
const mysql=require('mysql2/promise'),cfg=require('./config'),{seedMaster}=require('./server');
(async()=>{const p=mysql.createPool(cfg.db);await seedMaster(p);
for (const t of ['customers','vendors','shippers']) await p.query('DELETE FROM '+t+' WHERE legacy_id IS NULL');await p.end();})()"
```

## 5. Menjalankan impor
Skrip: `scripts/legacy-import/index.js`. Selalu pakai `--lokal`; skrip menolak berjalan bila host MySQL tujuan atau host sistem lama bukan lokal. Tujuan = konfigurasi aplikasi (`DB_NAME=lst_dev`); sistem lama = MariaDB `127.0.0.1:3308/lst_legacy` (ubah dengan `--legacy-host/--legacy-port/--legacy-db/--legacy-user/--legacy-pass`).
```bash
DB_NAME=lst_dev node scripts/legacy-import/index.js --lokal                    # dry-run (default): semua perubahan dibatalkan, laporan tetap ditulis
DB_NAME=lst_dev node scripts/legacy-import/index.js --lokal --commit           # tulis ke lst_dev
DB_NAME=lst_dev node scripts/legacy-import/index.js --lokal --commit --only=customers,vendors
DB_NAME=lst_dev node scripts/legacy-import/index.js --lokal --reset-legacy     # hapus hasil impor di lst_dev (data LESAT lain tidak disentuh), penghitung dikembalikan
```
- **Idempoten** lewat `legacy_id` (upsert): menjalankan ulang tidak menggandakan. Sistem lama masih jalan, jadi impor diulang beberapa kali; *baris hasil impor dibuat ulang dari sumber pada tiap run* (kecuali `delivery_plan` JO dan referensi yang sudah punya berkas, yang dipertahankan).
- `--dry-run` berjalan di dalam transaksi lalu dibatalkan; hanya tabel `import_runs` yang dicatat (mode `dry-run`).
- Setiap run: satu baris `import_runs` + `data/reports/run-<waktu>.md` + `run-<waktu>-karantina.csv` (di `data/`, tidak di-commit).
- `--reset-legacy` (tanpa `--commit`) hanya menghapus; dengan `--commit` menghapus lalu mengimpor ulang.
- Pada produksi/cutover, impor **tidak boleh** dijalankan lewat skrip ini sebelum disetujui (skrip menolak host non-lokal).
