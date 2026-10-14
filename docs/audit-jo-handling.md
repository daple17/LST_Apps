# Rencana: merampungkan Job Order & Doc dan Handling Ops (docs/spec-jo-handling.md)

## Context
Aplikasi LESAT sudah punya versi demo dua menu ini (JO + Handling Ops, ±1.700 baris, Express + MySQL + SPA vanilla).
Spesifikasi baru mengubah struktur data (referensi ganda, material di level JO, tiket multi-JO, checklist 9 item), penomoran, dan menambah fitur
(tab per tipe, form per tipe, detail 4 tab, Excel/PDF/ZIP, scan kamera, unit test). Menu lain tidak disentuh.
Jawaban pemilik atas dua konflik: **kirim parsial tetap boleh** (satu material bisa dibagi ke beberapa surat jalan) dan **checklist 9 item** (data lama digabung OR).

## Hasil audit (sudah ada / sebagian / belum)

| Fitur (spesifikasi) | Status | Kondisi sekarang / file |
|---|---|---|
| Kartu ringkasan JO (5 kartu, Total JO reset) | Ada | `public/app.js` joList, `server.js` /job-orders/summary |
| Tab per tipe + jumlah mengikuti filter | Belum | tipe masih dropdown |
| Tipe JO Import/Export/Trucking/Project + Type BC terpisah | Belum | tipe campur: `PIB BC 2.0/1.6`, `LOKAL`, `PEB`, `TRUCKING` (`app.js` TYPES) |
| Pencarian lintas referensi | Sebagian | hanya kolom utama JO (`server.js` where()) |
| Filter status/customer/periode | Sebagian | ada, tapi periode default kosong (spek: bulan berjalan) |
| Kolom tabel (Aju, BL, Invoice, SI/PO + lencana "+n", menu Aksi) | Belum | kolom lama: Type, Customer, Vessel, Party, Weight, ETA, Delivery, Status |
| Excel daftar JO (xlsx, semua referensi, ikut filter) | Sebagian | CSV tanpa referensi (`/job-orders/export`) |
| Paginasi 20 baris + awal/akhir bernomor | Sebagian | 15 baris, hanya prev/next |
| + Job Order pilih tipe → form per tipe | Belum | satu form generik |
| Referensi ganda (aju, invoice, BL, SI/DO, SI/PO) + tanggal + file | Belum | satu kolom teks per JO |
| Isian wajib per tipe, CBM jika LCL, jumlah/jenis kontainer | Belum | hanya Type & Customer wajib |
| Peringatan BL/aju dobel; delivery < ETA | Sebagian | peringatan delivery<ETA ada, dobel belum |
| Edit: nomor JO terkunci, tipe terkunci jika ada material; Cancel konfirmasi | Sebagian | customer terkunci; JO Complete terkunci edit/hapus (dipertahankan) |
| Detail JO: kepala + 4 tab (Material, Dokumen, Checklist, Remarks) | Belum | modal tunggal `detail()` |
| Material level JO: Add data, template, Upload List + pratinjau, Scan Barcode | Belum | material hanya ada di dalam tiket (`ho.js`, tabel `materials`) |
| Tab Dokumen (jenis, no. dokumen, ukuran, ganti file) | Sebagian | upload + kategori saja (`jo_documents`) |
| Checklist 9 item + siapa/kapan tiap centang | Sebagian | 12 item, JSON di kolom JO, tanpa jejak |
| Preview lembar JO A4 | Sebagian | cetak dari modal, belum A4/lengkap |
| Tiket: daftar, tab progres, cari, filter bulan, Excel | Sebagian | ada; tab pakai rata-rata (spek: nilai terendah), Excel = CSV, "+n" customer belum |
| Buat tiket + Browse Data | Ada | `hoTicketForm`, `/ho/browse-jo` |
| 1 JO = 1 tiket **aktif** | Sebagian | sekarang permanen (UNIQUE `jo_id`) |
| Halaman tiket: tab, Copy Report, Download ZIP | Sebagian | Copy ada; ZIP belum |
| Report Material (status, remarks, foto 8, total, filter, scan) | Sebagian | ada; Damage belum wajib foto; resize 1280 (spek 1600); scan hanya ketik+Enter; status melekat di tabel `materials` (spek: `material_reports`) |
| Surat jalan: buat, daftar, load time, total rit | Sebagian | ada; belum tombol Finish Loading & koreksi waktu; PDF masih HTML cetak; belum Nopen+tanggal |
| Barcode nomor SJ | Ada | `barcode()` di `ho.js` (Code 128 klien) |
| Penomoran JO/tiket/SJ transaksional, tidak dipakai ulang | Sebagian | berbasis MAX/COUNT → nomor terpakai ulang jika data dihapus; format lama (`0027-BTU`, tiket urut per hari) |
| Berat disimpan kg, format ID | Belum | JO `weight` dalam ton |
| Unit test (penomoran 2 simpan bersamaan, semua rumus) | Belum | tidak ada test infra |
| Unduhan: template material, Excel tiket/Report Material, PDF damage, ZIP | Belum / CSV | hanya CSV |
| created_by/updated_by semua tabel; tabel `files` polimorfik | Sebagian / Belum | `jo_logs` untuk JO; foto di 2 tabel terpisah |

