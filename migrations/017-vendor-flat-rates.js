// Tarif tonase dan ritase menjadi satu angka per vendor (terpisah dari tarif per kota).
exports.up = async m => {
  await m.addCol('vendors', 'price_ton', 'DECIMAL(15,2) NOT NULL DEFAULT 0');
  await m.addCol('vendors', 'price_trip', 'DECIMAL(15,2) NOT NULL DEFAULT 0');
  await m.dropCol('vendor_rates', 'price_ton'); await m.dropCol('vendor_rates', 'price_trip');
};
