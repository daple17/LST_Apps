# Spesifikasi Penyempurnaan Job Order & Handling Ops

Oct 14, 2026 · @Hey

## Tujuan dan ruang lingkup

Dokumen ini adalah acuan untuk merampungkan dua menu yang sudah ada, **Job Order & Doc** dan **Handling Ops**, sesuai file requirement *Aplikasi Web Base.xlsx*. Menu lain tidak disentuh dan tetap berlabel "segera".

- Sumber: sheet Job Order & Doc, Handling Ops, sheet tersembunyi Sheet2, dan teks wireframe di dalam sheet tersebut.
- Tampilan mengikuti design token UI terbaru (panel kaca, Exo 2 Italic, warna logo LST) dari prompt redesign sebelumnya.
- Kondisi demo belum diperiksa langsung, jadi langkah pertama Claude Code adalah audit kode yang ada terhadap dokumen ini.

Prinsip kerja untuk Claude Code:

1. **Audit dulu.** Bandingkan kode dengan dokumen ini dan tulis tabel "sudah ada / sebagian / belum" sebelum mengubah apa pun.
2. **Jangan hilangkan data.** Data JO yang sudah ada dipindahkan ke struktur baru lewat migrasi, bukan dihapus.
3. **Bertahap.** Kerjakan sesuai urutan di bagian Urutan kerja, satu commit per tahap, dan aplikasi tetap jalan di setiap tahap.
4. **Tanya jika bertentangan.** Jika kode atau data bertentangan dengan dokumen ini, berhenti dan tanyakan, jangan menebak.

## Keputusan yang dipakai

Spesifikasi ini memakai 12 keputusan default di bawah. Sepuluh di antaranya perlu dikonfirmasi pemilik; ubah kolom Keputusan setelah diputuskan.

| No | Topik | Default yang dipakai | Keputusan |
| --- | --- | --- | --- |
| 1 | Tipe JO | Import, Export, Trucking, Project sesuai requirement. Jenis BC (BC 2.0, BC 1.6, dst) menjadi isian Type BC terpisah. Data lama "PIB BC x" menjadi Import dengan Type BC = BC x, data "LOKAL" menjadi Trucking. | Perlu konfirmasi |
| 2 | Nomor JO | Urutan 4 digit berjalan + kode customer 3 huruf, contoh 2501USC. Urutan tidak reset tiap tahun. Format demo "011-SSE" diganti. | Perlu konfirmasi |
| 3 | Nomor tiket Handling | YYYYMMDD + urutan 2 digit per bulan + inisial PIC 2 huruf, contoh 2025061018AT. | Perlu konfirmasi |
| 4 | Nomor surat jalan | YYYYMM + urutan 4 digit per bulan, contoh 2025060011. | Perlu konfirmasi |
| 5 | Referensi ganda per JO | Nomor aju, invoice, BL, SI/DO dan SI/PO boleh lebih dari satu per JO (Sheet2: satu JO dengan 5 aju dan 3 supplier). | Default dipakai |
| 6 | Satuan party | Disimpan terstruktur: jumlah + satuan (COIL, BUNDLE, PCS, 20FT, 40FT). Arti kode "BE" di requirement belum jelas. | Perlu konfirmasi |
| 7 | Berat dan format angka | Berat disimpan dalam kg. Tampil ton (2 desimal) di level JO dan kg di level material. Format angka Indonesia: 2.760,86. | Perlu konfirmasi |
| 8 | Status JO | Not Complete atau Complete, diubah manual. Sistem memberi peringatan jika checklist kelengkapan belum penuh. | Perlu konfirmasi |
| 9 | JO di tiket Handling | Satu JO hanya boleh ada di satu tiket yang aktif. | Perlu konfirmasi |
| 10 | Hak akses | Belum diatur requirement. Semua user login boleh semua aksi di dua menu ini, dan setiap perubahan dicatat siapa dan kapan. | Perlu konfirmasi |
| 11 | Kartu ringkasan JO | Kartu demo (ETA 7 hari ke depan, Lewat rencana delivery) dipertahankan, ditambah tab jumlah per tipe. | Default dipakai |
| 12 | Filter tanggal | Default bulan berjalan, berdasarkan ETA/ETD. | Perlu konfirmasi |

## Model data

