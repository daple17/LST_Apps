// Master kota (dropdown tarif vendor) agar satu kota tidak tertulis berbeda-beda. Tarif vendor memakai city_id.
const SEED = ['Jakarta', 'Bekasi', 'Cikarang', 'Karawang', 'Bogor', 'Depok', 'Tangerang', 'Tangerang Selatan', 'Cilegon', 'Serang', 'Merak', 'Bandung', 'Cimahi', 'Purwakarta', 'Subang', 'Cirebon', 'Sukabumi', 'Garut', 'Tasikmalaya',
  'Semarang', 'Kendal', 'Demak', 'Surakarta', 'Yogyakarta', 'Magelang', 'Tegal', 'Pekalongan', 'Cilacap', 'Surabaya', 'Sidoarjo', 'Gresik', 'Pasuruan', 'Mojokerto', 'Malang', 'Probolinggo', 'Kediri', 'Banyuwangi', 'Jember',
  'Medan', 'Belawan', 'Binjai', 'Pekanbaru', 'Dumai', 'Padang', 'Jambi', 'Palembang', 'Bandar Lampung', 'Batam', 'Pangkal Pinang', 'Pontianak', 'Banjarmasin', 'Balikpapan', 'Samarinda', 'Makassar', 'Manado', 'Denpasar', 'Mataram', 'Kupang', 'Ambon', 'Jayapura'];
exports.up = async m => {
  if (!(await m.hasTable('cities'))) {
    await m.q('CREATE TABLE cities (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uq_cities_name (name))');
    await m.q('INSERT IGNORE INTO cities (name) VALUES ?', [SEED.map(n => [n])]);
  }
  if (await m.hasColumn('vendor_rates', 'city_id')) return;
  await m.q('INSERT IGNORE INTO cities (name) SELECT DISTINCT city FROM vendor_rates');                       // kota yang sudah terlanjur diketik tidak hilang
  await m.q('ALTER TABLE vendor_rates ADD COLUMN city_id INT NULL AFTER vendor_id');
  await m.q('UPDATE vendor_rates r JOIN cities c ON c.name=r.city SET r.city_id=c.id');
  await m.q('ALTER TABLE vendor_rates MODIFY city_id INT NOT NULL, DROP INDEX uq_vendor_rate_city, DROP COLUMN city, ADD UNIQUE KEY uq_vendor_rate_city (vendor_id, city_id), ADD CONSTRAINT fk_vrate_city FOREIGN KEY (city_id) REFERENCES cities(id)');
};
