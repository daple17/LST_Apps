# Spesifikasi UI Login — Konsep K (LESAT by Lima Sarana)

Dokumen ini adalah sumber kebenaran untuk membangun halaman login LESAT, sistem internal PT Lima Sarana Trans. Visual target ada di `reference/login-k.html` (HTML statis yang bisa dibuka langsung di browser). Jika ada selisih antara dokumen ini dan referensi, **referensi menang** untuk hal visual, dokumen ini menang untuk perilaku dan aksesibilitas.

## 1. Ringkasan desain

Layout dua bagian pada desktop:

- **Kiri (hero):** foto kapal kontainer vertikal yang memudar halus ke latar kanan (tanpa garis pemisah), logo + wordmark LESAT di kiri atas, eyebrow oranye dan quote brand di bagian bawah.
- **Kanan:** kartu login putih di tengah, di atas latar gradient mesh biru dengan glow oranye dan tulisan "LESAT" raksasa transparan sebagai watermark.

Di layar ≤ 960px, hero ditumpuk di atas dan kartu login naik menimpa bagian bawah hero.

## 2. Design tokens

### Warna

| Token | Nilai | Pemakaian |
|---|---|---|
| `--navy-900` | `#06203b` | Teks utama, tombol Login, overlay foto |
| `--navy-700` | `#0a3158` | Hover tombol |
| `--base` | `#12335e` | Warna dasar latar mesh |
| `--blue-700` | `#1f5389` | Glow mesh kiri bawah |
| `--blue-600` | `#1b6aa5` | Link, focus ring |
| `--blue-500` | `#3a86b8` | Glow mesh kanan bawah |
| `--cyan-400` | `#55b0d4` | Glow mesh kiri atas |
| `--orange-500` | `#fb940c` | Aksen: bar kartu, eyebrow, glow mesh kanan atas |
| `--ink-2` | `#26384f` | Label field |
| `--muted` | `#52647a` | Teks pendukung |
| `--muted-2` | `#6b7c92` | Teks bantuan kecil |
| `--line` | `#d3dce8` | Border field |
| `--field` | `#f6f9fc` | Isi field |
| `--danger` | `#c62828` | Error (di atas `#fdecec`) |

Warna oranye, navy, dan biru diambil dari company profile PT Lima Sarana Trans.

### Tipografi

| Peran | Font | Gaya |
|---|---|---|
| Wordmark "LESAT" & judul "Login" | **Exo 2** | Italic, 900 (wordmark 30px) dan 800 (judul 36px) |
| Teks hero (eyebrow, quote, "By Lima Sarana") | **Montserrat** | 500–800; quote 800/40px/1.14; eyebrow 700/12px/letter-spacing .14em |
| Seluruh isi form (label, input, tombol, link, bantuan) | **Font sistem** `system-ui, -apple-system, 'Segoe UI', sans-serif` | Sama seperti login lama; label 13px/600, input 15px, tombol 16px/700 |

Heading "Login" ditulis **"Login"** (bukan kapital semua), begitu juga tulisan di tombol.

### Bentuk dan bayangan

- Kartu: radius 24px, padding 44/40/40, bayangan `0 40px 90px -30px rgba(0,0,0,.6)`, lebar maks 440px.
- Field: tinggi 52px, radius 12px, border 1.5px.
- Tombol: tinggi 54px, radius 12px, bayangan `0 14px 26px -12px rgba(6,32,59,.8)`.

## 3. Layout

### Desktop (> 960px)

- Wadah halaman: `min-height: 100vh`, flex wrap, `overflow: hidden`, latar mesh (lima gradient, lihat referensi).
- Hero: `flex: 1 1 600px`. Lapisan foto `position: absolute` selebar **135%** dari hero agar zona pemudaran masuk ke area kanan. Foto diberi `mask-image` linear-gradient 100° dengan **10+ stop yang berurutan** (opak sampai 45%, lalu turun bertahap sampai transparan di 100%). Jangan diganti dengan dua stop saja, karena pemisahnya akan terlihat kasar lagi.
- Di atas foto ada overlay gradient vertikal navy (0.5 → 0.05 → 0.55 → 0.96) supaya teks bawah tetap terbaca.
- Panel kanan: `flex: 1 1 480px`, kartu di tengah (grid `place-items: center`).
- Watermark "LESAT": Exo 2 italic 900, 380px, warna `rgba(255,255,255,.09)`, tengah vertikal, menempel kanan (-60px), `aria-hidden`, tidak bisa diklik.

### Mobile / tablet (≤ 960px)

- Hero di atas, tinggi minimal 400px, foto selebar penuh dengan mask **vertikal** (memudar ke bawah).
- Quote mengecil ke 26px; padding hero 28/24/72.
- Kartu naik 48px menimpa hero (`margin-top: -48px`), padding 32/24/28.
- Watermark mengecil ke 180px di kiri bawah area hero.

## 4. Konten (copy)