Data saat ini (DB lokal): 27 JO (26 dummy + 1 buatan user `0001-NIJ`), 0 dokumen, tidak ada material dobel, tidak ada kirim parsial.

## Keputusan yang saya ambil sendiri (semua di satu berkas konstanta `lib/rules.js`, mudah diubah)
1. Default 12 keputusan spesifikasi dipakai apa adanya (tipe, format nomor, satuan, kg, status manual, hak akses terbuka + log).
2. **Migrasi tipe lama:** `PIB BC x`→Import + Type BC `BC x`; `LOKAL`→Trucking; `PEB`→Export; `TRUCKING`→Trucking (PEB/TRUCKING tidak disebut spek; ini tebakan).
3. **Nomor JO lama** `0027-BTU` → `0027BTU` (hanya hapus tanda hubung, nomor asli disimpan di kolom `legacy_no`); kode customer baru wajib 3 huruf (kode lama 3 huruf semua).
4. **Nomor tiket** urutan per **bulan** (spek), bukan per hari seperti sekarang. Tiket lama tidak dinomori ulang.
5. **Filter periode default** memakai `COALESCE(eta_etd, DATE(created_at))` agar JO Trucking/Project tanpa ETA tidak hilang dari daftar default (celah spek: ETA opsional untuk dua tipe itu).
6. **Weight JO** = isian deklarasi (kg, input form dalam ton). Jika material sudah ada dan totalnya (rumus spek) beda >0,5%, kepala detail menampilkan lencana peringatan; angka utama tetap deklarasi.
7. **JO Complete tetap terkunci** untuk edit/hapus seperti sekarang (spek tidak menyebut; tidak mau menghapus perilaku yang ada).
8. **"Tiket aktif"** = tiket belum 100% (`done_at` NULL); JO di tiket selesai boleh masuk tiket baru. Dijaga di server (transaksi), bukan UNIQUE index.
9. **Checklist 12→9** digabung OR; item disimpan sebagai konstanta.
10. **Tab progres tiket** pakai nilai terendah dari dua persen (spek); sebelumnya rata-rata.
11. **Tabel tambahan di luar 14 tabel spek** (infrastruktur): `counters` (penomoran atomik), `audit_log` (siapa/kapan untuk semua perubahan), `schema_migrations`, `users` (sudah ada).
12. **Pustaka baru:** `exceljs` (xlsx/template/upload), `pdfkit` (PDF SJ + damage report, tanpa browser headless di Railway), `archiver` (ZIP). Scan kamera: `BarcodeDetector` bila ada, fallback ZXing yang di-host sendiri (iOS Safari tidak punya BarcodeDetector). Test: `node --test` bawaan Node (tanpa dependency).
13. Lembar JO "Preview" = halaman A4 khusus yang dicetak/disimpan PDF lewat browser (spek mengizinkan); PDF Surat Jalan dan damage report dibuat server.

