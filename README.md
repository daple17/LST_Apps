# meLESAT — Sistem Internal PT Lima Sarana Trans

Menu yang sudah ada: **Job Order & Doc**, **Handling Ops** (ticket, report material, trucking/surat jalan).

## Menjalankan
```bash
docker compose up -d        # MySQL 8 di port 3307
npm install
npm start                   # http://localhost:3100
npm run seed                # opsional: data dummy Handling Ops
```
Login awal: `admin` / `admin123` (ganti sebelum dipakai di luar development).

## Konfigurasi (env)
`PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `JWT_SECRET` — default untuk development lokal ada di `server.js`. Wajib set `JWT_SECRET` dan password DB sendiri di server sungguhan.