Dua menu ini butuh 13 tabel ditambah satu tabel files untuk foto dan berkas. Perubahan terbesar dari demo: nomor aju, invoice, BL dan SI tidak lagi satu kolom di JO, melainkan baris di tabel referensi, dan satu tiket Handling bisa memuat beberapa JO.

| Tabel | Isi utama | Relasi |
| --- | --- | --- |
| customers | kode 3 huruf (USC, KUI, CAT, POS, SSE, PJM, NIJ, BTU), nama | dipakai JO. Jika master Customer belum ada, buat tabel sederhana dan isi dari data JO |
| shippers | nama | opsional di JO |
| vendors | nama vendor trucking (LST, MJL, DMS, HAJ W, HAJ S) | dipakai surat jalan |
| job\_orders | no\_jo, nickname, type, customer, shipper, type\_bc, jenis\_muatan (FCL, LCL/BB), vessel, eta\_etd, delivery\_plan, jumlah dan jenis kontainer, weight\_kg, qty + satuan, cbm, status, remarks | induk semua tabel di bawah |
| jo\_references | jenis (AJU, INVOICE, BL, SI\_DO, SI\_PO), nomor, tanggal, file | banyak per JO |
| jo\_materials | product/container no, description, spec, thickness, width, bentuk (C), intact/partial, net\_kg, gross\_kg, qty, satuan, dari, tujuan | banyak per JO |
| jo\_documents | jenis dokumen, nomor dokumen, file, ukuran, pengunggah | banyak per JO |
| jo\_checklist | 9 item kelengkapan, masing-masing centang INV dan FP | satu set per JO |
| handling\_tickets | no\_ticket, PIC (user), waktu dibuat, waktu selesai |  |
| ticket\_job\_orders | ticket, JO | banyak ke banyak |
| material\_reports | material, ticket, status (NOT\_CHECKED, OK, DAMAGE), remarks, pemeriksa, waktu | satu per material per tiket |
| delivery\_notes | no\_sj, ticket, nopol, driver, vendor, no HP, start\_loading, finish\_loading | banyak per tiket |
| delivery\_note\_items | surat jalan, material, tanda Good/Damage saat dimuat | satu material hanya di satu surat jalan |

Foto disimpan di satu tabel files (pemilik polimorfik): maksimal 8 foto per material report dan 3 foto per surat jalan. Semua tabel mencatat created\_by, updated\_by dan waktu.

Kolom material di requirement tertulis "Thickness" di atas tiga nilai (0.7 | 1245 | C). Dokumen ini membacanya sebagai tebal, lebar dan bentuk (C = coil); konfirmasi ke tim operasional.

## Job Order & Doc: halaman daftar

Halaman daftar menampilkan semua JO dengan tab per tipe, pencarian lintas referensi, dan ekspor Excel yang mengikuti filter aktif.

**Bagian atas**

- Kartu ringkasan seperti demo sekarang (Total JO, Not Complete, Complete, ETA 7 hari ke depan, Lewat rencana delivery).
- Tab: All, Import, Export, Trucking, Project, masing-masing dengan jumlah, contoh "Import (1801)". Jumlah mengikuti filter yang aktif.
- Tombol **+ Job Order** membuka pilihan tipe (JO Import, JO Export, JO Trucking, JO Project), lalu form sesuai tipe.

**Pencarian dan filter**

- Kotak cari: nomor JO, customer, vessel, BL, nomor aju, invoice. Pencarian juga mencari di jo\_references, bukan hanya kolom utama.
- Filter: status, customer, periode tanggal (default bulan berjalan).
- Tombol Reset dan **Download Excel** (semua baris hasil filter, bukan hanya halaman yang tampil).

**Kolom tabel**

| Kolom | Catatan |
| --- | --- |
| No. JO | tebal, klik membuka detail |
| Type | Import, Export, Trucking, Project |
| Customer | nama lengkap |
| Aju Ceisa | jika lebih dari satu: nomor pertama + lencana "+2", tooltip menampilkan semua |
| No. BL | sama seperti Aju |
| No. Invoice | sama seperti Aju |
| No. SI/PO | sama seperti Aju |
| Vessel |  |
| Party | jumlah + satuan, contoh 300 CL atau 12x40ft |
| Weight | ton, 2 desimal |
| ETA/ETD |  |
| Rencana Delivery | merah tebal jika lewat dan status masih Not Complete |
| Status | chip Not Complete atau Complete |
| Aksi | menu: Detail, Dokumen, Preview, Edit |

