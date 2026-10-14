# Brief untuk Claude Code — Halaman Login LESAT (Konsep K)

Salin isi di bawah garis ini ke Claude Code (atau simpan sebagai `docs/login-k/CLAUDE_CODE_BRIEF.md` di repo, lalu minta Claude Code membacanya). Sebelum menempel, isi bagian **[ISI]**.

---

## Tugas

Bangun ulang halaman login aplikasi **LESAT** (sistem internal berbasis web PT Lima Sarana Trans) mengikuti desain Konsep K. Desain sudah final secara visual; tugas kamu adalah menerapkannya ke codebase yang ada.

## Konteks proyek

- Aplikasi: LESAT by Lima Sarana (logistik, trucking, handling, custom clearance).
- Stack saat ini: **[ISI: contoh Laravel + Blade / Next.js / React + Vite / PHP native / dll.]**
- Cara menjalankan dev server: **[ISI]**
- Endpoint login yang ada: **[ISI: URL, method, field yang dikirim, bentuk respons sukses dan gagal]**
- Halaman login lama ada di: **[ISI: path file]** (kontennya: judul Login, field Username dan Password, tombol Login, link "Lupa Kata Sandi?", kontak IT Support).

## Materi yang tersedia (folder `login-k/`)

- `LOGIN_K_SPEC.md` — spesifikasi lengkap: token warna, font, layout, state, aksesibilitas, kriteria selesai. **Baca ini dulu sampai habis.**
- `reference/login-k.html` — referensi visual dan perilaku yang bisa dibuka langsung di browser. Jadikan target pixel dan interaksi.
- `assets/` — `ship-portrait.webp` (+ `.jpg` cadangan) dan `lst-icon.png`.

## Cara mengerjakan

1. **Pelajari repo dulu.** Cari halaman login yang sekarang, cara styling (Tailwind / CSS modules / SCSS / CSS biasa), struktur komponen, dan cara aset statis dimuat. Ikuti konvensi yang sudah ada; jangan menambah framework atau library baru kecuali benar-benar perlu.
2. **Buat rencana singkat** (file yang akan diubah/dibuat) dan tampilkan sebelum menulis kode, bila perubahannya menyentuh lebih dari tiga file.
3. **Terapkan desain K:**
   - Pindahkan aset ke folder statis proyek dan pakai `ship-portrait.webp` untuk foto hero.
   - Ubah design token di spesifikasi menjadi variabel/tema sesuai cara styling proyek (CSS variables, `tailwind.config`, dll.).
   - Pertahankan teknik pemudaran foto: lapisan foto selebar 135% dengan `mask-image` bertahap banyak stop. Jangan disederhanakan.
   - Implementasikan semua state di spesifikasi bagian 5 (default, focus, error field, error form, loading, password terlihat).
4. **Hubungkan ke autentikasi yang sudah ada.** Ganti handler demo di referensi (`setTimeout`) dengan pemanggilan login asli. Jangan mengubah logika backend, session, atau keamanan tanpa izin; kalau perlu perubahan di sana, sebutkan dulu alasannya.
5. **Responsif:** uji di 1440×900, 1024×768, dan 390×844.
6. **Aksesibilitas:** label terhubung ke input, `autocomplete` benar, fokus terlihat, `role="alert"` untuk error form, navigasi keyboard penuh.
7. **Jalankan lint, type-check, dan test** yang tersedia di proyek, lalu perbaiki yang rusak karena perubahanmu.

## Hal yang tidak boleh dilakukan

- Jangan mengubah teks/copy tanpa alasan (daftar copy ada di spesifikasi bagian 4).
- Jangan menyimpan password atau data sensitif di localStorage/sessionStorage, dan jangan men-log kredensial.
- Jangan memakai `div`/`span` sebagai tombol atau input.
- Jangan menghapus fitur login yang sudah ada (misalnya redirect setelah login atau parameter `next`) tanpa konfirmasi.
- Jangan commit file besar baru selain aset di folder `assets/`.

## Catatan yang perlu kamu laporkan di akhir

- Logo `lst-icon.png` masih hasil potongan screenshot; sarankan penggantian dengan file logo asli (SVG).
- Lisensi foto kapal perlu dikonfirmasi sebelum rilis.
- Email IT Support `it@limasarana.example` masih placeholder.
- Apa yang diputuskan sendiri di luar spesifikasi (bagian 10 spesifikasi).

## Definisi selesai

Semua poin di **LOGIN_K_SPEC.md bagian 9** terpenuhi, halaman berjalan di dev server, dan kamu menyertakan ringkasan perubahan beserta tangkapan layar desktop dan mobile.
