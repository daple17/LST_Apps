# Spesifikasi menu COA (FAT › COA)

Sumber: sheet **Account Code** dan **Update** di `account_codes (5).xlsx`, serta `docs/prompt-coa-claude-code.md`. Status: dibangun (akun, kelompok, ekspor). Yang belum dibangun ada di bagian paling bawah.

## Aturan bisnis
1. Satu akun: **Account Code** (5 angka, tidak diawali 0), **Account Name**, **Jenis Account**, **Sub Header**, **Group Account**.
2. Jenis Account ada lima: Aset, Liabilitas, Ekuitas, Revenue, Beban. Hirarki Jenis › Sub Header › Group Account. **Aset, Liabilitas, Ekuitas tidak punya Group Account** (disimpan kosong); Revenue dan Beban **wajib** punya Group Account.
3. **Master General Ledger** = daftar kelompok (kombinasi Jenis + Sub Header + Group Account). Sebuah akun disetting ke satu kelompok. Pengguna boleh menambah kelompok dan mengganti namanya.
4. Kode akun **unik** dan **tidak bisa diubah** setelah dibuat. Akun **tidak dihapus**, hanya dinonaktifkan; tidak ada route DELETE dan tidak ada izin `coa.delete`.
5. Nama akun boleh sama di Revenue dan Beban (mis. HANDLING IMPOR 41010 dan 51010); yang unik hanya kode.
6. Kelompok tidak bisa dinonaktifkan selama masih berisi akun aktif. Jenis sebuah kelompok tidak bisa diubah. Akun aktif tidak bisa ditaruh di kelompok nonaktif.

## Model data (migrasi `007-coa.js`)
- `coa_headers`: `id`, `jenis` ENUM, `sub_header`, `group_account` (`''` untuk neraca, bukan NULL agar UNIQUE berlaku), `sort_order`, `is_active`, timestamp, `created_by`, `updated_by`. UNIQUE `(jenis, sub_header, group_account)`.
- `coa_accounts`: `id`, `code` INT UNSIGNED UNIQUE, `name`, `header_id` FK, `is_active`, timestamp, `created_by`, `updated_by`.
- Data awal (`migrations/data/coa-seed.json`) masuk **sekali**, hanya bila `coa_accounts` kosong; menjalankan ulang tidak menimpa perubahan pengguna. Dibangkitkan dari berkas Excel dengan `node scripts/coa-seed.js "<account_codes.xlsx>"` (hanya bila sumber berubah). Aturan normalisasi ada di `lib/coa.js`.

## Data awal: hasil dan pembersihan
365 akun: Aset 31, Liabilitas 12, Ekuitas 4, Revenue 126, Beban 192; 30 kelompok. Kolom I–K di sheet sumber hanya daftar filter, tidak diimpor.
- Jenis: "Activa/Asset" → ASET; "Beban" dan "Expense" → BEBAN.
- Penulisan baku: Biaya Non Ops, Pendapatan Non Ops, Modal Ditahan, Pendapatan Operasional (sumber: "Opersional"), Biaya Administrasi dan Umum (sumber: "Adminstrasi"), Pendapatan Lain-lain.
- Spasi berlebih pada nama akun dirapikan (mis. "TRUCKING CONTAINER "). Huruf besar/kecil nama akun dibiarkan.
- Kelompok awal = taksonomi sheet "Update › Update Master Code" digabung dengan kombinasi yang muncul di data. Satu kelompok dari taksonomi belum punya akun: Biaya Non Ops › Biaya Lain.

### Kode ganda (keputusan sementara, **menunggu konfirmasi pemilik produk**)
Dua kode dipakai dua akun berbeda; kode harus unik, jadi satu akun tiap pasangan **tidak diimpor** (dicatat di log migrasi, di `seed.conflicts` dalam JSON, dan di sini):
| Kode | Diimpor | Tidak diimpor | Alasan |
|---|---|---|---|
| 45155 | CRANE | EXCAVATOR | pasangan beban 55155 = CRANE |
| 45165 | ADM LIFT ON | OCEAN FREIGHT FEE | pola 45160/55160 dan 45165/55165 menunjukkan ADM LIFT ON |
Dua akun itu ditambahkan pemilik lewat layar setelah kodenya diputuskan.

### Selisih data vs taksonomi (dipertahankan apa adanya, butuh konfirmasi)
- "Pendapatan Lain-lain" ada di Pendapatan Operasional (2 akun) dan Pendapatan Non Ops (5 akun): dua kelompok terpisah.
- "Biaya ATK" di data ada di Biaya Operasional (1 akun); di taksonomi Update ada di Beban Operasi. Keduanya dipertahankan sebagai kelompok terpisah.

## API (`routes/coa.js`)
| Metode + path | Izin |
|---|---|
| GET `/api/coa` (filter `q`, `jenis`, `sub_header`, `group`, `status`; 50 baris/halaman; `summary`) | `coa.view` |
| GET `/api/coa/export` (Excel mengikuti filter) | `coa.export` |
| POST `/api/coa`; PUT `/api/coa/:id` (kode berbeda → 400 `fields.code`) | `coa.create`; `coa.update` |
| GET `/api/coa/headers`; POST `/api/coa/headers`; PUT `/api/coa/headers/:id` | `coa.view`; `coa.create`; `coa.update` |
Galat validasi: `{ error, fields }` seperti `routes/roles.js`. Setiap perubahan ditulis ke `audit_log` (entity `coa` dan `coa_group`) dengan catatan sebelum → sesudah.

## Layar
`#coa` (tab **Account Code**: kartu per jenis yang bisa diklik sebagai filter, cari, filter jenis/status, Download Excel, + Tambah COA, form dengan satu pilihan Kelompok) dan `#coa/gl` (tab **Master General Ledger**: satu kartu per jenis; kolom Group Account disembunyikan untuk neraca). Tombol tambah, edit, dan ekspor disembunyikan bila izinnya tidak ada.

## Keputusan di luar prompt
- Mengganti nama Sub Header hanya mengubah baris kelompok itu (tiap kombinasi adalah satu baris); kelompok lain dengan Sub Header yang sama tidak ikut berubah.
- Mencari angka mencocokkan awalan kode **atau** isi nama; teks mencari di nama akun.
- Akun yang dinonaktifkan tidak bisa diaktifkan kembali bila kelompoknya nonaktif.
- Urutan kelompok mengikuti `sort_order` (kelipatan 10 per jenis); kelompok baru ditaruh paling akhir di jenisnya. Belum ada layar untuk mengurutkan.

## Belum dibangun (di luar lingkup)
COA Beban dan COA Pendapatan dengan nilai (Settlement, Submission, Selisih, Reference), kolom PO/Submission/Job Complete, laporan Raw Data, General Ledger berperiode, Cash Flow, jurnal, dan data master lain (Trailer, Rute, Unit, PIB/PEB, Customer, Vendor, Shipper). Semuanya menunggu transaksi Submission, Settlement, Job Complete dan sistem lama client.