Tabel bisa digulir ke samping di layar sempit. Paginasi 20 baris dengan tombol ke halaman pertama dan terakhir, sesuai wireframe "1 2 3 4 5 .. 250 >I".

## Job Order & Doc: form tambah dan edit

Satu form dengan isian yang sama untuk empat tipe; yang berbeda hanya isian wajibnya. Import dan Export ketat karena terkait kepabeanan, Trucking dan Project longgar.

| Isian | Import | Export | Trucking | Project |
| --- | --- | --- | --- | --- |
| Nomor JO | otomatis | otomatis | otomatis | otomatis |
| Nickname | opsional | opsional | opsional | opsional |
| Jenis muatan (FCL, LCL/BB) | wajib | wajib | wajib | wajib |
| Nama customer (cari dari master) | wajib | wajib | wajib | wajib |
| Shipper | opsional | opsional | opsional | opsional |
| Type BC | wajib | wajib | opsional | opsional |
| Nomor aju (bisa banyak) | opsional (revisi client) | opsional (revisi client) | opsional | opsional |
| No. invoice + tanggal + file (bisa banyak) | wajib | wajib | opsional | opsional |
| No. BL + tanggal + file (bisa banyak) | opsional | opsional | opsional | opsional |
| No. SI/DO + tanggal + file | opsional | tidak ada | opsional | opsional |
| No. SI/PO + tanggal + file | tidak ada | wajib | opsional | opsional |
| Vessel | wajib | wajib | opsional | opsional |
| ETA/ETD | wajib | wajib | opsional | opsional |
| Delivery plan | wajib | wajib | wajib | wajib |
| Jumlah dan jenis kontainer | wajib | wajib | opsional | opsional |
| Weight (ton) | wajib | wajib | opsional | opsional |
| Quantity dan satuan | wajib | wajib | opsional | opsional |
| CBM | muncul jika LCL | muncul jika LCL | muncul jika LCL | muncul jika LCL |
| Remarks | opsional | opsional | opsional | opsional |

**Aturan form**

- Isian yang bisa banyak memakai baris berulang dengan tombol tambah dan hapus (ikon X), seperti wireframe.
- File: PDF, JPG atau PNG, maksimal 10 MB. File yang diunggah di form otomatis muncul juga di tab Dokumen.
- No. BL yang sudah dipakai JO lain **ditolak** saat simpan (revisi client); peringatan (bukan blokir) untuk aju/invoice/SI yang sudah dipakai, dan jika delivery plan lebih awal dari ETA.
- Saat edit: nomor JO tidak bisa diubah, dan tipe tidak bisa diubah setelah JO punya material.
- Tombol **Create** menyimpan, **Cancel** menutup dengan konfirmasi jika ada isian yang belum disimpan.

## Job Order & Doc: halaman detail

Halaman detail punya kepala ringkasan dan empat tab: List Detail Material, Dokumen, Checklist, Remarks. Tombol Preview mencetak lembar Job Order.

**Kepala ringkasan** (tampil di semua tab): Job Order, Customer, Vessel, No. BL, Party, Weight, No. Aju, Status JO. Nilai ganda ditulis berurutan dengan koma, contoh "000386, 000385".

**Tab List Detail Material**

- Kolom: No, Product/Container No, Description, Spec, Thickness, Net Weight, Gross Weight, Qty, Satuan, Dari, Tujuan, Edit.
- Baris total di atas tabel: total net, total gross, total qty.
- Cari berdasarkan nomor produk, deskripsi atau tujuan.
- **Add data**: Product/Container No\*, Intact atau Partial, Spec, Description\*, Thickness, Net Weight\*, Gross Weight\*, Quantity\*, Unit\*, From (pick up material)*, Destination (unloading site)*.
- **Download Template** (Excel dengan kolom persis seperti Add data) dan **Upload List**. Sebelum disimpan, tampilkan pratinjau dengan baris bermasalah ditandai; nomor produk ganda dalam satu JO ditolak.
- **Scan Barcode**: kamera membaca nomor produk, lalu membuka baris itu atau mengisi Add data jika belum ada.

**Tab Dokumen**

