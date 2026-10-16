# Peta izin: route → izin

Izin dibaca dari database di **setiap** permintaan (`lib/authz.js`), tidak ada di JWT. Gagal izin → HTTP 403 `{ "error": "Tidak punya akses" }`; user nonaktif / token tidak valid → 401.
Kode izin = `modul.aksi`. Daftar modul dan aksi ada di satu tempat: `lib/permissions.js`.

Aturan dasar (`guard()` di `lib/authz.js`): **GET = view, POST = create, PUT/PATCH = update, DELETE = delete**. Pengecualian ditulis eksplisit di `server.js` (tabel di bawah).

## Job Order & Doc (`jo.*`) — `/api/job-orders/*`, `/api/documents/*`
| Metode + path | Izin |
|---|---|
| GET `/`, `/summary`, `/check-refs`, `/:id`, `/:id/materials`, `/:id/materials/:mid` | `jo.view` |
| GET `/export`, `/:id/materials/template` | `jo.export` *(pengecualian)* |
| POST `/` (buat), `/:id/duplicate`, `/:id/documents`, `/:id/references/:refId/file`, `/:id/materials`, `/:id/materials/import/preview`, `/:id/materials/import` | `jo.create` |
| PUT `/:id`, `/:id/checklist`, `/:id/materials/:mid`; PATCH `/:id/remarks`, `/:id/status`; PUT `/api/documents/:id/file` | `jo.update` |
| DELETE `/:id`, `/:id/references/:refId/file`, `/:id/materials/:mid`; DELETE `/api/documents/:id` | `jo.delete` |

## Handling Ops (`ho.*`) — `/api/ho/*`
| Metode + path | Izin |
|---|---|
| GET `/tickets`, `/browse-jo`, `/tickets/:id`, `/tickets/:id/materials`, `/tickets/:tid/materials/:mid`, `/tickets/:id/sj`, `/tickets/:id/available`, `/sj/:id`, `/tickets/:id/report-text` | `ho.view` |
| GET `/tickets/export`, `/tickets/:id/export`, `/tickets/:id/zip`, `/sj/:id/pdf`, `/tickets/:tid/materials/:mid/pdf` | `ho.export` *(pengecualian)* |
| POST `/tickets`, `/tickets/:id/materials`, `/tickets/:id/sj` | `ho.create` |
| POST `/sj/:id/finish`, POST `/tickets/:tid/materials/:mid/photos`, POST `/sj/:id/photos` | `ho.update` *(pengecualian: bukan membuat dokumen baru)* |
| PUT `/tickets/:id/jos`, `/materials/:id`, `/sj/:id`; PATCH `/tickets/:tid/materials/:mid/report` | `ho.update` |
| DELETE `/tickets/:id`, `/materials/:id`, `/files/:id`, `/sj/:id` | `ho.delete` |

## Dashboard (`home.view`) — `/api/home/*`
Seluruh router: `GET /upcoming`, `/plan`, `/tickets`.

## Data master
**Customer (`customer.*`) — `/api/customers/*`:** GET `/`, `/:id` → `customer.view`; GET `/export` → `customer.export`; GET `/suggest-code`, POST `/` → `customer.create`; PUT `/:id`, POST `/:id/activate|deactivate` → `customer.update`; DELETE `/:id` → `customer.delete`.

**Vendor (`vendor.*`) — `/api/vendors/*`:** GET `/`, `/:id`, `/countries` → `vendor.view`; GET `/export` → `vendor.export`; GET `/suggest-code`, POST `/` → `vendor.create`; PUT `/:id`, POST `/:id/activate|deactivate` → `vendor.update`; DELETE `/:id` → `vendor.delete` (ditolak bila dipakai surat jalan).

| Route | Izin |
|---|---|
| POST `/api/shippers` | `shipper.create` |
| POST `/api/vendors` | `vendor.create` |
| GET `/api/vendors` | cukup login |

## COA (`coa.*`) — `/api/coa/*`
| Metode + path | Izin |
|---|---|
| GET `/`, `/headers` | `coa.view` |
| GET `/export` | `coa.export` *(pengecualian)* |
| POST `/`, POST `/headers` | `coa.create` |
| PUT `/:id`, PUT `/headers/:id` | `coa.update` |
| DELETE `/headers/:id` | `coa.delete` (hanya kelompok kosong) |
| DELETE `/:id` (akun) | selalu 405: akun tidak dihapus, hanya dinonaktifkan |

## HR (SDM)
**Check In & Daily Report (`checkin.*`)** — `/api/checkin/*`, selalu dibatasi ke user yang login
| Metode + path | Izin |
|---|---|
| GET `/today`, `/history`, `/photo/:id` (hanya foto milik sendiri) | `checkin.view` |
| POST `/` (check in), POST `/report` | `checkin.create` |
| PUT `/report/:id` (hanya baris sendiri dan bertanggal hari ini; selain itu 403) | `checkin.update` |

**Rekap Absensi (`checkin_rekap.*`)** — `/api/checkin-rekap/*`
| Metode + path | Izin |
|---|---|
| GET `/`, GET `/user/:id`, GET `/photo/:id` | `checkin_rekap.view` |
| GET `/export` | `checkin_rekap.export` *(pengecualian)* |
| PUT `/override`, PUT `/report/:id` | `checkin_rekap.update` |
`checkin` dan `checkin_rekap` terpisah: rekap saja tidak boleh check in, dan check in saja tidak melihat rekap.

## Administrator
| Route | Izin |
|---|---|
| GET `/api/users`, `/api/users/roles`, `/api/users/:id` | `user.view` |
| POST `/api/users` | `user.create` (membuat Super Admin: hanya Super Admin) |
| PUT `/api/users/:id`, POST `/api/users/:id/activate`, `/deactivate` | `user.update` *(activate/deactivate = pengecualian dari POST→create)*; mengubah/menonaktifkan user Super Admin: hanya Super Admin |
| DELETE `/api/users/:id` | `user.delete` (hanya user tanpa jejak transaksi/audit) |
| GET `/api/roles`, `/api/roles/:id` | `role.view` |
| POST `/api/roles`, `/api/roles/:id/duplicate` | `role.create` |
| PUT `/api/roles/:id` | `role.update` (role sistem ditolak) |
| DELETE `/api/roles/:id` | `role.delete` (role sistem dan role yang masih dipakai ditolak) |

## Cukup login
`GET /api/lookups`, `GET /api/me`, `POST /api/me/password`. Unduhan PDF/ZIP lewat `?t=<token>` tetap dicek izinnya (`ho.export`). Berkas `/uploads/*` butuh `jo.view` atau `ho.view`; berkas foto absensi (`att-*`) tidak pernah bisa dibuka lewat `/uploads` (403), hanya lewat endpoint foto di atas.

## Aturan khusus
- Wajib ganti password (`must_change_password=1`): semua endpoint kecuali `/me`, `/me/password`, `/lookups` ditolak (403) sampai password diganti.
- Login: 10 gagal / 15 menit per username dan per IP → 429. User nonaktif mendapat pesan sama dengan password salah.
- Super Admin (role sistem) selalu memegang semua izin, termasuk modul baru; disinkronkan tiap server start (`lib/roles-seed.js`).
- Tombol di layar disembunyikan sesuai izin (`PERM_BTN` di `public/app.js`), tetapi yang menentukan tetap server.
