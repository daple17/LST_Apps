// Revisi tarif vendor: satu baris per kota tujuan berisi tarif jarak kota, tonase, dan ritase (dijumlahkan di menu PO). Bentuk 015 (asal/tujuan/satuan) diganti.
exports.up = async m => {
  if (await m.hasColumn('vendor_rates', 'city')) return;
  if (await m.count('vendor_rates')) await m.q('RENAME TABLE vendor_rates TO vendor_rates_old'); else await m.q('DROP TABLE vendor_rates');
  await m.q(`CREATE TABLE vendor_rates (id INT AUTO_INCREMENT PRIMARY KEY, vendor_id INT NOT NULL, city VARCHAR(100) NOT NULL, price_city DECIMAL(15,2) NOT NULL, price_ton DECIMAL(15,2) NOT NULL DEFAULT 0, price_trip DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vendor_rate_city (vendor_id, city), CONSTRAINT fk_vrate_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE)`);
};