- Tambah dokumen: Jenis dokumen\* (Invoice, Bill of Lading, SI/DO, SI/PO, PIB/PEB, Faktur Pajak, Surat Jalan, Others), No. dokumen, file.
- Daftar: No, Jenis, No. Dokumen, Nama file, Ukuran, Download, Upload (ganti file), Delete dengan konfirmasi.

**Tab Checklist kelengkapan**

Sembilan item, masing-masing dengan dua centang INV dan FP: Agency/Adm DO, THC, Demurrage/Detention, Storage, Lift On Lift Off, Repair, PIB/PEB Nopen, Surat Jalan, Others. Simpan siapa dan kapan setiap centang diubah.

**Tab Remarks**: catatan dari saat pembuatan JO, bisa diedit.

**Preview (lembar Job Order)**: halaman siap cetak ukuran A4 berisi Customer, Shipper/Ship To, No. Invoice, No. MBL/HBL, No. SI/PO, No. aju PIB/PEB, Type, Jenis Muatan, Party, Weight, Vessel, ETA/ETD, Rencana Delivery, Remarks, checklist kelengkapan, dan satu kotak kosong untuk coretan operasional dengan pulpen. Bisa dicetak atau disimpan sebagai PDF.

## Handling Ops: daftar dan pembuatan tiket

Satu tiket Handling menggabungkan satu atau beberapa JO, lalu progresnya dihitung dari dua jalur kerja yang berjalan bersamaan.

&#91;embedded content: alur Handling Ops · 5 langkah, 2 jalur paralel\]

Pemeriksaan material dan pengiriman truk berjalan paralel; tiket selesai saat keduanya 100%.

**Daftar tiket**

- Tab progres: All, 100%, 50% sampai 99%, di bawah 50%, masing-masing dengan jumlah. Tab memakai nilai terendah dari Report Material % dan Trucking Delivery % (asumsi).
- Cari: nomor tiket, PIC, customer, vessel. Filter tanggal default bulan berjalan. Tombol Download Excel dan Tambah Data.
- Kolom: No. Ticket, PIC, Customer, Vessel, Party, Weight, Dwelling time, Report Material (%), Trucking Delivery (%), Report.
- Tiket dengan beberapa customer atau vessel menampilkan yang pertama + "+n".

**Membuat tiket**

1. Tambah Data membuka form tiket. PIC, No. ID, tanggal dan jam terisi otomatis dari user yang login.
2. Tambahkan JO dengan mengetik nomor JO, atau lewat **Browse Data**: modal pencarian (customer, vessel, BL) dengan centang per JO, lalu Tambahkan.
3. Tabel JO di tiket: No, Job Order, Aju Ceisa, Customer, Party, Weight, No. BL, Vessel, Del. Total di atas tabel: jumlah coil, ton, dan jumlah BL.
4. Create Ticket menyimpan dan membuat nomor tiket; Cancel membatalkan.

JO yang sudah ada di tiket aktif lain tidak bisa dipilih (keputusan nomor 9).

**Halaman tiket**: kepala ringkasan (JO, customer, vessel, BL, party, weight, aju, status JO), lalu dua tab, Report Material dan Trucking Delivery. Tombol Copy Report dan Download ZIP ada di kepala halaman.

## Handling Ops: Report Material

Report Material adalah pemeriksaan kondisi setiap material di tiket, dikerjakan di lapangan lewat ponsel. Progresnya = material yang sudah diperiksa dibagi semua material di tiket.

**Tabel**

- Kolom: No, Product/Container No, Description, Spec, Thickness, Net Weight, Gross Weight, Qty, Satuan, Dari, Tujuan, Status.
- Status tampil sebagai chip: "-" (belum diperiksa), OK, DM (Damage).
- Baris total di atas tabel: total net, total gross, total qty.
- Cari berdasarkan nomor produk, deskripsi atau tujuan. Filter status. Tombol Download Excel.

**Memeriksa satu material**

1. Ketuk baris, atau tekan **Scan Barcode** untuk langsung membuka material dari nomor di label.
2. Pilih status: Not Checked, OK, atau Damage.
3. Isi Remarks.
4. Tambah foto, maksimal 8, dari kamera atau galeri.
5. Save atau Cancel.

**Aturan**

