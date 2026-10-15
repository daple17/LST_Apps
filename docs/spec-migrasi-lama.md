# Spesifikasi migrasi data sistem lama → LESAT (Job Order & Handling Ops)

Status: **tahap 0–3 selesai** (master, pengguna, Job Order). Tahap 4 (material, tiket, surat jalan), tahap 5 (validasi, lencana, relink), dan tahap 6 (rekonsiliasi) menyusul; dokumen ini diperbarui di tiap tahap. Cara menjalankan: `docs/migrasi-lokal.md`.

## Prinsip
- Hanya uji lokal. Skrip menolak berjalan tanpa `--lokal` atau di host non-lokal. Dump, laporan, dan karantina ada di `data/` (di-ignore git); tidak ada data nyata di tes (fixture `tests/fixtures/legacy-mini.sql` buatan sendiri).
- Semua perubahan skema hanya menambah (migrasi `010-legacy-compat.js`); perilaku data baru tidak berubah; tes lama lolos tanpa diubah.
- Idempoten lewat `legacy_id`. Tanpa validasi LESAT saat impor (data lama memang belum lengkap); JO yang akan gagal validasi hanya dihitung di laporan.

## Keputusan final (dari PO)
1. Peti kemas: `jo_materials.container_no/container_size` (bukan level baru).
2. Validasi wajib hanya penuh untuk data baru; data `LEGACY` boleh belum lengkap (tahap 5).
3. Semua surat jalan lama dimigrasi (termasuk yang tanpa isi); yang tak bisa dikaitkan ke tiket aslinya masuk tiket penampung bulanan `MIG-YYYYMM` (tahap 4).
4. `NoSiDo` → Import: `SI_DO`; Export: `SI_PO`; Trucking dan Project: `SI_DO`; tanggalnya ke `ref_date`.
5. **Kode customer LESAT = `customer.nickname` lama** (bukan `code`); `code` lama disimpan sebagai `legacy_code`. Tujuh nickname bukan 3 huruf (SIDAN, AMIR, FADLAN, MR, UI, BW, UNPAD) diimpor apa adanya dengan `needs_code_review=1`. **Perlu konfirmasi client bahwa nickname = kode yang mereka pakai di nomor JO.**

## Asumsi sementara (menunggu konfirmasi client)
- `StatusJo` 0 → `NOT_COMP`; 1 dan 2 → `COMPLETE`; nilai mentah di `legacy_status`.
- `kontainer.damage_status` kosong/0 → `NOT_CHECKED`; 1 → `OK`; 2 → `DAMAGE` (tahap 4).
- `surat_jalan_detil.flag_surat_jalan` diabaikan; nilai mentah di `delivery_note_items.legacy_flag` (tahap 4).

## Pemetaan (tahap 3)
| Sumber | Tujuan | Aturan |
|---|---|---|
| `country` (197) | `countries` | apa adanya |
| `pelabuhan` (55) | `ports` | `jenis=1` → `is_foreign`; `port_international` **tidak** diimpor |
| `warehouse` (17) | `tps_warehouses` | apa adanya |
| `customer` (121) | `customers` | `code = UPPER(nickname)`; `legacy_code = code lama`; `taxno` '-' → NULL; bentrok dengan kode customer LESAT non-impor → karantina |
| `vendor` (166) | `vendors` | kode kosong/placeholder/ganda → kode turunan dari nama (inisial + nomor urut, `needs_code_review=1`) |
| `shipper` (118) | `shippers` | `id_country=0` → NULL |
| `users` (24) | `users` | username sama (tak peka huruf besar/kecil) → hanya ditautkan (`legacy_id`), peran/password tidak berubah; selain itu dibuat **nonaktif**, `must_change_password=1`, password acak, peran `Pengguna Lama (tanpa akses)` (tanpa izin). Email ganda dikosongkan, kode PIC bukan 2–4 huruf dikosongkan. Hak akses lama tidak dimigrasi. Pengguna nonaktif `migrasi-sistem-lama` dibuat (PIC tiket penampung). |
| `job_order` (5.537) | `job_orders` | lihat di bawah |

**Job Order:** `no_jo = 4 digit NoJobOrder + kode customer` (`0027USC`), `legacy_no = 27`; `type` 1–4 → IMPORT/EXPORT/TRUCKING/PROJECT; `type_bc` dari `ImportType` (`PIB BC 2.0/1.6/2.8/2.3`, `PEB BC 3.0`; "Pilih", "Lainnya", kosong → NULL); `jenis_muatan` FCL/LCL → FCL/LCL_BB; tanggal: IMPORT `eta_etd=DateEta`; EXPORT `eta_etd=COALESCE(DateEtd, DateEta)`; Trucking/Project (keputusan sendiri) `COALESCE(DateEta, DateEtd)`; `etd=DateEtd`; `delivery_plan` dikosongkan (tidak ada di sistem lama) dan **tidak ditimpa** saat impor diulang; `completed_at=JobCompleteDate` hanya bila COMPLETE; pelabuhan/TPS/shipper 0 → NULL; `weight_kg = lcl_ton × 1000`, `cbm = lcl_m3`, `qty = lcl_qty` (pecahan dibulatkan), `unit`/`party_text` dari `lib/legacy-unit-map.json` (tak dikenal → teks asli di `party_text`, tidak ditebak); peti kemas `fcl_20/40/45/ot/fr` → `jo_containers` + `container_count/container_type` (`MIX` bila lebih dari satu jenis); referensi `Invoice`→INVOICE, `NoBL`→BL (+tanggal), `NoHbl`→HBL (+tanggal), `NoSiDo`→lihat keputusan 4, `NoAju`→AJU (satu nomor per baris; pemisah `,` `;` ` dan ` `&`; placeholder dibuang); `jo_checklist` 9 baris default. Kolom `NoBc2`, `NoPib`, `Spk`, `Consignee` tidak dimigrasi (jumlah yang terisi dilaporkan). Penghitung `JO` dinaikkan ke minimal nomor JO lama terbesar (6.035); penghitung `TICKET` tidak disentuh.

## Hal yang diputuskan sendiri
- `--dry-run` berjalan di transaksi yang dibatalkan; `import_runs` tetap dicatat (mode `dry-run`).
- `--reset-legacy` menghapus semua baris hasil impor di database tujuan (termasuk `import_runs`) dan mengembalikan penghitung `JO` ke nilai sebelum impor pertama.
- Impor ulang membuat ulang `jo_containers` dan menyelaraskan referensi (referensi yang punya berkas tidak dihapus).
- Tanggal `DateCreated` diimpor apa adanya (zona waktu sistem lama tidak diketahui).

## Keterbatasan
- Dump hanya bisa dimuat ke MariaDB (satu tabel keuangan memakai sintaks yang ditolak MySQL 8): salinan sistem lama berjalan di `docker-compose.legacy.yml`.
- Semua JO lama gagal validasi LESAT penuh karena `delivery_plan` wajib tetapi tidak ada di sistem lama (lihat laporan untuk kolom lain).
