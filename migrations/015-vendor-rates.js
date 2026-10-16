// Tarif vendor per rute (asal → tujuan), dihitung per ritase atau per ton. Dipakai nanti oleh pengajuan PO.
exports.up = async m => {
  if (await m.hasTable('vendor_rates')) return;
  await m.q(`CREATE TABLE vendor_rates (id INT AUTO_INCREMENT PRIMARY KEY, vendor_id INT NOT NULL, origin VARCHAR(100) NOT NULL, destination VARCHAR(100) NOT NULL,
    basis ENUM('RITASE','TON') NOT NULL, price DECIMAL(15,2) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vendor_rate (vendor_id, origin, destination, basis), CONSTRAINT fk_vrate_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE)`);
};