- Status Damage wajib minimal 1 foto dan remarks (asumsi, karena dipakai untuk damage report PDF).
- Foto diperkecil di perangkat ke sisi terpanjang 1.600 px sebelum diunggah, agar cepat di jaringan seluler.
- Halaman ini harus nyaman di layar 390 px: tombol minimal 44 px, kamera memakai input file dengan capture.
- Setiap perubahan status mencatat pemeriksa dan waktu.

## Handling Ops: Trucking Delivery dan Surat Jalan

Setiap truk yang memuat material dari tiket mendapat satu surat jalan. Progres Trucking Delivery = qty material yang sudah masuk surat jalan dibagi total qty di tiket.

**Tabel surat jalan**

- Kolom: No, Nomor Polisi, Driver, Vendor, No. Surat Jalan, Start Loading, Load Time, Net Weight, Gross Weight, Qty, Satuan, Dari, Tujuan, Detail.
- Baris total di atas tabel: total net, total gross, total qty, total trailer (rit).
- Cari berdasarkan nopol, driver atau tujuan. Tombol Download Excel.

**Membuat surat jalan** (tombol Buat Surat Jalan)

1. Isi Nomor Polisi, Nama Driver, Vendor (pilih dari master), Nomor Handphone.
2. Pilih material: cari nomor produk atau **Scan Barcode**. Hanya material yang belum ada di surat jalan lain yang bisa dipilih.
3. Tambah foto unit dan muatan, maksimal 3, dari kamera atau galeri.
4. Start Loading tercatat saat surat jalan dibuat; tombol **Finish Loading** mencatat waktu selesai. Keduanya bisa dikoreksi.
5. Save membuat nomor surat jalan dan PDF-nya.

**Isi PDF Surat Jalan (A4)**

- Kop: PT Lima Sarana Trans, Jakarta Garden City Rukan Avenue Block C8 No. 53, Cakung Timur, Cakung, Jakarta Timur, DKI Jakarta.
- Judul SURAT JALAN, nomor surat jalan, dan barcode nomor tersebut.
- Data muatan: Customer, From, Address Destination, Job Order, Invoice, B/L, Vessel, Party, Weight, Nopen + tanggal, No. Aju.
- Data truk: Nopol, Driver, No. HP, PIC Ops.
- Tabel material: No, Product/Container No, Description dan Spec, Qty, Weight, Marks (Good atau Damage dari Report Material). Total: jumlah dan satuan, berat dalam MT.
- Kolom kosong untuk diisi tangan: tanggal dan waktu masuk pabrik, tanggal dan waktu keluar pabrik.

**Copy Report** menyalin ringkasan tiket ke clipboard sebagai teks siap tempel di WhatsApp: nomor tiket, customer, vessel, Report Material %, Trucking Delivery %, jumlah rit, dan daftar truk (nopol, driver, qty, tujuan). Format persisnya belum ada di requirement; buat sederhana dan mudah diubah.

## Perhitungan, penomoran dan unduhan

Semua angka di bawah dihitung di server dan diuji dengan unit test, karena tampil di banyak tempat (tabel, Excel, PDF, Copy Report).

**Perhitungan**

| Nilai | Rumus | Format tampil |
| --- | --- | --- |
| Dwelling time | sekarang (atau waktu tiket selesai) dikurangi waktu tiket dibuat. Titik awal perlu konfirmasi, bisa juga dari ETA kapal | 2 D : 04 H : 31 M |
| Load time | finish loading dikurangi start loading | 1 H 20 M |
| Report Material % | material berstatus OK atau Damage dibagi semua material di tiket | 57% |
| Trucking Delivery % | qty di surat jalan dibagi total qty di tiket | 34% |
| Total berat JO | jumlah net weight material (kg) dibagi 1.000 | 2.760,86 ton |
| Total di surat jalan | jumlah berat material di surat jalan | 61,57 MT |

**Penomoran** (format di keputusan 2 sampai 4)

- Nomor dibuat di server dalam satu transaksi database dengan penguncian, agar dua user yang menyimpan bersamaan tidak mendapat nomor sama.
- Nomor yang sudah terbit tidak dipakai ulang walaupun datanya dihapus.

**Unduhan**