| Elemen | Teks |
|---|---|
| Wordmark | LESAT |
| Sub-wordmark | By Lima Sarana |
| Eyebrow | LOGISTIC AND TRANSPORTATION SOLUTION |
| Quote | "We are your one-stop solutions for building big brands." |
| Judul kartu | Login |
| Teks pengantar | Masuk dengan akun internal untuk mengelola operasional harian. |
| Label field | Username, Password |
| Placeholder | Masukkan username, Masukkan password |
| Tombol | Login |
| Link | Lupa Kata Sandi? |
| Bantuan | IT Support · it@limasarana.example |

Eyebrow dan quote berasal dari company profile. Alamat email IT Support masih placeholder dari login lama; **ganti dengan alamat asli** sebelum rilis.

## 5. State komponen

| State | Perilaku |
|---|---|
| Default | Seperti referensi |
| Focus field | Border `--blue-600` + ring `0 0 0 3px rgba(27,106,165,.2)` |
| Focus tombol/ikon | Outline terlihat (`:focus-visible`), jangan dihapus |
| Error field | Border `--danger`, pesan di bawah field ("Username wajib diisi." / "Password wajib diisi."), `aria-invalid="true"` |
| Error form (gagal login) | Kotak `.alert` merah muda di atas field dengan `role="alert"`; teks: "Username atau password salah. Silakan coba lagi." |
| Loading | Tombol `aria-busy="true"` + `disabled`, spinner kecil di kiri teks; field tidak berubah |
| Password terlihat | Ikon mata berganti ikon coret, `aria-pressed` dan `aria-label` ikut berubah ("Tampilkan/Sembunyikan password") |

Tombol dan field **tidak boleh** memakai `div` dengan `onClick`; gunakan elemen asli (`button`, `input`, `a`).

## 6. Perilaku dan aksesibilitas

- Validasi sisi klien: kedua field wajib; fokus pindah ke field pertama yang kosong.
- Enter di field mana pun men-submit form.
- `autocomplete="username"` dan `autocomplete="current-password"` wajib agar password manager bekerja.
- Kontras teks minimal 4.5:1 (sudah terpenuhi di referensi; periksa ulang bila warna diubah).
- Foto dan watermark dekoratif: `alt=""` / `aria-hidden="true"`. Logo diberi `alt="Logo LST"`.
- Hormati `prefers-reduced-motion` (hanya spinner yang beranimasi).
- Target sentuh minimal 44×44px (tombol mata sudah 44).
- Jangan menyimpan password di storage apa pun.

## 7. Aset

Folder `assets/`:

| File | Keterangan |
|---|---|
| `ship-portrait.webp` | Foto hero, 1276×1913, ±200 KB. Pakai ini |
| `ship-portrait.jpg` | Cadangan untuk browser lama |
| `lst-icon.png` | Ikon LT di tile putih, 256×256, sudut membulat transparan |

Catatan penting:

1. **Logo:** `lst-icon.png` dipotong dari screenshot login lama. Minta file **SVG/PNG asli** dari tim brand lalu ganti; tampilkan di 54×54px.
2. **Foto:** diambil dari company profile (`COMPANY_PROFILE_PT_LIMA_SARANA_TRANS.pdf`). Foto kapal tampaknya foto stok; **pastikan lisensinya** sebelum dipakai di aplikasi produksi.
3. Font ditarik dari Google Fonts di referensi. Untuk jaringan internal tanpa akses internet, host sendiri file font Exo 2 (italic 800, 900) dan Montserrat (500–800).

## 8. Performa

- `<link rel="preload" as="image" href="…/ship-portrait.webp">` untuk foto hero (elemen LCP).
- Preload font Exo 2 italic dan Montserrat 800; gunakan `font-display: swap`.
- Masking CSS didukung semua browser modern; sertakan prefix `-webkit-mask-image`.
- Target: LCP < 2.5 detik di koneksi 4G, tanpa layout shift.

## 9. Kriteria selesai (acceptance)

1. Pada 1440×900, tampilan setara `reference/login-k.html` (tidak ada garis tegas antara foto dan latar kanan).
2. Pada 390×844, hero di atas, kartu menimpa hero, tidak ada scroll horizontal.
3. Semua state di bagian 5 bisa dicapai dan terbaca screen reader.
4. Navigasi penuh dengan keyboard (Tab urutan: username → password → tombol mata → Login → Lupa Kata Sandi).
5. Login sukses dan gagal memakai alur autentikasi aplikasi yang sudah ada (bukan simulasi).
6. Tidak ada peringatan aksesibilitas Lighthouse pada halaman ini.

## 10. Hal yang perlu diputuskan tim

- Framework dan struktur proyek aplikasi (belum diketahui oleh dokumen ini).
- Endpoint dan format respons login, serta aturan pesan error (apakah dibedakan per field atau selalu generik).
- Tujuan link "Lupa Kata Sandi?" dan apakah halaman reset sudah ada.
- Perlu tidaknya opsi "Ingat saya" (tidak ada di konsep K).
- Alamat email IT Support yang asli.