## Arsitektur
- `server.js` tinggal bootstrap; kode dipecah: `routes/job-orders.js`, `routes/handling.js`, `lib/{rules,numbering,calc,migrate,excel,pdf,audit,files}.js`. Rumus murni di `lib/calc.js` (diuji tanpa DB).
- **Migrasi:** `migrations/NNN-*.js` + tabel `schema_migrations`, dijalankan saat start (Railway ikut) dan `npm run migrate`. Tiap langkah dijaga `information_schema` sehingga aman diulang. Pendekatan **rename + alter** (bukan salin): `ho_tickets→handling_tickets`, `ho_ticket_jos→ticket_job_orders`, `surat_jalan→delivery_notes`, `surat_jalan_items→delivery_note_items`, `materials→jo_materials` (+ `material_reports` dari kolom status/remarks/foto), `jo_documents` diperluas, `jo_logs→audit_log`. Kolom lama baru dibuang di akhir migrasi tahap terkait setelah data tervalidasi (jumlah baris dicocokkan).
- **Penomoran:** tabel `counters(name, period, last)`; `INSERT … ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)` dalam transaksi yang sama dengan insert dokumen → atomik dan tidak pernah turun walau data dihapus.
- **Frontend:** `public/app.js` (inti/router) + `jo.js` (baru, daftar/form/detail) + `ho.js`; style tetap `style.css` (token glass); Exo 2 untuk judul/angka. Tab-tab detail JO sebagai halaman (`#jo/:id/material|dokumen|checklist|remarks`) agar bisa di-link seperti link JO dari Handling Ops sekarang.
- Reuse yang sudah ada: `photoBox`/`resizeImg` (naikkan ke 1600 px), `labelTables` (tabel→kartu mobile), `pbtn`, `barcode()`, `searchBind`, `download()`, `run()` wrapper, `hoDrawSel`/Browse Data.

## Tahap kerja (satu commit per tahap, aplikasi jalan di tiap tahap)
1. **Audit** — dokumen ini (tanpa perubahan kode).
2. **Struktur data + migrasi + seed**: kerangka migrasi, tabel baru, `counters`/`audit_log`/`files`, migrasi 27 JO, material→level JO, checklist 9 item, tiket/SJ rename; update `scripts/seed-dummy.js` (data mirip requirement: 1 JO dengan 5 aju + 3 supplier). Verifikasi jumlah baris sebelum/sesudah.
3. **Daftar JO**: tab tipe + jumlah, cari lintas referensi, kolom lengkap + "+n", filter bulan berjalan, paginasi 20 bernomor, Excel xlsx.
4. **Form JO per tipe**: pilihan tipe, isian wajib per tipe (aturan di `rules.js`), baris referensi ganda + file, peringatan dobel, konfirmasi Cancel, kunci edit.
5. **Detail JO (material)**: kepala + tab, List Detail Material, Add data, template + Upload List dengan pratinjau, Scan Barcode (komponen scan dipakai ulang tahap 8/9).
6. **Detail JO (dokumen/checklist/remarks) + Preview A4.**
7. **Handling Ops**: daftar tiket (+n, tab terendah, nomor per bulan), Browse Data, aturan tiket aktif, halaman tiket bertab.
8. **Report Material ponsel**: `material_reports`, Damage wajib foto+remarks, resize 1600, tombol ≥44 px, scan kamera.
9. **Trucking Delivery**: Finish Loading + koreksi waktu, PDF SJ server (barcode, Nopen+tanggal, MT), Copy Report diperbarui, parsial qty dipertahankan.
10. **Unduhan**: Excel tiket/Report Material, PDF damage report, ZIP per tiket (struktur folder spek). Catatan: foto butuh Volume Railway agar tidak hilang saat deploy ulang.

## Verifikasi
- `npm test` (`node --test`, DB `lesat_test` di docker yang sama): penomoran JO/tiket/SJ termasuk **dua simpan bersamaan** dan tidak ada nomor terpakai ulang setelah hapus; semua rumus di tabel Perhitungan (`dwell`, `load time`, `report %`, `delivery %`, total berat JO, total SJ MT) di `lib/calc.js`; aturan wajib per tipe; migrasi dijalankan 2× (idempoten) dengan hitungan baris sama.
- Tiap tahap: jalankan server lokal, uji alur lewat Chrome headless (puppeteer-core seperti sebelumnya) di 1.360 px dan 390 px, pastikan tanpa error console dan tanpa scroll horizontal di halaman non-tabel; periksa screenshot.
- Akhir: alur penuh dengan data contoh (buat JO Import → material via upload xlsx → tiket → report material dengan foto → surat jalan → PDF → ZIP), lalu push; migrasi berjalan sendiri di Railway saat deploy.

## Menunggu konfirmasi pemilik (default dipakai sampai ada jawaban)
Keputusan spek nomor 1–4, 6–10, 12; arti kode "BE" (satuan party); bacaan kolom "Thickness" (tebal | lebar | bentuk C); titik awal dwelling time (dibuat tiket vs ETA kapal); format teks Copy Report; poin 2, 3, 5, 6, 7 di atas.