| Unduhan | Isi |
| --- | --- |
| Excel daftar JO | semua kolom tabel + semua nomor referensi, mengikuti filter |
| Template material | kolom persis seperti form Add data, dengan satu baris contoh |
| Excel daftar tiket | semua kolom tabel, mengikuti filter |
| Excel Report Material | semua material tiket + status dan remarks |
| PDF lembar Job Order | lihat bagian halaman detail |
| PDF Surat Jalan | lihat bagian Trucking Delivery |
| PDF damage report | per material Damage: data material, remarks, foto |
| ZIP per tiket | struktur folder di bawah |

Struktur ZIP sesuai requirement:

```
{No Tiket} - {Customer} - {Kapal}/
  Product/
    {No Product} - {Good atau Damage}/   foto produk + damage report.pdf
  Surat Jalan/
    {No Surat Jalan} - {Nopol}/          foto unit dan muatan + surat jalan.pdf
```

## Urutan kerja dan kriteria selesai

Pekerjaan dibagi 10 tahap. Setiap tahap selesai, aplikasi tetap bisa dipakai dan hasilnya bisa dicek di demo sebelum lanjut.

- [ ] 1\. Audit kode terhadap dokumen ini, kirim tabel "sudah ada / sebagian / belum".
- [ ] 2\. Struktur data baru, migrasi data JO lama, data contoh (seed) mirip requirement.
- [ ] 3\. Daftar JO: tab per tipe dengan jumlah, pencarian lintas referensi, kolom lengkap, Excel.
- [ ] 4\. Form JO per tipe dengan isian wajib dan referensi ganda.
- [ ] 5\. Detail JO: List Detail Material, Add data, template dan Upload List, Scan Barcode.
- [ ] 6\. Detail JO: Dokumen, Checklist, Remarks, Preview lembar Job Order.
- [ ] 7\. Handling Ops: daftar tiket, Browse Data, Create Ticket, halaman tiket.
- [ ] 8\. Report Material di ponsel: status, remarks, foto, scan.
- [ ] 9\. Trucking Delivery: buat surat jalan, PDF dengan barcode, Copy Report.
- [ ] 10\. Unduhan Excel, PDF damage report, ZIP per tiket.

**Selesai jika**

- Semua yang tertulis di bagian Job Order & Doc dan Handling Ops berjalan dari awal sampai akhir dengan data contoh.
- Halaman Handling Ops nyaman dipakai di lebar 390 px; halaman lain di 1.360 px dan 390 px.
- Unit test untuk penomoran (termasuk dua simpan bersamaan) dan semua rumus di tabel Perhitungan.
- Tidak ada error di console, build dan test yang ada tetap lulus, tampilan mengikuti design token.
- Ringkasan akhir dari Claude Code: file yang diubah, keputusan yang diambil sendiri, dan hal yang masih menunggu konfirmasi.

## Prompt untuk Claude Code

Claude Code tidak bisa membuka dokumen ini lewat link. Unduh dokumen ini sebagai Markdown, simpan di repo sebagai `docs/spec-jo-handling.md`, lalu tempel prompt di bawah.

```text
Baca docs/spec-jo-handling.md. Itu spesifikasi untuk merampungkan dua menu yang sudah ada di aplikasi meLESAT: Job Order & Doc dan Handling Ops. Menu lain jangan diubah.

Cara kerja:
1. Mulai dengan plan mode. Audit kode yang ada terhadap spesifikasi dan buat tabel per fitur: sudah ada / sebagian / belum, beserta file terkait. Tunjukkan tabel itu dan rencanamu sebelum mengubah apa pun.
2. Ikuti bagian "Keputusan yang dipakai". Untuk keputusan berstatus "Perlu konfirmasi", pakai default yang tertulis tetapi buat agar mudah diubah (konstanta atau konfigurasi, bukan tersebar di kode).
3. Kerjakan sesuai "Urutan kerja", satu tahap per commit. Aplikasi harus tetap jalan di setiap tahap.
4. Jangan hapus data JO yang ada. Buat migrasi ke struktur baru dan pastikan bisa dijalankan ulang dengan aman.
5. Tampilan mengikuti design token yang sudah ada (panel kaca, Exo 2 Italic untuk judul dan angka, warna logo LST).
6. Jika kode atau data bertentangan dengan spesifikasi, atau ada yang tidak jelas, berhenti dan tanyakan.

Selesai jika semua poin di "Selesai jika" terpenuhi. Di akhir, tulis ringkasan: file yang diubah, keputusan yang kamu ambil sendiri, dan hal yang masih menunggu konfirmasi.
```
